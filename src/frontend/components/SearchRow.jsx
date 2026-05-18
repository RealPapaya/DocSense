// SearchRow - advanced search controls panel (shown when toggled from Topbar).

function SearchRow({
  open = true,
  mode, setMode,
  view = 'documents', setView = () => {},
  wholeWord = false, setWholeWord = () => {},
  matchCase = false, setMatchCase = () => {},
  watchedDirs = [],
  pathPrefixes = [], setPathPrefixes = () => {},
  relatedTerms = [], setRelatedTerms = () => {},
}) {
  const T = useT();
  const [relatedDraft, setRelatedDraft] = React.useState('');
  const [pathsOpen, setPathsOpen] = React.useState(false);
  const pathControlRef = React.useRef(null);
  const isOccurrences = view === 'occurrences';
  const pathOptions = React.useMemo(() => {
    const seen = new Set();
    return (watchedDirs || [])
      .filter(Boolean)
      .map(path => String(path))
      .filter(path => {
        const key = path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [watchedDirs]);
  const normPath = React.useCallback(path => path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase(), []);

  React.useEffect(() => {
    const allowed = new Set(pathOptions.map(normPath));
    setPathPrefixes(prev => {
      const next = prev.filter(path => allowed.has(normPath(path)));
      if (next.length === prev.length && next.every((path, index) => path === prev[index])) return prev;
      return next;
    });
  }, [pathOptions, setPathPrefixes, normPath]);

  React.useEffect(() => {
    if (!pathsOpen) return;
    const onPointerDown = (event) => {
      if (pathControlRef.current && !pathControlRef.current.contains(event.target)) {
        setPathsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [pathsOpen]);

  const addRelated = React.useCallback((raw) => {
    const clean = raw.trim();
    if (!clean) return;
    setRelatedTerms(prev => {
      const exists = prev.some(t => t.toLowerCase() === clean.toLowerCase());
      return exists ? prev : [...prev, clean];
    });
    setRelatedDraft('');
  }, [setRelatedTerms]);

  const removeRelated = React.useCallback((term) => {
    setRelatedTerms(prev => prev.filter(t => t !== term));
  }, [setRelatedTerms]);

  const togglePath = React.useCallback((path) => {
    setPathPrefixes(prev => {
      if (prev.length === 0) return [path];
      const pathKey = normPath(path);
      const exists = prev.some(p => normPath(p) === pathKey);
      const next = exists ? prev.filter(p => normPath(p) !== pathKey) : [...prev, path];
      return next.length === pathOptions.length ? [] : next;
    });
  }, [setPathPrefixes, pathOptions.length, normPath]);

  const clearPaths = React.useCallback(() => {
    setPathPrefixes([]);
    setPathsOpen(false);
  }, [setPathPrefixes]);

  const pathLabel = pathPrefixes.length === 0
    ? T('search_all_paths')
    : (pathPrefixes.length === 1 ? pathPrefixes[0].split(/[\\/]/).filter(Boolean).pop() || pathPrefixes[0] : T('search_paths_count', { count: pathPrefixes.length }));

  return (
    <div className={'searchrow' + (open ? ' open' : ' closed')} aria-hidden={!open} inert={open ? undefined : ''}>
      <div className="advanced-panel">
                <div className={'mode segmented view-toggle view-' + view} role="tablist">
          <button
            className={view === 'documents' ? 'active' : ''}
            onClick={() => setView('documents')}
            data-tip={T('view_documents_tip')}
          >
            <span className="mdot"></span>{T('view_documents')}
          </button>
          <button
            className={view === 'occurrences' ? 'active' : ''}
            onClick={() => setView('occurrences')}
            data-tip={T('view_occurrences_tip')}
          >
            <span className="mdot"></span>{T('view_occurrences')}
          </button>
        </div>

        {!isOccurrences && (
          <div className={'mode segmented search-mode search-mode-' + mode} role="tablist">
            {[
              { id: 'bm25',     label: T('mode_keyword'),  sub: 'BM25'       },
              { id: 'hybrid',   label: T('mode_hybrid'),   sub: 'BM25 + vec' },
              { id: 'semantic', label: T('mode_semantic'), sub: 'vec'        },
            ].map(m => (
              m.id === 'semantic'
                ? <button key={m.id} className="" disabled data-tip={T('coming_soon')} style={{ opacity: 0.4, cursor: 'not-allowed', position: 'relative' }}>
                    <span className="mdot"></span>
                    {m.label}
                  </button>
                : <button key={m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)} data-tip={m.sub}>
                    <span className="mdot"></span>
                    {m.label}
                  </button>
            ))}
          </div>
        )}

        <button
          type="button"
          className={'option-btn' + (wholeWord ? ' active' : '')}
          onClick={() => setWholeWord(!wholeWord)}
          data-tip={T('whole_word_tip')}
          aria-pressed={wholeWord}
          aria-label={T('whole_word')}
        >
          <Icon.wholeWord />
        </button>

        <button
          type="button"
          className={'option-btn' + (matchCase ? ' active' : '')}
          onClick={() => setMatchCase(!matchCase)}
          data-tip={T('match_case_tip')}
          aria-pressed={matchCase}
          aria-label={T('match_case')}
        >
          <Icon.matchCase />
        </button>

        {pathOptions.length > 0 && (
          <div className={'path-scope-control' + (pathsOpen ? ' open' : '')} ref={pathControlRef}>
            <button
              type="button"
              className={'path-scope-trigger' + (pathPrefixes.length ? ' active' : '')}
              onClick={() => setPathsOpen(open => !open)}
              data-tip={T('search_path_scope')}
            >
              <Icon.folder />
              <span>{pathLabel}</span>
              <svg className="path-scope-caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
                <polyline points="2,3.5 5,6.5 8,3.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {pathsOpen && (
              <div className="path-scope-menu">
                <div className="fgroup-title path-scope-title">
                  <span>{T('search_path_scope')}</span>
                  {pathPrefixes.length > 0 && <span className="clear" onClick={clearPaths}>{T('f_clear')}</span>}
                </div>
                {pathOptions.map(path => {
                  const pathKey = normPath(path);
                  const selected = pathPrefixes.length === 0 || pathPrefixes.some(p => normPath(p) === pathKey);
                  const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
                  return (
                    <div
                      key={path}
                      className={'fitem fitem-dim path-scope-item' + (selected ? ' on' : '')}
                      onClick={() => togglePath(path)}
                    >
                      <span className="fitem-ico"><Icon.folder /></span>
                      <span className="label" title={path}>{name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="related-control">
          <span className="related-label">{T('related_terms')}</span>
          <div className="related-box">
            {relatedTerms.map(term => (
              <button key={term} className="related-chip" onClick={() => removeRelated(term)} type="button">
                {term}<span aria-hidden="true">x</span>
              </button>
            ))}
            <input
              value={relatedDraft}
              onChange={e => setRelatedDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addRelated(relatedDraft.replace(/,$/, ''));
                }
              }}
              onBlur={() => addRelated(relatedDraft)}
              placeholder={T('related_placeholder')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
