// PreviewPanel - right-side panel: doc meta + score bars + tabbed body
// (context / match / metadata / related context) + action buttons (open / download / copy).

function RelatedTab({ result, results = [], onSelect }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const [chunks, setChunks] = React.useState(null);
  const [inlineChunk, setInlineChunk] = React.useState(null);
  const [mode, setMode] = React.useState('related');

  React.useEffect(() => {
    if (!result?.doc_id) return;
    setChunks(null);
    setInlineChunk(null);
    fetch('/api/chunks/' + encodeURIComponent(result.doc_id))
      .then(r => r.json())
      .then(d => setChunks(d.chunks || []))
      .catch(() => setChunks([]));
  }, [result?.doc_id]);

  if (!result) return null;

  const currentPage = result.page || 0;
  const otherChunks = chunks || [];
  const relatedChunks = results;
  const visibleChunks = mode === 'related'
    ? relatedChunks.map(r => ({
        key: r.id,
        page: r.page,
        text: r.context?.match || r.excerpt || r.snippet || '',
        preview: r.excerpt || r.snippet || r.context?.match || '',
        highlight: r.matchHighlight || r.matchSpans || r.highlight || [],
        resultId: r.id,
        isCurrentResult: r.id === result.id,
        isSearchHit: true,
      }))
    : otherChunks.map((chunk, index) => {
        const match = results.find(r =>
          r.doc_id === result.doc_id
          && (
            (Number.isFinite(chunk.chunk_index) && r.chunk_index === chunk.chunk_index)
            || (!Number.isFinite(chunk.chunk_index) && (r.page || 0) === (chunk.page || 0))
          )
        );
        return {
          key: chunk.chunk_index ?? chunk.page ?? index,
          chunk_index: chunk.chunk_index,
          page: chunk.page,
          text: chunk.text || '',
          preview: chunk.text || '',
          highlight: match ? (match.matchHighlight || match.matchSpans || match.highlight || []) : [],
          isSearchHit: !!match,
        };
      });

  const handleChunkClick = (chunk) => {
    setInlineChunk(inlineChunk?.key === chunk.key ? null : chunk);
  };

  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={'iconbtn' + (mode === 'related' ? ' on' : '')} onClick={() => { setMode('related'); setInlineChunk(null); }}>
          {T('related_chunks')} · {relatedChunks.length}
        </button>
                <button
          className={'iconbtn' + (mode === 'other' ? ' on' : '')}
          onClick={() => { setMode('other'); setInlineChunk(null); }}
          style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {T('all_chunks_from')}
        </button>
      </div>
            {mode === 'other' && (
        <div style={{ marginBottom: 10, color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          <strong style={{ color: 'var(--fg)' }}>{result.spec}</strong>
          <span style={{ marginLeft: 6, color: 'var(--fg-faint)' }}>· {otherChunks.length} {lang === 'zh' ? '段落' : 'chunks'}</span>
        </div>
      )}
      {mode === 'other' && chunks === null && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {visibleChunks.map(chunk => {
          const isCurrent = chunk.isCurrentResult || (mode === 'other' && (chunk.page || 0) === currentPage && Math.abs(chunk.chunk_index - (result.context?.chunkIndex ?? -99)) < 2);
          const isInline = inlineChunk?.key === chunk.key;
          return (
            <div key={chunk.key}>
              <button
                onClick={() => handleChunkClick(chunk)}
                style={{
                  width: '100%', textAlign: 'left', padding: '5px 8px',
                  background: isCurrent ? 'var(--bg-selected)' : isInline ? 'var(--accent-soft)' : 'var(--bg-soft)',
                  border: '1px solid ' + (isCurrent ? 'var(--border-focus)' : isInline ? 'color-mix(in srgb, var(--accent) 35%, var(--border))' : 'var(--border)'),
                  borderRadius: 5, cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 8,
                  transition: 'background 0.1s, border-color 0.1s',
                  color: 'var(--fg)',
                }}
                onMouseEnter={e => { if (!isCurrent && !isInline) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (!isCurrent && !isInline) e.currentTarget.style.background = 'var(--bg-soft)'; }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--fg-faint)', flexShrink: 0, minWidth: 40 }}>
                  {lang === 'zh' ? '頁 ' : 'p.'}{chunk.page || '-'}
                </span>
                <span style={{ color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: 11.5 }}>
                  {(chunk.preview || chunk.text || '').slice(0, 80)}
                </span>
                {mode === 'other' && chunk.isSearchHit && !isCurrent && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--accent)', flexShrink: 0 }}>
                    {lang === 'zh' ? '命中' : 'hit'}
                  </span>
                )}
                {mode === 'other' && chunk.resultId && onSelect && !isCurrent && (
                  <span
                    onClick={e => { e.stopPropagation(); onSelect(chunk.resultId); }}
                    style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--fg-muted)', flexShrink: 0 }}
                  >
                    {T('select_chunk')}
                  </span>
                )}
                {isCurrent && (
                  <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--border-focus)', flexShrink: 0 }}>
                    *
                  </span>
                )}
              </button>
              {isInline && (
                <div style={{
                  margin: '2px 0 4px', padding: '8px 10px',
                  background: 'var(--bg)', border: '1px solid color-mix(in srgb, var(--accent) 25%, var(--border))',
                  borderRadius: 5, fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap',
                  color: 'var(--fg)',
                }}>
                  {highlightText(chunk.text, chunk.highlight)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewPanel({ result, results = [], onSelect, bookmarks = {}, setBookmarks = () => {} }) {
  const T = useT();
  const [tab, setTab] = React.useState('context');
  const [copiedAction, setCopiedAction] = React.useState('');
  const copiedTimerRef = React.useRef(null);

  const showCopied = React.useCallback((action) => {
    window.clearTimeout(copiedTimerRef.current);
    setCopiedAction(action);
    copiedTimerRef.current = window.setTimeout(() => setCopiedAction(''), 900);
  }, []);

  React.useEffect(() => {
    return () => window.clearTimeout(copiedTimerRef.current);
  }, []);

  if (!result) {
    return (
      <section className="preview">
        <div className="empty">
          <div>
            <div className="ico"><Icon.page /></div>
            {T('empty_msg')}
          </div>
        </div>
      </section>
    );
  }

  const bmKey = bookmarkKey(result.doc_id, result.page);
  const isBookmarked = !!bookmarks[bmKey];

  const toggleBookmark = () => {
    const next = { ...bookmarks };
    if (next[bmKey]) delete next[bmKey];
    else             next[bmKey] = bookmarkPayload(result);
    setBookmarks(next);
    saveBookmarks(next);
  };

  const fileUrl = (download) => {
    if (!result.doc_id) return null;
    const q = download ? '?download=1' : '';
    const hash = !download && result.page ? '#page=' + result.page : '';
    return '/api/file/' + encodeURIComponent(result.doc_id) + q + hash;
  };

  const openFile = () => {
    const fp = result.filepath || '';
    const isPdf = fp.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      const url = fileUrl(false);
      if (url) window.open(url, '_blank', 'noopener');
    } else if (result.doc_id) {
      fetch('/api/open/' + encodeURIComponent(result.doc_id), { method: 'POST' });
    }
  };

  const downloadFile = () => {
    const url = fileUrl(true);
    if (url) window.location.href = url;
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(result.context.match || result.excerpt || '');
      showCopied('text');
    } catch(e) {}
  };

  const copyCitation = async () => {
    const cite = result.spec + (result.page ? ', p. ' + result.page : '');
    try {
      await navigator.clipboard.writeText(cite);
      showCopied('citation');
    } catch(e) {}
  };

  const fused = result.score, bm = result.bm25, sem = result.semantic;
  const metaJson = [
    '{',
    '  "doc_id":      "' + result.specShort.toLowerCase() + '",',
    '  "vendor":      "' + result.vendor + '",',
    '  "spec_type":   "' + result.type + '",',
    '  "category":    "' + result.category + '",',
    '  "version":     "' + result.version + '",',
    '  "published":   "' + result.date + '",',
    '  "page":        ' + result.page + ',',
    '  "section":     "' + result.section + '",',
    '  "chunk_id":    "' + result.id + '_p' + result.page + '_s4",',
    '  "tokens":      342,',
    '  "lang":        "en-US",',
    '  "embedder":    "bge-large-en-v1.5",',
    '  "fused_score": ' + result.score,
    '}'
  ].join('\n');

  return (
    <section className="preview">
      <div className="preview-meta">
        <div className="metaitem preview-doc-item"><span className="l">{T('meta_doc')}</span><span className="v mono">{result.specShort}</span></div>
        <div className="preview-meta-actions">
          <button
            className="iconbtn"
            onClick={toggleBookmark}
            data-tip={isBookmarked ? T('bookmark_added') : T('bookmark_add')}
            style={isBookmarked ? { color: 'var(--accent)' } : null}
          >
            {isBookmarked ? <Icon.bookmarkFill /> : <Icon.bookmark />}
          </button>
          <button className="iconbtn" onClick={openFile} data-tip={result.filepath}>
            <Icon.external /> {T('open')}
          </button>
        </div>
        <div className="metaitem align-right"><span className="l">{T('meta_page')}</span><span className="v mono">{result.page}</span></div>
      </div>

      <div className="preview-scoring">
        <div className="barwrap">
          <div className="lab"><span className="name" data-tip={T('score_fused_tip')}><span className="dot fused"></span>{T('score_fused')}</span><span className="val">{fused.toFixed(4)}</span></div>
          <div className="bar"><div style={{ width: fused * 100 + '%', background: 'var(--accent)' }}></div></div>
        </div>
        <div className="barwrap">
          <div className="lab"><span className="name" data-tip={T('score_bm25_tip')}><span className="dot bm"></span>BM25</span><span className="val">{bm.toFixed(4)}</span></div>
          <div className="bar"><div style={{ width: bm * 100 + '%', background: '#f59e0b' }}></div></div>
        </div>
        <div className="barwrap">
          <div className="lab"><span className="name" data-tip={T('score_cos_tip')}><span className="dot sem"></span>cos</span><span className="val">{sem.toFixed(4)}</span></div>
          <div className="bar"><div style={{ width: sem * 100 + '%', background: '#8b5cf6' }}></div></div>
        </div>
      </div>

      <div className="preview-tabs">
        <button className={tab === 'context'  ? 'active' : ''} onClick={() => setTab('context')} >{T('tab_context')}</button>
        <button className={tab === 'match'    ? 'active' : ''} onClick={() => setTab('match')}   >{T('tab_match')}</button>
        <button className={tab === 'metadata' ? 'active' : ''} onClick={() => setTab('metadata')}>{T('tab_metadata')}</button>
        <button className={tab === 'related'  ? 'active' : ''} onClick={() => setTab('related')} >{T('tab_related_context')}</button>
      </div>

      <div className="preview-body preview-text">
        {tab === 'context' && <>
          <div className="ctx-block">
            <div className="ctx-label">{T('ctx_preceding')} · {T('page_short')} {result.page - 1}</div>
            {highlightText(result.context.before, [])}
          </div>
          <div className="ctx-block match">
            <div className="ctx-label">
              {T('ctx_matched')} · {T('page_short')} {result.page}
              {result.view === 'occurrences' && Number.isFinite(result.matchPosition) && (
                <span className="ctx-occ-pos"> · {T('match_at')} #{result.matchPosition}</span>
              )}
              {result.occurrencesInChunk > 1 && (
                <span className="ctx-occ-count"> · {result.occurrencesInChunk} {T('matches_n')}</span>
              )}
            </div>
            {highlightText(result.context.match, result.matchHighlight || result.highlight)}
          </div>
          <div className="ctx-block">
            <div className="ctx-label">{T('ctx_following')} · {T('page_short')} {result.page + 1}</div>
            {highlightText(result.context.after, [])}
          </div>
        </>}
        {tab === 'match' && <>
          <h3 className="section-h">{T('matched_only')}</h3>
          <div style={{ whiteSpace: 'pre-wrap' }}>{highlightText(result.context.match, result.matchHighlight || result.highlight)}</div>
        </>}
        {tab === 'metadata' && (
          <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{metaJson}</pre>
        )}
        {tab === 'related' && (
          <RelatedTab result={result} results={results} onSelect={onSelect} />
        )}
      </div>

      <div className="preview-actions">
        <button
          className={'iconbtn copy-action-btn' + (copiedAction === 'citation' ? ' copied' : '')}
          onClick={copyCitation}
        >
          {copiedAction === 'citation' ? <Icon.check /> : <Icon.copy />} {T('copy_citation')}
        </button>
        <button
          className={'iconbtn copy-action-btn' + (copiedAction === 'text' ? ' copied' : '')}
          onClick={copyText}
        >
          {copiedAction === 'text' ? <Icon.check /> : <Icon.copy />} {T('copy_text')}
        </button>
        <span className="spacer"></span>
        <button className="iconbtn" onClick={downloadFile}><Icon.download /> {T('download_pdf')}</button>
      </div>
    </section>
  );
}
