// ResultRow / OccurrenceRow / ResultsPanel - list of search results with
// list header + load-more for occurrence view.

function ResultRow({ result, index, selected, onSelect, tagsData = { customTags: [], assignments: {} } }) {
  const T = useT();
  const score = result.score || 0;
  const sc = scoreClass(score);
  const assigned = (tagsData.assignments || {})[result.doc_id] || [];
  const assignedTags = (tagsData.customTags || []).filter(tag => assigned.includes(tag.id));
  return (
    <div className={'result' + (selected ? ' selected' : '')} onClick={() => onSelect(result.id)}>
      <div className="num">#{String(index + 1).padStart(2, '0')}</div>
      <div className="body">
        <div className="result-row1">
          {result.type && <DocumentIcon ext={result.type} className="file-type-icon" fallbackText={result.type} />}
          <span className="specname">{result.spec}</span>
          <span className="spacer"></span>
          {result.occurrencesInChunk > 1 && (
            <span className="occ-pill" data-tip={T('occurrences_in_chunk_tip')}>
              {result.occurrencesInChunk}x
            </span>
          )}
          <span className={'score-pill' + sc}>{score.toFixed(4)}</span>
        </div>
        {assignedTags.length > 0 && (
          <div className="result-row2 result-tags">
            {assignedTags.map(tag => (
              <span key={tag.id} className="tag-pill tag-pill-custom" style={{ background: tag.color }}>{tag.name}</span>
            ))}
          </div>
        )}
        <div className="result-row3">
          {result.section && <span className="section">{result.section}</span>}
        </div>
        <div className="excerpt">{highlightText(result.excerpt, result.excerptHighlight || result.highlight)}</div>
      </div>
    </div>
  );
}

// Dense single-line row used in occurrences view.
function OccurrenceRow({ result, index, selected, onSelect }) {
  const T = useT();
  return (
    <div className={'occ-row' + (selected ? ' selected' : '')} onClick={() => onSelect(result.id)}>
      <div className="occ-num">#{String(index + 1).padStart(4, '0')}</div>
      {result.type && <DocumentIcon ext={result.type} className="file-type-icon" fallbackText={result.type} />}
      <span className="occ-spec" title={result.specShort}>{result.spec}</span>
      <span className="occ-page">{pageLabel(result.page)}</span>
      <span className="occ-snippet">{highlightText(result.snippet || result.excerpt, result.snippetHighlight || result.highlight)}</span>
    </div>
  );
}

// Lightweight viewport-windowed list: render only rows near the scroll position
// so 5,000-row lists stay snappy without a vendor library.
function VirtualList({ items, rowHeight, renderRow, overscan = 24, className = '' }) {
  const ref = React.useRef(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewport,  setViewport]  = React.useState(600);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const measure = () => setViewport(el.clientHeight || 600);
    measure();
    el.addEventListener('scroll', onScroll);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect(); };
  }, []);

  const total = items.length;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewport / rowHeight) + overscan * 2;
  const last = Math.min(total, first + visibleCount);

  const slice = [];
  for (let i = first; i < last; i++) slice.push(renderRow(items[i], i));

  return (
    <div ref={ref} className={className} style={{ overflowY: 'auto', position: 'relative' }}>
      <div style={{ height: total * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: first * rowHeight, left: 0, right: 0 }}>
          {slice}
        </div>
      </div>
    </div>
  );
}

function ResultsPanel({
  results, selectedId, onSelect, sortKey, setSortKey, cardMode, setCardMode,
  totalMs, tagsData = { customTags: [], assignments: {} },
  view = 'documents', summary = {}, onLoadMore = () => {}, loadingMore = false,
}) {
  const T = useT();
  const isOccurrences = view === 'occurrences';
  const hasMore = isOccurrences
    && (summary.totalOccurrences || 0) > results.length;

  return (
    <section className="results">
      <div className="results-head">
        {isOccurrences ? (
          <span className="ct">
            <strong>{results.length}</strong>
            {' / '}
            <strong>{summary.totalOccurrences || 0}{summary.capped ? '+' : ''}</strong>
            {' '}{T('matches_n')}
            {' · '}<strong>{totalMs}</strong> {T('results_ms')}
          </span>
        ) : (
          <span className="ct">
            <strong>{results.length}</strong> {T('results_n')} · <strong>{totalMs}</strong> {T('results_ms')}
          </span>
        )}
        <span className="spacer"></span>
        {!isOccurrences && (
          <>
            <label>{T('sort')}</label>
            <select value={sortKey} onChange={e => setSortKey(e.target.value)}>
              <option value="score">{T('sort_relevance')}</option>
              <option value="name">{T('sort_name')}</option>
              <option value="date">{T('sort_date')}</option>
            </select>
            <div className="layout-toggle">
              <button className={cardMode === 'detailed' ? 'on' : ''} onClick={() => setCardMode('detailed')} data-tip={T('layout_detailed')}><Icon.rows /></button>
              <button className={cardMode === 'compact'  ? 'on' : ''} onClick={() => setCardMode('compact')}  data-tip={T('layout_compact')} ><Icon.list /></button>
            </div>
          </>
        )}
      </div>

      {isOccurrences ? (
        <>
          <VirtualList
            className="occ-list"
            items={results}
            rowHeight={36}
            renderRow={(r, i) => (
              <OccurrenceRow
                key={r.id}
                result={r}
                index={i}
                selected={r.id === selectedId}
                onSelect={onSelect}
              />
            )}
          />
          {hasMore && (
            <div className="loadmore-bar">
              <button className="loadmore-btn" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? T('loading_more') : T('load_more')}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="result-list">
          {results.map((r, i) => (
            <ResultRow key={r.id} result={r} index={i} selected={r.id === selectedId} onSelect={onSelect} tagsData={tagsData} />
          ))}
        </div>
      )}
    </section>
  );
}
