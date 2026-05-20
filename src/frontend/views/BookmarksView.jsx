// BookmarksView — full-screen list of saved bookmarks.

function BookmarksView({ bookmarks, setBookmarks, onBack }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const confirm = useConfirm();
  const [filterText, setFilterText] = React.useState('');
  const allItems = React.useMemo(
    () => Object.entries(bookmarks)
      .map(([key, b]) => ({ key, ...b }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)),
    [bookmarks],
  );
  const items = React.useMemo(() => {
    if (!filterText.trim()) return allItems;
    const q = filterText.toLowerCase();
    return allItems.filter(b =>
      (b.filename || '').toLowerCase().includes(q) ||
      (b.filepath || '').toLowerCase().includes(q) ||
      (b.snippet || '').toLowerCase().includes(q)
    );
  }, [allItems, filterText]);

  const remove = (key) => {
    const next = { ...bookmarks };
    delete next[key];
    setBookmarks(next);
    saveBookmarks(next);
  };

  const clearAll = async () => {
    const msg = T('bookmarks_clear_confirm', { count: allItems.length });
    const ok = await confirm(msg, { danger: true });
    if (ok) {
      setBookmarks({});
      saveBookmarks({});
    }
  };

  const openItem = (b) => {
    if (!b.doc_id) return;
    const fp = b.filepath || b.filename || '';
    const isPdf = fp.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      const pageParam = b.page ? '?page=' + b.page : '';
      fetch('/api/open/' + encodeURIComponent(b.doc_id) + pageParam, { method: 'POST' });
      return;
    }
    const hash = b.page ? '#page=' + b.page : '';
    window.open('/api/file/' + encodeURIComponent(b.doc_id) + hash, '_blank', 'noopener');
  };

  const downloadItem = (b) => {
    if (!b.doc_id) return;
    window.location.href = '/api/file/' + encodeURIComponent(b.doc_id) + '?download=1';
  };

  const formatDate = (ms) => {
    if (!ms) return '';
    try { return new Date(ms).toLocaleString(getLocale(lang)); }
    catch(e) { return ''; }
  };

  return (
    <section className="docs-view">
      <div className="docs-toolbar">
        <button className="iconbtn" onClick={onBack}>
          <Icon.back /> <span style={{ fontSize: 11 }}>{T('bookmarks_back')}</span>
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }}></div>
        <div className="searchbox" style={{ height: 28, flex: '0 1 260px' }}>
          <div className="glass"><Icon.search /></div>
          <input
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
            placeholder={T('bookmarks_filter')}
            style={{ fontSize: 12 }}
          />
        </div>
        <span className="spacer"></span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-faint)' }}>
          {items.length}{allItems.length !== items.length ? ' / ' + allItems.length : ''} {T('bookmarks_count_label')}
        </span>
        {allItems.length > 0 && (
          <>
            <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }}></div>
            <button className="iconbtn" onClick={clearAll} data-tip={T('bookmarks_clear_all')}>
              <Icon.trash /> <span style={{ fontSize: 11 }}>{T('bookmarks_clear_all')}</span>
            </button>
          </>
        )}
      </div>

      <div className="docs-body">
        {allItems.length === 0 ? (
          <div className="empty">
            <div>
              <div className="ico"><Icon.bookmark /></div>
              <div className="title">{T('bookmarks_empty')}</div>
              <div className="hint">{T('bookmarks_empty_hint')}</div>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="empty">
            <div>
              <div className="ico"><Icon.search /></div>
              <div className="title">{T('bookmarks_no_matches')}</div>
              <div className="hint">{T('bookmarks_no_matches_hint')}</div>
            </div>
          </div>
        ) : (
          <div className="result-list" style={{ padding: '12px 20px 24px' }}>
            {items.map((b, i) => {
              const ext = (b.filename || '').split('.').pop().toUpperCase();
              return (
                <div key={b.key} className="result">
                  <div className="num">#{String(i + 1).padStart(2, '0')}</div>
                  <div className="body">
                    <div className="result-row1">
                      {ext && <span className="tag">{ext}</span>}
                      <span className="specname">{b.filename || b.doc_id}</span>
                      <span className="spacer"></span>
                      {b.score > 0 && (
                        <span className={'score-pill' + scoreClass(b.score)}>
                          {b.score.toFixed(4)}
                        </span>
                      )}
                    </div>
                    <div className="result-row2">
                      {b.page > 0 && (
                        <>
                          <span className="pg">{T('page_short')} {b.page}</span>
                          <span className="sep">·</span>
                        </>
                      )}
                      <span className="section" style={{ color: 'var(--fg-muted)' }}>
                        {b.filepath || b.section}
                      </span>
                    </div>
                    {b.snippet && <div className="excerpt">{b.snippet}</div>}
                    <div className="result-row3" style={{ gap: 8 }}>
                      <button
                        className="iconbtn"
                        onClick={() => openItem(b)}
                        data-tip={b.filepath}
                      >
                        <Icon.external /> {T('bookmarks_open')}
                      </button>
                      <button className="iconbtn" onClick={() => downloadItem(b)}>
                        <Icon.download /> {T('download_pdf')}
                      </button>
                      <span className="spacer"></span>
                      <span style={{ fontSize: 11, color: 'var(--fg-faint)', fontFamily: 'var(--font-mono)' }}>
                        {formatDate(b.savedAt)}
                      </span>
                      <button
                        className="iconbtn"
                        onClick={() => remove(b.key)}
                        data-tip={T('bookmarks_remove')}
                      >
                        <Icon.trash />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
