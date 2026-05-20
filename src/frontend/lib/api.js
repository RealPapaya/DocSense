// API result mapper - adapts /api/search response rows into the result shape
// the UI components expect (spec/specShort/vendor/type/section/excerpt/etc.).

function normalizeSpans(spans) {
  return (spans || [])
    .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .map(s => ({ start: s.start, end: s.end, term: s.term || '' }));
}

function spansForWindow(spans, start, end) {
  return normalizeSpans(spans)
    .filter(s => s.end > start && s.start < end)
    .map(s => ({
      start: Math.max(0, s.start - start),
      end: Math.min(end - start, s.end - start),
      term: s.term,
    }));
}

function isNumericPage(page) {
  if (typeof page === 'number') return Number.isFinite(page) && page > 0;
  if (typeof page === 'string' && page.trim()) return /^[1-9]\d*$/.test(page.trim());
  return false;
}

function pageNumber(page) {
  return isNumericPage(page) ? Number(page) : 0;
}

function pageLabel(page) {
  if (isNumericPage(page)) return 'p.' + pageNumber(page);
  return page ? String(page) : '-';
}

function mapResult(r, query, index) {
  const nameNoExt = r.filename.replace(/\.[^.]+$/, '');
  const ext = (r.filename.match(/\.([^.]+)$/) || ['', ''])[1].toUpperCase();
  const text = r.chunk_text || '';
  const excerpt = text.slice(0, 320);
  const matchSpans = normalizeSpans(r.match_spans);
  const excerptSpans = spansForWindow(matchSpans, 0, excerpt.length);
  return {
    id:            [r.doc_id, r.chunk_index ?? r.page ?? 0, index].join(':'),
    doc_id:        r.doc_id,
    chunk_index:   r.chunk_index,
    filepath:      r.filepath || '',
    filename:      r.filename,
    score:         r.score         || 0,
    bm25:          r.bm25_score    || 0,
    semantic:      r.semantic_score || 0,
    spec:          nameNoExt,
    specShort:     r.filename,
    vendor:        nameNoExt,
    type:          ext,
    category:      '',
    version:       '',
    date:          '',
    page:          r.page || 0,
    section:       r.page ? pageLabel(r.page) : '',
    excerpt:       excerpt,
    highlight:     excerptSpans,
    excerptHighlight: excerptSpans,
    matchHighlight: matchSpans,
    context:       { before: '', match: text, after: '' },
    matchPositions: r.match_positions || [],
    matchSpans:    matchSpans,
    occurrencesInChunk: r.occurrences_in_chunk || 0,
    view:          'documents',
  };
}

// One row per Ctrl+F-style match. The backend already builds a snippet
// window; the frontend just attaches the same display fields the UI uses.
function mapOccurrence(r, query, index) {
  const nameNoExt = r.filename.replace(/\.[^.]+$/, '');
  const ext = (r.filename.match(/\.([^.]+)$/) || ['', ''])[1].toUpperCase();
  const snippet = r.snippet || ((r.chunk_text || '').slice(0, 240));
  const matchSpans = normalizeSpans(r.match_spans);
  const snippetSpans = normalizeSpans(r.snippet_match_spans);
  return {
    id:            [r.doc_id, r.chunk_index ?? 0, r.match_position ?? index, index].join(':'),
    doc_id:        r.doc_id,
    chunk_index:   r.chunk_index,
    matchPosition: r.match_position ?? 0,
    matchTerm:     r.match_term || '',
    filepath:      r.filepath || '',
    filename:      r.filename,
    score:         r.score      || 0,
    bm25:          r.bm25_score || 0,
    semantic:      r.semantic_score || 0,
    spec:          nameNoExt,
    specShort:     r.filename,
    vendor:        nameNoExt,
    type:          ext,
    category:      '',
    version:       '',
    date:          '',
    page:          r.page || 0,
    section:       r.page ? pageLabel(r.page) : '',
    excerpt:       snippet,
    snippet:       snippet,
    highlight:     snippetSpans,
    snippetHighlight: snippetSpans,
    matchHighlight: matchSpans,
    context:       { before: '', match: r.chunk_text || '', after: '' },
    matchPositions: r.match_positions || [],
    matchSpans:    matchSpans,
    occurrencesInChunk: r.occurrences_in_chunk || 0,
    view:          'occurrences',
  };
}
