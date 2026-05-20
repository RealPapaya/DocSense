from app.routes import search as search_route


def _hit(text: str, doc_id: str = "d1", chunk_index: int = 0) -> dict:
    return {
        "doc_id": doc_id,
        "filename": "doc.pdf",
        "filepath": "/tmp/doc.pdf",
        "chunk_text": text,
        "chunk_index": chunk_index,
        "page": 1,
        "rank": -1.0,
    }


def _hit_at(path: str, text: str = "BIOS", doc_id: str = "d1") -> dict:
    hit = _hit(text, doc_id)
    hit["filepath"] = path
    return hit


def test_default_matching_is_case_insensitive():
    branches = search_route._match_branches(["bios"], [])
    hits = search_route._annotate_and_filter([_hit("BIOS and bios")], branches, False, False)

    assert len(hits) == 1
    assert hits[0]["match_positions"] == [0, 9]
    assert hits[0]["occurrences_in_chunk"] == 2


def test_match_case_requires_exact_case():
    branches = search_route._match_branches(["BIOS"], [])
    hits = search_route._annotate_and_filter([_hit("BIOS and bios")], branches, False, True)

    assert len(hits) == 1
    assert hits[0]["match_positions"] == [0]
    assert hits[0]["match_spans"] == [{"start": 0, "end": 4, "term": "BIOS"}]


def test_whole_word_excludes_ascii_substrings():
    branches = search_route._match_branches(["bios"], [])
    hits = search_route._annotate_and_filter(
        [_hit("bios biosphere prebios")],
        branches,
        True,
        False,
    )

    assert len(hits) == 1
    assert hits[0]["match_positions"] == [0]


def test_related_terms_are_or_expansion():
    branches = search_route._match_branches(["bios"], ["UEFI"])
    hits = search_route._annotate_and_filter([_hit("UEFI firmware")], branches, False, False)

    assert len(hits) == 1
    assert hits[0]["match_spans"] == [{"start": 0, "end": 4, "term": "UEFI"}]


def test_multi_token_base_query_is_and():
    branches = search_route._match_branches(["secure", "boot"], [])
    hits = search_route._annotate_and_filter([_hit("secure firmware")], branches, False, False)

    assert hits == []


def test_cjk_whole_word_falls_back_to_substring():
    term = "\u4e2d\u6587"
    text = "abc\u4e2d\u6587\u6e2c\u8a66"
    branches = search_route._match_branches([term], [])
    hits = search_route._annotate_and_filter([_hit(text)], branches, True, False)

    assert len(hits) == 1
    assert hits[0]["match_positions"] == [3]


def test_related_terms_expand_fts_candidate_queries(monkeypatch):
    calls = []

    def fake_search_fts(query, limit=None):
        calls.append((query, limit))
        if query == "bios":
            return [_hit("biosphere", "base", 0)]
        if query == "UEFI":
            return [_hit("UEFI firmware", "related", 0)]
        return []

    monkeypatch.setattr(search_route, "search_fts", fake_search_fts)
    branches = search_route._match_branches(["bios"], ["UEFI"])

    hits = search_route._search_fts_candidates("bios", branches, True, False, 1)

    assert [call[0] for call in calls] == ["bios", "UEFI"]
    assert [(h["doc_id"], h["match_positions"]) for h in hits] == [("related", [0])]


def test_unlimited_candidate_searches_are_bounded(monkeypatch):
    calls = []

    def fake_search_fts(query, limit=None):
        calls.append(limit)
        return []

    monkeypatch.setattr(search_route, "search_fts", fake_search_fts)

    search_route._search_fts_candidates("bios", [["bios"]], False, False, None)

    assert calls == [search_route.SEARCH_CANDIDATE_HARD_CAP]


def test_documents_view_defaults_to_first_safe_page(monkeypatch):
    hits = [
        {**_hit("BIOS", f"d{i}", i), "score": 1.0 - (i / 1000)}
        for i in range(search_route.DOCUMENTS_DEFAULT_LIMIT + 1)
    ]

    monkeypatch.setattr(search_route, "_search_vector_candidates", lambda *args, **kwargs: [])
    monkeypatch.setattr(search_route, "_search_fts_candidates", lambda *args, **kwargs: hits)
    monkeypatch.setattr(search_route, "count_fts", lambda *args, **kwargs: 34567)

    response = search_route._run_documents(
        "bios",
        "keyword",
        [["bios"]],
        False,
        False,
        [],
        [],
        None,
        0,
        0.0,
    )

    assert response.total == search_route.DOCUMENTS_DEFAULT_LIMIT
    assert len(response.results) == search_route.DOCUMENTS_DEFAULT_LIMIT
    assert response.limit == search_route.DOCUMENTS_DEFAULT_LIMIT
    assert response.capped is True
    assert response.total_chunks == 34567


def test_path_prefix_filter_keeps_only_matching_paths():
    hits = [
        _hit_at(r"D:\docs\alpha\a.pdf", doc_id="keep"),
        _hit_at(r"D:\docs\beta\b.pdf", doc_id="drop"),
    ]

    filtered = search_route._filter_by_path_prefix(hits, ["D:/docs/alpha"])

    assert [hit["doc_id"] for hit in filtered] == ["keep"]


def test_path_prefixes_are_normalized_and_deduped():
    assert search_route._normalize_path_prefixes([" D:\\Docs\\Alpha\\ ", "D:/Docs/Alpha", ""]) == [
        "D:/Docs/Alpha"
    ]


def test_occurrence_records_include_snippet_relative_spans():
    chunk = _hit("prefix BIOS suffix BIOS")
    chunk["match_spans"] = [
        {"start": 7, "end": 11, "term": "BIOS"},
        {"start": 19, "end": 23, "term": "BIOS"},
    ]
    records, capped = search_route._iter_occurrences([chunk], 10)

    assert capped is False
    assert len(records) == 2
    assert records[0]["match_term"] == "BIOS"
    assert records[0]["snippet_match_spans"][0] == {"start": 7, "end": 11, "term": "BIOS"}


def test_to_result_serializes_match_fields():
    result = search_route._to_result(
        {
            **_hit("BIOS"),
            "score": 1.0,
            "match_position": 0,
            "match_term": "BIOS",
            "match_positions": [0],
            "match_spans": [{"start": 0, "end": 4, "term": "BIOS"}],
            "snippet_match_spans": [{"start": 0, "end": 4, "term": "BIOS"}],
            "occurrences_in_chunk": 1,
        },
        "keyword",
    )

    assert result.match_term == "BIOS"
    assert result.match_positions == [0]
    assert result.match_spans[0].start == 0
    assert result.snippet_match_spans[0].end == 4
