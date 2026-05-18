// SearchRow - advanced search controls panel (shown when toggled from Topbar).

function SearchRow({
  open = true,
  mode, setMode,
  view = 'documents', setView = () => {},
  wholeWord = false, setWholeWord = () => {},
  matchCase = false, setMatchCase = () => {},
  relatedTerms = [], setRelatedTerms = () => {},
}) {
  const T = useT();
  const [relatedDraft, setRelatedDraft] = React.useState('');
  const isOccurrences = view === 'occurrences';

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
