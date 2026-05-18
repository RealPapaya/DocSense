// App — top-level component. Wires state (search results, filters, prefs,
// tweaks, bookmarks, view routing), data fetching (/api/search, /api/status),
// preference persistence, and the resizable layout. Must load LAST.

function App() {
  const saved = React.useMemo(loadPrefs, []);

  const [theme,    setTheme]    = React.useState(saved.theme    || 'light');
  const [lang,     setLang]     = React.useState(saved.lang     || 'en');
  const [query,    setQuery]    = React.useState('');
  const [mode,     setMode]     = React.useState('hybrid');
  const [searchView, setSearchView] = React.useState('documents');
  const [wholeWord, setWholeWord] = React.useState(false);
  const [matchCase, setMatchCase] = React.useState(false);
  const [relatedTerms, setRelatedTerms] = React.useState([]);
  const [filters,  setFilters]  = React.useState({ vendor: [], type: [], category: [], tags: [], folder: [] });
  const [selectedId, setSelectedId] = React.useState(null);
  const [sortKey,  setSortKey]  = React.useState('score');
  const [cardMode, setCardMode] = React.useState(saved.cardMode || 'detailed');
  const [totalMs, setTotalMs]   = React.useState(0);
  const [summary, setSummary]   = React.useState({
    view: 'documents', totalOccurrences: 0, totalChunks: 0, totalDocuments: 0,
    capped: false, offset: 0, limit: null,
  });
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);

  // Tags data (custom tags + assignments, persisted in localStorage)
  const [tagsData, setTagsData] = React.useState(loadTagsData);

  // API state
  const [results,     setResults]     = React.useState([]);
  const [loading,     setLoading]     = React.useState(false);
  const [error,       setError]       = React.useState(null);
  const [hasSearched, setHasSearched] = React.useState(false);
  const [status,      setStatus]      = React.useState({ ok: false, total_documents: 0, total_chunks: 0, collection_points: 0 });

  // View routing: 'search' (default), 'bookmarks', or 'documents'
  const [view, setView] = React.useState('search');

  // Rail resize (left: filters | results)
  const [railW, setRailW] = React.useState(240);
  const resizerPillRef = React.useRef(null);
  React.useEffect(() => {
    document.documentElement.style.setProperty('--rail-w', railW + 'px');
  }, [railW]);
  const onResizerMouseDown = React.useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = railW;
    resizerPillRef.current?.classList.add('dragging');
    const onMove = (ev) => {
      const next = Math.max(140, Math.min(480, startW + ev.clientX - startX));
      setRailW(next);
    };
    const onUp = () => {
      resizerPillRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [railW]);

  // Preview resize (right: results | preview)
  const [previewW, setPreviewW] = React.useState(460);
  const previewPillRef = React.useRef(null);
  React.useEffect(() => {
    document.documentElement.style.setProperty('--preview-w', previewW + 'px');
  }, [previewW]);
  const onPreviewResizerMouseDown = React.useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewW;
    previewPillRef.current?.classList.add('dragging');
    const onMove = (ev) => {
      const next = Math.max(300, Math.min(800, startW - (ev.clientX - startX)));
      setPreviewW(next);
    };
    const onUp = () => {
      previewPillRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [previewW]);

  // Bookmarks (lifted up so Topbar count + Bookmarks page + PreviewPanel share one source)
  const [bookmarks, setBookmarks] = React.useState(loadBookmarks);
  const bookmarkCount = Object.keys(bookmarks).length;
  const [settingsLoaded, setSettingsLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    loadLocalSettingsFile()
      .then(settings => {
        if (!alive) return;
        const hasLocalFile = !!(settings && settings._exists);
        const prefs = settings && settings.prefs && typeof settings.prefs === 'object' ? settings.prefs : {};
          if (Object.keys(prefs).length) {
          if (prefs.theme) setTheme(prefs.theme);
          if (prefs.lang) setLang(prefs.lang);
          if (prefs.cardMode) setCardMode(prefs.cardMode);
          const nextTweaks = {};
          ['layout', 'density', 'accent', 'fontSans', 'fontMono', 'fontDisplay', 'cardMode', 'highlight'].forEach(key => {
            if (prefs[key]) nextTweaks[key] = prefs[key];
          });
          // Backward compatibility: migrate old 'typeset' to individual fonts
          if (prefs.typeset && !prefs.fontSans && !prefs.fontMono && !prefs.fontDisplay) {
            if (prefs.typeset === 'inter-mono') {
              nextTweaks.fontSans = 'inter';
              nextTweaks.fontMono = 'jetbrains-mono';
              nextTweaks.fontDisplay = 'inter';
            } else if (prefs.typeset === 'ibm-plex') {
              nextTweaks.fontSans = 'ibm-plex-sans';
              nextTweaks.fontMono = 'ibm-plex-mono';
              nextTweaks.fontDisplay = 'ibm-plex-sans';
            } else if (prefs.typeset === 'serif-mono') {
              nextTweaks.fontSans = 'inter';
              nextTweaks.fontMono = 'jetbrains-mono';
              nextTweaks.fontDisplay = 'source-serif';
            }
          }
          setTweakState(prev => ({ ...prev, ...nextTweaks }));
        }
        if (settings && settings.tags && Array.isArray(settings.tags.customTags)) {
          const hasTags = settings.tags.customTags.length || Object.keys(settings.tags.assignments || {}).length;
          if (hasLocalFile || hasTags) {
            setTagsData(settings.tags);
            try { localStorage.setItem(TAGS_KEY, JSON.stringify(settings.tags)); } catch(e) {}
          }
        }
        if (settings && settings.bookmarks && typeof settings.bookmarks === 'object') {
          if (hasLocalFile || Object.keys(settings.bookmarks).length) {
            setBookmarks(settings.bookmarks);
            try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(settings.bookmarks)); } catch(e) {}
          }
        }
      })
      .finally(() => { if (alive) setSettingsLoaded(true); });
    return () => { alive = false; };
  }, []);

  const refreshStatus = React.useCallback(async () => {
    try {
      const r = await fetch('/api/status');
      if (!r.ok) throw new Error('status ' + r.status);
      const d = await r.json();
      setStatus({ ok: true, ...d });
      return d;
    } catch(e) {
      setStatus(s => ({ ...s, ok: false }));
      return null;
    }
  }, []);

  // Poll backend status so the topbar dot reflects reality.
  React.useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 10000);
    return () => clearInterval(id);
  }, [refreshStatus]);

          const [tweaks, setTweakState] = React.useState({
    layout:      saved.layout      || 'sidebar',
    density:     saved.density     || 'balanced',
    accent:      saved.accent      || 'indigo',
    fontSans:    saved.fontSans    || 'jetbrains-mono',
    fontMono:    saved.fontMono    || 'jetbrains-mono',
    fontDisplay: saved.fontDisplay || 'jetbrains-mono',
    cardMode:    saved.cardMode    || 'detailed',
    highlight:   saved.highlight    || 'yellow',
  });

  const setTweak = React.useCallback((keyOrObj, val) => {
    const edits = typeof keyOrObj === 'object' ? keyOrObj : { [keyOrObj]: val };
    setTweakState(prev => ({ ...prev, ...edits }));
  }, []);

  const [perfMode, setPerfModeState] = React.useState('balanced');
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/perf-mode')
      .then(r => r.json())
      .then(d => { if (!cancelled && d && d.mode) setPerfModeState(d.mode); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const setPerfMode = React.useCallback((mode) => {
    setPerfModeState(mode);
    fetch('/api/perf-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).catch(() => {});
  }, []);

  // Persist preferences to localStorage and, after startup load, to the .local file.
  React.useEffect(() => {
    const data = { theme, lang, ...tweaks };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch(e) {}
    if (settingsLoaded) saveLocalSettingsPatch({ prefs: data });
  }, [theme, lang, tweaks, settingsLoaded]);

  React.useEffect(() => {
    if (settingsLoaded) saveLocalSettingsPatch({ tags: tagsData });
  }, [tagsData, settingsLoaded]);

  React.useEffect(() => {
    if (settingsLoaded) saveLocalSettingsPatch({ bookmarks });
  }, [bookmarks, settingsLoaded]);

        // Apply all preferences to the document root
  React.useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme       = theme;
    r.dataset.layout      = tweaks.layout;
    r.dataset.density     = tweaks.density;
    r.dataset.accent      = tweaks.accent;
    r.dataset.fontSans    = tweaks.fontSans;
    r.dataset.fontMono    = tweaks.fontMono;
    r.dataset.fontDisplay = tweaks.fontDisplay;
    r.dataset.card        = tweaks.cardMode;
    r.dataset.highlight   = tweaks.highlight;
    r.lang                = getHtmlLang(lang);
  }, [theme, lang, tweaks]);

  const allResults = results;

  const buildSearchUrl = React.useCallback((q, opts) => {
    const params = new URLSearchParams();
    params.set('q', q);
    params.set('view', opts.view);
    params.set('whole_word', opts.wholeWord ? 'true' : 'false');
    params.set('match_case', opts.matchCase ? 'true' : 'false');
    (opts.relatedTerms || []).forEach(term => {
      if (term.trim()) params.append('related_terms', term.trim());
    });
    if (opts.view === 'documents') {
      params.set('mode', opts.mode === 'bm25' ? 'keyword' : opts.mode);
    } else {
      params.set('mode', 'keyword');
      params.set('limit', String(opts.limit ?? 200));
      params.set('offset', String(opts.offset ?? 0));
    }
    return '/api/search?' + params.toString();
  }, []);

  const onSearch = React.useCallback(async () => {
    if (!query.trim()) return;
    const t0 = Date.now();
    setLoading(true);
    setError(null);
    try {
      const url = buildSearchUrl(query, { view: searchView, mode, wholeWord, matchCase, relatedTerms, offset: 0 });
      const res = await fetch(url);
      if (!res.ok) throw new Error('Server error ' + res.status);
      const data = await res.json();
      const mapFn = searchView === 'occurrences' ? mapOccurrence : mapResult;
      const mapped = (data.results || []).map((r, i) => mapFn(r, query, i));
      setResults(mapped);
      setSummary({
        view: data.view || searchView,
        totalOccurrences: data.total_occurrences || 0,
        totalChunks:      data.total_chunks      || 0,
        totalDocuments:   data.total_documents   || 0,
        capped:           !!data.capped,
        offset:           data.offset || 0,
        limit:            data.limit  ?? null,
      });
      setTotalMs(data.took_ms != null ? Math.round(data.took_ms) : Date.now() - t0);
      setHasSearched(true);
      setSelectedId(mapped.length > 0 ? mapped[0].id : null);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [query, mode, searchView, wholeWord, matchCase, relatedTerms, buildSearchUrl]);

  const onLoadMore = React.useCallback(async () => {
    if (loadingMore || searchView !== 'occurrences') return;
    if (!summary.limit || results.length >= summary.totalOccurrences) return;
    setLoadingMore(true);
    try {
      const nextOffset = results.length;
      const url = buildSearchUrl(query, {
        view: searchView, mode, wholeWord, matchCase, relatedTerms, offset: nextOffset, limit: summary.limit,
      });
      const res = await fetch(url);
      if (!res.ok) throw new Error('Server error ' + res.status);
      const data = await res.json();
      const startIdx = results.length;
      const more = (data.results || []).map((r, i) => mapOccurrence(r, query, startIdx + i));
      setResults(prev => [...prev, ...more]);
    } catch(e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [query, mode, searchView, wholeWord, matchCase, relatedTerms, loadingMore, summary, results.length, buildSearchUrl]);

  const watchedDir = status.watched_docs_dir || '';
  const watchedDirs = Array.isArray(status.watched_docs_dirs) && status.watched_docs_dirs.length
    ? status.watched_docs_dirs
    : (watchedDir ? [watchedDir] : []);
  const filtered = React.useMemo(() => {
    const bases = watchedDirs.map(path => path.replace(/\\/g, '/').replace(/\/$/, '')).filter(Boolean);
    let rs = allResults.filter(r => {
      if (filters.vendor.length && !filters.vendor.includes(r.vendor)) return false;
      if (filters.type.length   && filters.type.includes(r.type))      return false;
      if (filters.folder && filters.folder.length) {
        const fp = (r.filepath || '').replace(/\\/g, '/');
        const base = bases.find(base => fp === base || fp.startsWith(base + '/'));
        let rel = fp;
        if (base) {
          rel = fp.slice(base.length).replace(/^\//, '');
          if (bases.length > 1) {
            const rootName = base.split('/').filter(Boolean).pop() || base;
            rel = rel ? `${rootName}/${rel}` : rootName;
          }
        }
        const excluded = filters.folder.some(prefix => prefix === '' ? true : (rel === prefix || rel.startsWith(prefix + '/')));
        if (excluded) return false;
      }
      if (filters.tags && filters.tags.length) {
        const assigned = tagsData.assignments[r.doc_id] || [];
        const excluded = filters.tags.some(key => {
          if (key.startsWith('custom:')) return assigned.includes(key.slice(7));
          return false;
        });
        if (excluded) return false;
      }
      return true;
    });
    // Occurrences view: preserve backend's document-order traversal (Ctrl+F feel).
    // Score sort would scramble multi-doc results since chunks of the same doc
    // share BM25 — only the across-doc order would change, breaking the flow.
    if (summary.view !== 'occurrences') {
      if (sortKey === 'name') rs = [...rs].sort((a, b) => a.spec.localeCompare(b.spec));
      else                    rs = [...rs].sort((a, b) => b.score - a.score);
    }
    return rs;
  }, [filters, sortKey, allResults, tagsData, watchedDirs, summary.view]);

  React.useEffect(() => {
    if (filtered.length && !filtered.find(r => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected   = filtered.find(r => r.id === selectedId) || null;
  const openPrefs  = () => window.postMessage({ type: '__activate_edit_mode' }, '*');
  const T = React.useCallback((key, vars) => translate(lang, key, vars), [lang]);
  const prefsTitle = T('settings');

  const inBookmarks = view === 'bookmarks';
  const inDocuments = view === 'documents';
  const inSearch    = !inBookmarks && !inDocuments;

  return (
    <LangCtx.Provider value={lang}>
    <ConfirmDialogProvider>
      <div className="app">
        <Topbar
          onOpenPrefs={openPrefs}
          status={status}
          view={view} setView={setView}
          bookmarkCount={bookmarkCount}
          query={query} setQuery={setQuery}
          onSearch={onSearch}
          advancedOpen={advancedOpen} setAdvancedOpen={setAdvancedOpen}
        />
        {inSearch && (
          <SearchRow
            open={advancedOpen}
            mode={mode} setMode={setMode}
            view={searchView} setView={setSearchView}
            wholeWord={wholeWord} setWholeWord={setWholeWord}
            matchCase={matchCase} setMatchCase={setMatchCase}
            relatedTerms={relatedTerms} setRelatedTerms={setRelatedTerms}
          />
        )}
        {inSearch && <TopFilters filters={filters} setFilters={setFilters} allResults={allResults} />}
        <div className={`main ${(inSearch && !hasSearched) ? 'empty-state' : ''}`}>
          {inDocuments ? (
            <DocumentsView
              onBack={() => setView('search')}
              tagsData={tagsData}
              setTagsData={setTagsData}
              watchedDir={watchedDir}
              watchedDirs={watchedDirs}
              onWatchDirChanged={refreshStatus}
            />
          ) : inBookmarks ? (
            <BookmarksView
              bookmarks={bookmarks}
              setBookmarks={setBookmarks}
              onBack={() => setView('search')}
            />
          ) : loading ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'var(--fg2)', fontSize: 15 }}>
              <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              {T('search_loading')}
            </div>
          ) : error ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--fg2)', fontSize: 15 }}>
              <div style={{ fontSize: 32 }}>⚠</div>
              <div style={{ fontWeight: 600 }}>{T('search_failed')}</div>
              <div style={{ fontSize: 13, opacity: 0.7 }}>{error}</div>
            </div>
          ) : !hasSearched ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, color: 'var(--fg2)', textAlign: 'center', padding: '0 32px' }}>
              <div style={{ fontSize: 48, opacity: 0.3 }}>🔍</div>
              <div style={{ fontSize: 18, fontWeight: 600, opacity: 0.6 }}>{T('search_empty_title')}</div>
              <div style={{ fontSize: 13, opacity: 0.45, maxWidth: 320 }}>
                {T('search_empty_hint')}
              </div>
            </div>
          ) : (
            <>
              <FiltersRail filters={filters} setFilters={setFilters} allResults={allResults} tagsData={tagsData} watchedDir={watchedDir} watchedDirs={watchedDirs} />
              <div className="resizer" onMouseDown={onResizerMouseDown}>
                <div ref={resizerPillRef} className="resizer-pill" />
              </div>
              <ResultsPanel
                results={filtered}
                selectedId={selectedId}
                onSelect={setSelectedId}
                sortKey={sortKey}
                setSortKey={setSortKey}
                cardMode={cardMode}
                setCardMode={c => { setCardMode(c); setTweak('cardMode', c); }}
                totalMs={totalMs}
                tagsData={tagsData}
                view={summary.view}
                summary={summary}
                onLoadMore={onLoadMore}
                loadingMore={loadingMore}
              />
              <div className="resizer" onMouseDown={onPreviewResizerMouseDown}>
                <div ref={previewPillRef} className="resizer-pill" />
              </div>
              <PreviewPanel result={selected} results={filtered} onSelect={setSelectedId} bookmarks={bookmarks} setBookmarks={setBookmarks} />
            </>
          )}
        </div>
        <StatusBar totalMs={totalMs} mode={mode} results={filtered} summary={summary} />

        <TweaksPanel title={prefsTitle}>

          <TweakSection label={T('tw_language')}>
            <TweakRadio
              label={T('tw_interface_language')}
              value={lang}
              onChange={v => setLang(v)}
              options={[{ value: 'en', label: 'English' }, { value: 'zh', label: T('tw_zh') }]}
            />
          </TweakSection>

          <TweakSection label={T('tw_appearance')}>
            <TweakRadio
              label={T('tw_theme')}
              value={theme}
              onChange={v => setTheme(v)}
              options={[
                { value: 'light', label: T('tw_light') },
                { value: 'dark',  label: T('tw_dark')  },
              ]}
            />
            <TweakSelect
              label={T('tw_accent')}
              value={tweaks.accent}
              onChange={v => setTweak('accent', v)}
              options={[
                { value: 'indigo',  label: T('tw_indigo') },
                { value: 'emerald', label: T('tw_emerald') },
                { value: 'amber',   label: T('tw_amber') },
                { value: 'slate',   label: T('tw_slate') },
              ]}
            />
            <TweakRadio
              label={T('tw_highlight')}
              value={tweaks.highlight}
              onChange={v => setTweak('highlight', v)}
              options={[
                { value: 'yellow',    label: T('tw_yellow') },
                { value: 'underline', label: T('tw_underline') },
                { value: 'bold',      label: T('tw_bold') },
              ]}
            />
          </TweakSection>

            <TweakSection label={T('tw_typography')}>
            <TweakSelect
              label={T('tw_body_font')}
              value={tweaks.fontSans}
              onChange={v => setTweak('fontSans', v)}
              options={[
                { value: 'inter',          label: 'Inter' },
                { value: 'ibm-plex-sans',  label: 'IBM Plex Sans' },
                { value: 'jetbrains-mono', label: 'JetBrains Mono' },
                { value: 'system',         label: T('tw_system_font') },
              ]}
            />
            <TweakSelect
              label={T('tw_mono_font')}
              value={tweaks.fontMono}
              onChange={v => setTweak('fontMono', v)}
              options={[
                { value: 'jetbrains-mono', label: 'JetBrains Mono' },
                { value: 'ibm-plex-mono',  label: 'IBM Plex Mono' },
                { value: 'fira-code',      label: 'Fira Code' },
                { value: 'consolas',       label: 'Consolas' },
              ]}
            />
            <TweakSelect
              label={T('tw_display_font')}
              value={tweaks.fontDisplay}
              onChange={v => setTweak('fontDisplay', v)}
              options={[
                { value: 'inter',          label: 'Inter' },
                { value: 'ibm-plex-sans',  label: 'IBM Plex Sans' },
                { value: 'source-serif',   label: 'Source Serif 4' },
                { value: 'jetbrains-mono', label: 'JetBrains Mono' },
                { value: 'system',         label: T('tw_system_font') },
              ]}
            />
          </TweakSection>

          <TweakSection label={T('tw_layout')}>
            <TweakRadio
              label={T('tw_filters_pos')}
              value={tweaks.layout}
              onChange={v => setTweak('layout', v)}
              options={[
                { value: 'sidebar',    label: T('tw_sidebar') },
                { value: 'topfilters', label: T('tw_topbar') },
              ]}
            />
            <TweakRadio
              label={T('tw_result_card')}
              value={tweaks.cardMode}
              onChange={v => { setTweak('cardMode', v); setCardMode(v); }}
              options={[
                { value: 'detailed', label: T('layout_detailed') },
                { value: 'compact',  label: T('layout_compact')  },
              ]}
            />
            <TweakSelect
              label={T('tw_density')}
              value={tweaks.density}
              onChange={v => setTweak('density', v)}
              options={[
                { value: 'compact',  label: T('tw_density_compact') },
                { value: 'balanced', label: T('tw_density_balanced') },
                { value: 'spacious', label: T('tw_density_spacious') },
              ]}
            />
          </TweakSection>

          <TweakSection label={T('tw_performance')}>
            <TweakRadio
              label={T('tw_perf_mode')}
              value={perfMode}
              onChange={setPerfMode}
              options={[
                { value: 'power_saver', label: T('tw_perf_power_saver') },
                { value: 'balanced',    label: T('tw_perf_balanced') },
                { value: 'max_speed',   label: T('tw_perf_max_speed') },
              ]}
            />
            <div style={{ color: 'var(--fg-faint)', fontSize: 11, lineHeight: 1.45 }}>
              {T('tw_perf_hint')}
            </div>
          </TweakSection>

        </TweaksPanel>
      </div>
    </ConfirmDialogProvider>
    </LangCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
