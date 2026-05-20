"""
GET /api/search  - hybrid / vector / keyword search.

Query params
------------
q             : search query (required)
mode          : "hybrid" | "vector" | "keyword"   (default: hybrid)
view          : "documents" | "occurrences"       (default: documents)
whole_word    : bool                              (default: false)
match_case    : bool                              (default: false)
related_terms : repeated string params; OR-expanded with the base query
path_prefix   : repeated filesystem path prefixes to restrict search scope
limit         : optional result cap; documents and occurrences views use safe
                defaults and hard caps when omitted
offset        : pagination offset
"""
from __future__ import annotations

import logging
import re
import time
from typing import Iterable, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query

from app.config import RRF_K
from app.models import SearchResponse, SearchResult
from app.services.embedder import embed_query
from app.services.fts import count_fts, search_fts
from app.services.qdrant_store import collection_point_count, search_vector

router = APIRouter()
logger = logging.getLogger(__name__)


# Hard ceilings keep broad queries from loading and serialising huge result sets.
DOCUMENTS_HARD_CAP = 1000
DOCUMENTS_DEFAULT_LIMIT = 200
OCCURRENCES_HARD_CAP = 5000
OCCURRENCES_PAGE_HARD_CAP = 1000
OCCURRENCES_DEFAULT_LIMIT = 200
SEARCH_CANDIDATE_HARD_CAP = 10000
# Half-window (chars) of context built around each occurrence.
SNIPPET_HALF_WINDOW = 120


def _rrf_fuse(
    vector_hits: List[dict],
    fts_hits: List[dict],
    k: int = RRF_K,
    limit: Optional[int] = None,
) -> List[dict]:
    """
    Combine two ranked lists with RRF and keep per-component scores.
    """
    scores: dict[str, dict] = {}

    def _key(hit: dict) -> str:
        return f"{hit['doc_id']}::{hit.get('chunk_index', hit.get('chunk_text', '')[:60])}"

    for rank, hit in enumerate(vector_hits):
        key = _key(hit)
        scores.setdefault(key, {**hit, "rrf": 0.0, "semantic_score": 0.0, "bm25_score": 0.0})
        scores[key]["rrf"] += 1.0 / (k + rank)
        scores[key]["semantic_score"] = round(float(hit.get("score", 0.0)), 4)

    # Normalise FTS5 rank (negative BM25) to 0-1 range before fusing.
    if fts_hits:
        best_abs = abs(fts_hits[0].get("rank", -1)) or 1.0
        worst_abs = abs(fts_hits[-1].get("rank", -1)) or 1.0
        span = best_abs - worst_abs
        for rank, hit in enumerate(fts_hits):
            key = _key(hit)
            bm25_norm = round((abs(hit.get("rank", 0)) - worst_abs) / span, 4) if span else 1.0
            if key not in scores:
                scores[key] = {**hit, "rrf": 0.0, "semantic_score": 0.0, "bm25_score": 0.0}
            scores[key]["rrf"] += 1.0 / (k + rank)
            scores[key]["bm25_score"] = bm25_norm

    merged = sorted(scores.values(), key=lambda x: x["rrf"], reverse=True)
    top = merged if limit is None else merged[:limit]

    max_rrf = top[0]["rrf"] if top else 1.0
    for r in top:
        r["score"] = round(r["rrf"] / max_rrf, 4)

    return top


def _query_terms(query: str) -> List[str]:
    return [t for t in query.split() if t]


def _unique_terms(terms: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for term in terms:
        clean = term.strip()
        if not clean:
            continue
        key = clean.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def _match_branches(base_terms: List[str], related_terms: Optional[List[str]]) -> List[List[str]]:
    """Base query is AND; each related term is an OR branch."""
    branches: List[List[str]] = []
    if base_terms:
        branches.append(base_terms)
    for term in _unique_terms(related_terms or []):
        branches.append([term])
    return branches


def _is_ascii_word(term: str) -> bool:
    return re.fullmatch(r"[A-Za-z0-9_]+", term) is not None


def _find_spans(text: str, term: str, whole_word: bool, match_case: bool) -> List[dict]:
    """Return every non-overlapping match span for term in text."""
    if not text or not term:
        return []

    flags = 0 if match_case else re.IGNORECASE
    if whole_word and _is_ascii_word(term):
        pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(term) + r"(?![A-Za-z0-9_])", flags)
    else:
        pattern = re.compile(re.escape(term), flags)

    return [
        {"start": m.start(), "end": m.end(), "term": term}
        for m in pattern.finditer(text)
    ]


def _dedupe_spans(spans: List[dict]) -> List[dict]:
    deduped: List[dict] = []
    seen: set[tuple[int, int, str]] = set()
    for span in sorted(spans, key=lambda s: (s["start"], -(s["end"] - s["start"]), s["term"])):
        key = (span["start"], span["end"], span["term"].casefold())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(span)
    return deduped


def _branch_spans(
    text: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
) -> List[dict]:
    """Return spans for every branch that matches; base branch terms are AND-ed."""
    matched: List[dict] = []
    for branch in branches:
        branch_spans: List[dict] = []
        branch_ok = True
        for term in branch:
            spans = _find_spans(text, term, whole_word, match_case)
            if not spans:
                branch_ok = False
                break
            branch_spans.extend(spans)
        if branch_ok:
            matched.extend(branch_spans)
    return _dedupe_spans(matched)


def _annotate_and_filter(
    hits: List[dict],
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
) -> List[dict]:
    if not branches:
        return hits

    out: List[dict] = []
    for hit in hits:
        spans = _branch_spans(hit.get("chunk_text", ""), branches, whole_word, match_case)
        if not spans:
            continue
        hit["match_spans"] = spans
        hit["match_positions"] = [s["start"] for s in spans]
        hit["occurrences_in_chunk"] = len(spans)
        out.append(hit)
    return out


def _candidate_limit(limit: Optional[int], strict: bool, attempt: int = 0) -> Optional[int]:
    if limit is None:
        return SEARCH_CANDIDATE_HARD_CAP
    if not strict:
        return min(limit * 2, SEARCH_CANDIDATE_HARD_CAP)
    widened = max(limit * (8 if attempt == 0 else 16), 50 if attempt == 0 else 100)
    return min(widened, SEARCH_CANDIDATE_HARD_CAP)


def _effective_limit(view: str, limit: Optional[int]) -> int:
    if view == "occurrences":
        requested = limit if limit is not None else OCCURRENCES_DEFAULT_LIMIT
        return min(requested, OCCURRENCES_PAGE_HARD_CAP)
    requested = limit if limit is not None else DOCUMENTS_DEFAULT_LIMIT
    return min(requested, DOCUMENTS_HARD_CAP)


def _dedupe_hits(hits: Iterable[dict]) -> List[dict]:
    out: List[dict] = []
    seen: set[tuple[str, int | str]] = set()
    for hit in hits:
        key = (hit.get("doc_id", ""), hit.get("chunk_index", hit.get("chunk_text", "")[:80]))
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
    return out


def _normalize_path_prefixes(path_prefixes: Optional[List[str]]) -> List[str]:
    prefixes: List[str] = []
    seen: set[str] = set()
    for prefix in path_prefixes or []:
        clean = prefix.strip()
        if not clean:
            continue
        clean = clean.replace("\\", "/").rstrip("/")
        key = clean.casefold()
        if key in seen:
            continue
        seen.add(key)
        prefixes.append(clean)
    return prefixes


def _filter_by_path_prefix(hits: List[dict], path_prefixes: List[str]) -> List[dict]:
    if not path_prefixes:
        return hits

    out: List[dict] = []
    folded_prefixes = [prefix.casefold() for prefix in path_prefixes]
    for hit in hits:
        filepath = (hit.get("filepath") or "").replace("\\", "/").rstrip("/")
        folded = filepath.casefold()
        if any(folded == prefix or folded.startswith(prefix + "/") for prefix in folded_prefixes):
            out.append(hit)
    return out


def _recall_queries(q: str, branches: List[List[str]]) -> List[str]:
    queries = [q]
    for branch in branches[1:]:
        if len(branch) == 1:
            queries.append(branch[0])
    return _unique_terms(queries)


def _count_text_matches(
    q: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
    path_prefixes: List[str],
) -> Optional[int]:
    """Return exact FTS chunk count for plain text searches.

    Strict client-side filters need chunk text inspection, so their exact count
    is intentionally left unknown instead of loading every matching row.
    """
    if whole_word or match_case or len(branches) != 1:
        return None
    try:
        return count_fts(q, path_prefixes)
    except Exception as exc:
        logger.warning("FTS count failed for %r: %s", q, exc)
        return None


def _build_snippet(text: str, start: int, end: int) -> Tuple[str, int]:
    snippet_start = max(0, start - SNIPPET_HALF_WINDOW)
    snippet_end = min(len(text), end + SNIPPET_HALF_WINDOW)
    prefix = "..." if snippet_start > 0 else ""
    suffix = "..." if snippet_end < len(text) else ""
    return prefix + text[snippet_start:snippet_end] + suffix, snippet_start - len(prefix)


def _snippet_spans(spans: List[dict], snippet_offset: int, snippet_len: int) -> List[dict]:
    out: List[dict] = []
    for span in spans:
        start = span["start"] - snippet_offset
        end = span["end"] - snippet_offset
        if end <= 0 or start >= snippet_len:
            continue
        out.append({
            "start": max(0, start),
            "end": min(snippet_len, end),
            "term": span["term"],
        })
    return out


def _iter_occurrences(
    candidate_chunks: Iterable[dict],
    hard_cap: int,
) -> Tuple[List[dict], bool]:
    """Explode annotated candidate chunks into one record per term occurrence."""
    records: List[dict] = []
    capped = False

    for chunk in sorted(
        candidate_chunks,
        key=lambda c: (c.get("filepath", ""), c.get("chunk_index", 0)),
    ):
        text = chunk.get("chunk_text", "")
        if not text:
            continue
        spans = sorted(chunk.get("match_spans", []), key=lambda s: (s["start"], s["end"]))
        for span in spans:
            if len(records) >= hard_cap:
                capped = True
                return records, capped
            snippet, snippet_offset = _build_snippet(text, span["start"], span["end"])
            records.append({
                **chunk,
                "match_position": span["start"],
                "match_term": span["term"],
                "snippet": snippet,
                "snippet_match_spans": _snippet_spans(spans, snippet_offset, len(snippet)),
            })
    return records, capped


@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = Query("hybrid", description="hybrid | vector | keyword"),
    view: str = Query("documents", description="documents | occurrences"),
    whole_word: bool = Query(False, description="Match whole words only"),
    match_case: bool = Query(False, description="Match exact case"),
    related_terms: Optional[List[str]] = Query(None, description="Additional OR terms"),
    path_prefix: Optional[List[str]] = Query(None, description="Restrict results to path prefixes"),
    limit: Optional[int] = Query(None, ge=1),
    offset: int = Query(0, ge=0),
):
    mode = mode.lower()
    view = view.lower()
    if mode not in {"hybrid", "vector", "keyword"}:
        raise HTTPException(status_code=400, detail="mode must be hybrid, vector, or keyword")
    if view not in {"documents", "occurrences"}:
        raise HTTPException(status_code=400, detail="view must be documents or occurrences")

    clean_related = _unique_terms(related_terms or [])
    clean_path_prefixes = _normalize_path_prefixes(path_prefix)
    logger.info(
        "Search: q=%r mode=%s view=%s whole_word=%s match_case=%s related=%s paths=%s limit=%s offset=%s",
        q, mode, view, whole_word, match_case, clean_related, clean_path_prefixes,
        _effective_limit(view, limit), offset,
    )

    t0 = time.perf_counter()
    terms = _query_terms(q)
    branches = _match_branches(terms, clean_related)

    try:
        if view == "occurrences":
            return _run_occurrences(
                q, branches, whole_word, match_case, clean_related, clean_path_prefixes, limit, offset, t0
            )
        return _run_documents(
            q, mode, branches, whole_word, match_case, clean_related, clean_path_prefixes, limit, offset, t0
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Search error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


def _search_fts_candidates(
    q: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
    limit: Optional[int],
    path_prefixes: Optional[List[str]] = None,
) -> List[dict]:
    """Run broad FTS recall, then strict-filter against visible chunk text."""
    strict = whole_word or match_case or len(branches) > 1
    attempts = 2 if limit is not None and strict else 1
    filtered: List[dict] = []

    for attempt in range(attempts):
        candidate_limit = _candidate_limit(limit, strict, attempt)
        raw = _dedupe_hits(
            hit
            for query in _recall_queries(q, branches)
            for hit in search_fts(query, limit=candidate_limit)
        )
        raw = _filter_by_path_prefix(raw, path_prefixes or [])
        filtered = _annotate_and_filter(raw, branches, whole_word, match_case)
        if limit is None or len(filtered) >= limit or attempt == attempts - 1:
            return filtered
    return filtered


def _search_vector_candidates(
    q: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
    limit: Optional[int],
    path_prefixes: Optional[List[str]] = None,
) -> List[dict]:
    strict = whole_word or match_case or len(branches) > 1
    attempts = 2 if limit is not None and strict else 1
    filtered: List[dict] = []

    for attempt in range(attempts):
        vector_limit = _candidate_limit(limit, strict, attempt)
        if path_prefixes:
            vector_limit = min(collection_point_count(), vector_limit or SEARCH_CANDIDATE_HARD_CAP)
        raw = _dedupe_hits(
            hit
            for query in _recall_queries(q, branches)
            for hit in (search_vector(embed_query(query), limit=vector_limit) if vector_limit else [])
        )
        raw = _filter_by_path_prefix(raw, path_prefixes or [])
        filtered = _annotate_and_filter(raw, branches, whole_word, match_case)
        if limit is None or len(filtered) >= limit or attempt == attempts - 1:
            return filtered
    return filtered


def _run_documents(
    q: str,
    mode: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
    related_terms: List[str],
    path_prefixes: List[str],
    limit: Optional[int],
    offset: int,
    t0: float,
) -> SearchResponse:
    page_limit = _effective_limit("documents", limit)
    probe_limit = min(offset + page_limit + 1, DOCUMENTS_HARD_CAP + 1)

    if mode in {"hybrid", "vector"}:
        vector_hits = _search_vector_candidates(q, branches, whole_word, match_case, probe_limit, path_prefixes)
    else:
        vector_hits = []

    if mode in {"hybrid", "keyword"}:
        fts_hits = _search_fts_candidates(q, branches, whole_word, match_case, probe_limit, path_prefixes)
    else:
        fts_hits = []

    if mode == "hybrid":
        raw = _rrf_fuse(vector_hits, fts_hits, limit=probe_limit)
        for r in raw:
            r.pop("rrf", None)
            r["mode"] = "hybrid"
        ranked = raw
    elif mode == "vector":
        ranked = vector_hits[:probe_limit]
        for r in ranked:
            r["mode"] = "vector"
    else:
        if fts_hits:
            best_abs = abs(fts_hits[0].get("rank", -1)) or 1.0
            worst_abs = abs(fts_hits[-1].get("rank", -1)) or 1.0
            span = best_abs - worst_abs
            for r in fts_hits:
                bm25 = round((abs(r.get("rank", 0)) - worst_abs) / span, 4) if span else 1.0
                r["score"] = bm25
                r["bm25_score"] = bm25
                r["mode"] = "keyword"
        ranked = fts_hits[:probe_limit]

    bounded_ranked = ranked[:DOCUMENTS_HARD_CAP]
    bounded_total = len(bounded_ranked)
    known_total = (
        _count_text_matches(q, branches, whole_word, match_case, path_prefixes)
        if mode in {"hybrid", "keyword"} else None
    )
    total_chunks = known_total if known_total is not None else bounded_total
    capped = offset + page_limit < total_chunks
    page = bounded_ranked[offset : offset + page_limit]

    total_occurrences = sum(r.get("occurrences_in_chunk", 0) for r in page)
    total_documents = len({r.get("doc_id") for r in bounded_ranked})
    took_ms = (time.perf_counter() - t0) * 1000.0

    return SearchResponse(
        query=q,
        mode=mode,
        view="documents",
        total=len(page),
        results=[_to_result(r, mode) for r in page],
        total_occurrences=total_occurrences,
        total_chunks=total_chunks,
        total_documents=total_documents,
        capped=capped,
        offset=offset,
        limit=page_limit,
        took_ms=round(took_ms, 2),
        related_terms=related_terms,
    )


def _run_occurrences(
    q: str,
    branches: List[List[str]],
    whole_word: bool,
    match_case: bool,
    related_terms: List[str],
    path_prefixes: List[str],
    limit: Optional[int],
    offset: int,
    t0: float,
) -> SearchResponse:
    if not branches:
        raise HTTPException(status_code=400, detail="Empty query")

    page_limit = _effective_limit("occurrences", limit)
    candidate_limit = min(SEARCH_CANDIDATE_HARD_CAP, max(OCCURRENCES_HARD_CAP, offset + page_limit + 1))
    fts_hits = _search_fts_candidates(q, branches, whole_word, match_case, candidate_limit, path_prefixes)

    if fts_hits:
        best_abs = abs(fts_hits[0].get("rank", -1)) or 1.0
        worst_abs = abs(fts_hits[-1].get("rank", -1)) or 1.0
        span = best_abs - worst_abs
        for r in fts_hits:
            bm25 = round((abs(r.get("rank", 0)) - worst_abs) / span, 4) if span else 1.0
            r["score"] = bm25
            r["bm25_score"] = bm25
            r["semantic_score"] = 0.0
            r["mode"] = "keyword"

    occurrences, occurrence_capped = _iter_occurrences(fts_hits, OCCURRENCES_HARD_CAP)
    capped = occurrence_capped or len(fts_hits) >= candidate_limit

    total_occurrences = len(occurrences)
    total_chunks = len({(r["doc_id"], r.get("chunk_index", 0)) for r in occurrences})
    total_documents = len({r["doc_id"] for r in occurrences})

    page = occurrences[offset : offset + page_limit]

    took_ms = (time.perf_counter() - t0) * 1000.0

    return SearchResponse(
        query=q,
        mode="keyword",
        view="occurrences",
        total=len(page),
        results=[_to_result(r, "keyword") for r in page],
        total_occurrences=total_occurrences,
        total_chunks=total_chunks,
        total_documents=total_documents,
        capped=capped,
        offset=offset,
        limit=page_limit,
        took_ms=round(took_ms, 2),
        related_terms=related_terms,
    )


def _to_result(r: dict, mode: str) -> SearchResult:
    return SearchResult(
        doc_id=r.get("doc_id", ""),
        filename=r.get("filename", ""),
        filepath=r.get("filepath", ""),
        chunk_text=r.get("chunk_text", ""),
        page=r.get("page"),
        score=r.get("score", 0.0),
        bm25_score=r.get("bm25_score", 0.0),
        semantic_score=r.get("semantic_score", 0.0),
        mode=r.get("mode", mode),
        chunk_index=r.get("chunk_index"),
        match_position=r.get("match_position"),
        match_term=r.get("match_term"),
        snippet=r.get("snippet"),
        match_positions=r.get("match_positions", []),
        match_spans=r.get("match_spans", []),
        snippet_match_spans=r.get("snippet_match_spans", []),
        occurrences_in_chunk=r.get("occurrences_in_chunk", 0),
    )
