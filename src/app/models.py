"""Pydantic request/response schemas for the DocSense API."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class MatchSpan(BaseModel):
    start: int
    end: int
    term: str


class SearchResult(BaseModel):
    doc_id: str
    filename: str
    filepath: str
    chunk_text: str
    page: Optional[int] = None
    score: float
    bm25_score: float = 0.0
    semantic_score: float = 0.0
    mode: str  # "vector" | "keyword" | "hybrid"

    # Occurrence metadata; populated mainly in occurrences view.
    chunk_index: Optional[int] = None
    match_position: Optional[int] = None
    match_term: Optional[str] = None
    snippet: Optional[str] = None

    # Aggregated occurrence info; populated in documents view per chunk.
    match_positions: List[int] = Field(default_factory=list)
    match_spans: List[MatchSpan] = Field(default_factory=list)
    snippet_match_spans: List[MatchSpan] = Field(default_factory=list)
    occurrences_in_chunk: int = 0


class SearchResponse(BaseModel):
    query: str
    mode: str
    total: int  # length of results in this response
    results: List[SearchResult]

    # Aggregated metadata; populated when the relevant view is used.
    view: str = "documents"  # "documents" | "occurrences"
    total_occurrences: int = 0
    total_chunks: int = 0
    total_documents: int = 0
    capped: bool = False
    offset: int = 0
    limit: Optional[int] = None
    took_ms: float = 0.0
    related_terms: List[str] = Field(default_factory=list)


class IndexResponse(BaseModel):
    status: str  # "ok" | "error"
    files_indexed: int
    files_skipped: int
    message: str = ""


class StatusResponse(BaseModel):
    total_documents: int
    total_chunks: int
    collection_points: int
    watched_docs_dir: str
    watched_docs_dirs: List[str] = Field(default_factory=list)
