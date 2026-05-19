// DocumentsView — full-screen "Files" view (explorer + list, tag sidebar).

// Shape: { files: {doc_id: {pct, phase, filename}}, batch: {active, total, completed, current_file, current_phase, started_at, finished_at} }
var IndexProgressCtx = React.createContext({ files: {}, batch: { active: false } });

function _docPct(progress, docId) {
  const entry = progress && progress.files && progress.files[docId];
  return entry && typeof entry.pct === 'number' ? entry.pct : 0;
}

function IndexingHeader({ progress }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const batch = (progress && progress.batch) || {};
  const files = (progress && progress.files) || {};
  const inflight = Object.values(files).filter(f => (f.pct ?? 0) < 100);
  // Show during a manual batch (batch.active), during the linger window
  // (batch.finished_at set), OR when the watchdog is mid-flight on a
  // single file outside any batch.
  if (!batch.active && !batch.finished_at && inflight.length === 0) return null;

  let total, completed, ratio, file, phaseRaw;
  if (batch.active || batch.finished_at) {
    total = Math.max(1, batch.total || 0);
    completed = Math.min(total, batch.completed || 0);
    ratio = Math.min(1, completed / total);
    file = batch.current_file || (inflight[0] && inflight[0].filename) || '';
    phaseRaw = batch.current_phase || (inflight[0] && inflight[0].phase);
  } else {
    // Watcher-driven single-file flow.
    const cur = inflight[0];
    total = 1;
    completed = 0;
    ratio = (cur.pct ?? 0) / 100;
    file = cur.filename || '';
    phaseRaw = cur.phase;
  }
  const phaseLabel = phaseRaw
    ? (translate(lang, 'docs_indexing_phase_' + phaseRaw) || phaseRaw)
    : '';
  const done = !batch.active && batch.finished_at && inflight.length === 0;
  return (
    <div className={'indexing-header' + (done ? ' done' : '')} role="status" aria-live="polite">
      <div className="indexing-header-row">
        <span className="indexing-header-label">
          {done ? T('docs_indexing_done') : T('docs_indexing_header')} {completed}/{batch.total || 0}
          {!done && file ? <> — <span className="indexing-header-file" title={file}>{file}</span></> : null}
          {!done && phaseLabel ? <span className="indexing-header-phase">({phaseLabel})</span> : null}
        </span>
        <span className="indexing-header-pct">{Math.round(ratio * 100)}%</span>
      </div>
      <div className="indexing-header-bar">
        <div className="indexing-header-bar-fill" style={{ width: (ratio * 100).toFixed(1) + '%' }} />
      </div>
    </div>
  );
}

function _countFiles(node) {
  return node.files.length + Object.values(node.children).reduce((s, c) => s + _countFiles(c), 0);
}

function isDocIndexed(doc) {
  return !doc.index_status || doc.index_status === 'indexed';
}

function canOpenDoc(doc) {
  return isDocIndexed(doc) || (doc.chunk_count || 0) > 0;
}

function indexStatusLabel(doc, lang) {
  if (isDocIndexed(doc)) return '';
  if ((doc.chunk_count || 0) > 0) return translate(lang, 'docs_index_updating');
  return translate(lang, 'docs_indexing');
}

function FileActionPanel({ doc, tagsData, setTagsData, onOpen, allowTagEdit = true, activeTagFlyout, setActiveTagFlyout }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const [newName, setNewName] = React.useState('');
  const addInputRef = React.useRef(null);
  const assigned = tagsData.assignments[doc.doc_id] || [];
  const assignedTags = tagsData.customTags.filter(t => assigned.includes(t.id));
  const availableTags = tagsData.customTags.filter(t => !assigned.includes(t.id));
  const canOpen = canOpenDoc(doc);
  const statusLabel = indexStatusLabel(doc, lang);
  const isTagFlyoutOpen = (type) => activeTagFlyout && activeTagFlyout.docId === doc.doc_id && activeTagFlyout.type === type;
  const openTagFlyout = (type) => setActiveTagFlyout({ docId: doc.doc_id, type });
  const closeTagFlyout = (type) => {
    setActiveTagFlyout(current => (
      current && current.docId === doc.doc_id && current.type === type ? null : current
    ));
  };

  const setDocTags = (nextIds) => {
    const assignments = { ...(tagsData.assignments || {}) };
    if (nextIds.length) assignments[doc.doc_id] = nextIds;
    else delete assignments[doc.doc_id];
    const nd = { ...tagsData, assignments };
    setTagsData(nd);
    saveTagsData(nd);
  };

  const addTag = (tagId) => {
    if (!assigned.includes(tagId)) setDocTags([...assigned, tagId]);
  };

  const removeTag = (tagId) => {
    setDocTags(assigned.filter(id => id !== tagId));
  };

  const createAndAssignTag = () => {
    const name = newName.trim();
    if (!name) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const color = TAG_COLORS[tagsData.customTags.length % TAG_COLORS.length];
    const nd = {
      ...tagsData,
      customTags: [...tagsData.customTags, { id, name, color }],
      assignments: { ...(tagsData.assignments || {}), [doc.doc_id]: [...assigned, id] },
    };
    setTagsData(nd);
    saveTagsData(nd);
    setNewName('');
  };

  // Focus the add-tag input when it becomes visible
  React.useEffect(() => {
    if (isTagFlyoutOpen('add') && addInputRef.current) addInputRef.current.focus();
  }, [activeTagFlyout]);

  return (
    <div className="file-action-panel" onClick={e => e.stopPropagation()}>
      {/* Open button */}
            <button
        className="iconbtn"
        onClick={() => { if (canOpen && onOpen) onOpen(doc); }}
        disabled={!canOpen}
        data-tip={canOpen ? doc.filepath : indexStatusLabel(doc, lang)}
      >
        <Icon.external /> {T('docs_open')}
      </button>

      {allowTagEdit && (
        <>
          {/* Edit Tag button — hover reveals tag list flyout */}
          <div
            className={'fap-btn-wrap' + (isTagFlyoutOpen('edit') ? ' fap-btn-wrap-open' : '')}
            onMouseEnter={() => openTagFlyout('edit')}
            onMouseLeave={() => closeTagFlyout('edit')}
          >
            <button className="iconbtn">
              <DocumentIcon name="tag" />
              {T('docs_edit_tag')}
            </button>
            <div className={'fap-flyout fap-edit-flyout' + (isTagFlyoutOpen('edit') ? ' fap-flyout-open' : '')}>
              {tagsData.customTags.length === 0 && (
                <div className="fap-flyout-empty">{T('docs_no_tags')}</div>
              )}
              {assignedTags.length > 0 && (
                <div className="fap-flyout-sect">{T('docs_tags_assigned')}</div>
              )}
              {assignedTags.map(tag => (
                <button key={tag.id} className="fap-tag-item on" onClick={() => removeTag(tag.id)}>
                  <span className="fap-dot" style={{ background: tag.color }}></span>
                  <span className="fap-tag-name">{tag.name}</span>
                  <Icon.trash />
                </button>
              ))}
              {availableTags.length > 0 && (
                <div className="fap-flyout-sect" style={{ paddingTop: assignedTags.length ? 6 : 0 }}>{T('docs_tags_available')}</div>
              )}
              {availableTags.map(tag => (
                <button key={tag.id} className="fap-tag-item" onClick={() => addTag(tag.id)}>
                  <span className="fap-dot" style={{ background: tag.color }}></span>
                  <span className="fap-tag-name">{tag.name}</span>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                </button>
              ))}
            </div>
          </div>

          {/* Add Tag button — hover reveals text input flyout */}
          <div
            className={'fap-btn-wrap' + (isTagFlyoutOpen('add') ? ' fap-btn-wrap-open' : '')}
            onMouseEnter={() => openTagFlyout('add')}
            onMouseLeave={() => closeTagFlyout('add')}
          >
            <button className="iconbtn" onClick={() => openTagFlyout('add')}>
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
              {T('docs_add_tag')}
            </button>
            <div className={'fap-flyout fap-add-flyout' + (isTagFlyoutOpen('add') ? ' fap-flyout-open' : '')}>
              <input
                ref={addInputRef}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { createAndAssignTag(); closeTagFlyout('add'); }
                  if (e.key === 'Escape') closeTagFlyout('add');
                  e.stopPropagation();
                }}
                placeholder={T('docs_new_tag')}
              />
              <button onClick={() => { createAndAssignTag(); closeTagFlyout('add'); }}>{T('docs_add')}</button>
            </div>
                    </div>
        </>
      )}

    </div>
  );
}

function ExplorerFileRow({ doc, tagsData, setTagsData, onOpen, allowTagEdit = true, activeTagFlyout, setActiveTagFlyout, selected, onSelect, orderedIds }) {
  const lang = React.useContext(LangCtx);
  const indexProgress = React.useContext(IndexProgressCtx);
  const [expanded, setExpanded] = React.useState(false);
  const ext = (doc.filename.match(/\.([^.]+)$/) || ['',''])[1].toUpperCase();
  const assigned = tagsData.assignments[doc.doc_id] || [];
  const assignedTags = tagsData.customTags.filter(t => assigned.includes(t.id));
  const statusLabel = indexStatusLabel(doc, lang);
  const pct = statusLabel ? _docPct(indexProgress, doc.doc_id) : null;

  const handleRowClick = (e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (onSelect) onSelect(doc.doc_id, e, orderedIds);
      return;
    }
    setExpanded(prev => !prev);
  };

  return (
    <div className={'explorer-file-item' + (expanded ? ' expanded' : '') + (selected ? ' doc-selected' : '')}>
      <div className={'explorer-file-row' + (statusLabel ? ' indexing' : '')} onClick={handleRowClick}>
        <div className="doc-checkbox" onClick={e => { e.stopPropagation(); if (onSelect) onSelect(doc.doc_id, e, orderedIds); }}>
          <div className={'doc-checkbox-box' + (selected ? ' checked' : '')}>
            {selected && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>}
          </div>
        </div>
        <svg className="caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polyline points="3,1.5 7,5 3,8.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <DocumentIcon ext={ext} className="doc-tree-icon" />
        <span className="file-name" title={doc.filepath}>{doc.filename}</span>
        <div className="file-tags">
          {assignedTags.slice(0,2).map(tag => (
            <span key={tag.id} className="tag-pill tag-pill-custom" style={{ background: tag.color, maxWidth: 64 }}>{tag.name}</span>
          ))}
        </div>
        {pct !== null && <span className="indexing-bar"><span className="indexing-bar-fill" style={{ width: pct + '%' }} /></span>}
      </div>
      {expanded && <FileActionPanel doc={doc} tagsData={tagsData} setTagsData={setTagsData} onOpen={onOpen} allowTagEdit={allowTagEdit} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} />}
    </div>
  );
}

function _collectDocIds(node) {
  const ids = node.files.map(f => f.doc_id);
  Object.values(node.children).forEach(child => ids.push(..._collectDocIds(child)));
  return ids;
}

function ExplorerNode({ name, children, files, depth, tagsData, setTagsData, onOpenFile, allowTagEdit = true, activeTagFlyout, setActiveTagFlyout, expandSignal, selectedIds, onSelect, onSelectFolder, orderedIds }) {
  const [open, setOpen] = React.useState(depth === 0);
  React.useEffect(() => {
    if (expandSignal && expandSignal.version > 0) setOpen(expandSignal.value);
  }, [expandSignal && expandSignal.version]);
  const childEntries = Object.entries(children).sort(([a],[b]) => a.localeCompare(b));
  const totalCount = _countFiles({ children, files });
  const folderDocIds = React.useMemo(() => _collectDocIds({ children, files }), [children, files]);
  const allSelected = selectedIds && folderDocIds.length > 0 && folderDocIds.every(id => selectedIds.has(id));
  const someSelected = selectedIds && !allSelected && folderDocIds.some(id => selectedIds.has(id));
  return (
    <div>
      <div className={'explorer-folder-row' + (open ? ' open' : '') + (allSelected ? ' doc-selected' : '')} onClick={() => setOpen(!open)}>
        <div className="doc-checkbox" onClick={e => { e.stopPropagation(); if (onSelectFolder) onSelectFolder(folderDocIds, allSelected); }}>
          <div className={'doc-checkbox-box' + (allSelected ? ' checked' : '') + (someSelected ? ' partial' : '')}>
            {allSelected && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>}
            {someSelected && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="2" y1="5" x2="8" y2="5"/></svg>}
          </div>
        </div>
        <svg className="caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polyline points="3,1.5 7,5 3,8.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <DocumentIcon name="folder" className="folder-tree-icon" />
        <span>{name}</span>
        <span className="folder-count">{totalCount}</span>
      </div>
      {open && (
        <div className="explorer-children">
          {childEntries.map(([n, node]) => (
            <ExplorerNode key={n} name={n} {...node} depth={depth+1} tagsData={tagsData} setTagsData={setTagsData} onOpenFile={onOpenFile} allowTagEdit={allowTagEdit} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} expandSignal={expandSignal} selectedIds={selectedIds} onSelect={onSelect} onSelectFolder={onSelectFolder} orderedIds={orderedIds} />
          ))}
          {files.map(doc => (
            <ExplorerFileRow key={doc.doc_id} doc={doc} tagsData={tagsData} setTagsData={setTagsData} onOpen={onOpenFile} allowTagEdit={allowTagEdit} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} selected={selectedIds && selectedIds.has(doc.doc_id)} onSelect={onSelect} orderedIds={orderedIds} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocCard({ doc, tagsData, setTagsData, onOpen, allowTagEdit = true, activeTagFlyout, setActiveTagFlyout, selected, onSelect, orderedIds }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const indexProgress = React.useContext(IndexProgressCtx);
  const [expanded, setExpanded] = React.useState(false);
  const ext = (doc.filename.match(/\.([^.]+)$/) || ['',''])[1].toUpperCase();
  const folder = getFolderName(doc.filepath);
  const assigned = tagsData.assignments[doc.doc_id] || [];
  const assignedTags = tagsData.customTags.filter(t => assigned.includes(t.id));
  const sizeStr = doc.file_size ? (doc.file_size >= 1048576 ? (doc.file_size/1048576).toFixed(1)+' MB' : Math.round(doc.file_size/1024)+' KB') : '';
  const extColors = { PDF: ['#ef4444','#fef2f2'], DOC: ['#3b82f6','#eff6ff'], DOCX: ['#3b82f6','#eff6ff'], XLS: ['#10b981','#ecfdf5'], XLSX: ['#10b981','#ecfdf5'], PPT: ['#f59e0b','#fffbeb'], PPTX: ['#f59e0b','#fffbeb'] };
  const [fg, bg] = extColors[ext] || ['var(--fg-faint)','var(--bg-soft)'];
  const statusLabel = indexStatusLabel(doc, lang);
  const pct = statusLabel ? _docPct(indexProgress, doc.doc_id) : null;

  const handleCardClick = (e) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (onSelect) onSelect(doc.doc_id, e, orderedIds);
      return;
    }
    setExpanded(prev => !prev);
  };

  return (
    <div className={'doc-card' + (expanded ? ' expanded' : '') + (statusLabel ? ' indexing' : '') + (selected ? ' doc-selected' : '')} onClick={handleCardClick}>
      <div className="doc-card-main">
        <div className="doc-checkbox" onClick={e => { e.stopPropagation(); if (onSelect) onSelect(doc.doc_id, e, orderedIds); }}>
          <div className={'doc-checkbox-box' + (selected ? ' checked' : '')}>
            {selected && <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1.5,5 4,7.5 8.5,2.5"/></svg>}
          </div>
        </div>
        <svg className="caret" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6">
          <polyline points="3,1.5 7,5 3,8.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="doc-icon" style={{ color: fg, background: bg, border: '1px solid ' + fg + '33' }}>
          <DocumentIcon ext={ext} />
        </div>
        <div className="doc-body">
          <div className="doc-name" title={doc.filepath}>{doc.filename}</div>
          <div className="doc-meta">
            {folder && <><span style={{ color: 'var(--accent)' }}>{folder}</span><span className="sep">·</span></>}
            {sizeStr && <><span>{sizeStr}</span>{doc.chunk_count > 0 && <span className="sep">·</span>}</>}
            {doc.chunk_count > 0 && <span>{doc.chunk_count} {T('docs_chunks')}</span>}
            {pct !== null && <span className="indexing-bar" style={{ marginLeft: 'auto' }}><span className="indexing-bar-fill" style={{ width: pct + '%' }} /></span>}
          </div>
          {(folder || assignedTags.length > 0) && (
            <div className="doc-tags">
              {folder && <span className="tag-pill tag-pill-folder">{folder}</span>}
              {assignedTags.map(tag => (
                <span key={tag.id} className="tag-pill tag-pill-custom" style={{ background: tag.color }}>{tag.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {expanded && <FileActionPanel doc={doc} tagsData={tagsData} setTagsData={setTagsData} onOpen={onOpen} allowTagEdit={allowTagEdit} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} />}
    </div>
  );
}

function WatchPathsPanel({
  open,
  paths,
  defaultPath,
  message,
  saving,
  picking,
  onClose,
  onChangePath,
  onAddPath,
  onReplacePath,
  onDeletePath,
  onSave,
}) {
  const T = useT();
  if (!open) return null;

  const normalizedDefault = _normalizeWatchPath(defaultPath || '').toLowerCase();
  const isDefault = (p) => normalizedDefault && _normalizeWatchPath(p || '').toLowerCase() === normalizedDefault;

  return (
    <div className="watch-paths-backdrop" onMouseDown={onClose}>
      <div className="watch-paths-panel" onMouseDown={e => e.stopPropagation()}>
        <div className="watch-paths-head">
          <div>
            <div className="watch-paths-title">{T('docs_paths_title')}</div>
            <div className="watch-paths-hint">{T('docs_paths_hint')}</div>
          </div>
          <button className="iconbtn watch-paths-close" onClick={onClose} data-tip={T('confirm_cancel')}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>

        <div className="watch-paths-list">
          {paths.length === 0 ? (
            <div className="watch-paths-empty">{T('docs_paths_empty')}</div>
          ) : paths.map((path, index) => (
            <div className="watch-path-row" key={index}>
              <input
                value={path}
                onChange={e => isDefault(path) ? null : onChangePath(index, e.target.value)}
                onKeyDown={e => e.stopPropagation()}
                readOnly={isDefault(path)}
                aria-label={T('docs_paths_title')}
              />
              <button className="iconbtn" onClick={() => onReplacePath(index)} disabled={picking || isDefault(path)} data-tip={T('docs_choose_folder')}>
                <Icon.pencil />
              </button>
              <button className="iconbtn watch-path-delete" onClick={() => onDeletePath(index)} disabled={isDefault(path)} data-tip={T('bookmarks_remove')}>
                <Icon.trash />
              </button>
            </div>
          ))}
        </div>

        {message && <div className="watch-paths-message">{message}</div>}

        <div className="watch-paths-actions">
          <button className="iconbtn" onClick={onAddPath} disabled={picking}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
            {T('docs_add_path')}
          </button>
          <span className="spacer"></span>
          <button className="tag-manager-apply primary watch-path-save" onClick={onSave} disabled={saving || paths.filter(p => p.trim()).length === 0}>
            {saving ? T('search_loading') : T('docs_save_paths')}
          </button>
        </div>
      </div>
    </div>
  );
}

function _normalizeWatchPath(path) {
  return (path || '').replace(/\\/g, '/').replace(/\/$/, '');
}

function _relativeToWatchPaths(filepath, watchPaths) {
  const fullPath = (filepath || '').replace(/\\/g, '/');
  const bases = (watchPaths || []).map(_normalizeWatchPath).filter(Boolean);
  const base = bases.find(base => fullPath === base || fullPath.startsWith(base + '/'));
  if (!base) return fullPath.split('/').pop();
  const rel = fullPath.slice(base.length).replace(/^\//, '');
  if (bases.length <= 1) return rel;
  const rootName = base.split('/').filter(Boolean).pop() || base;
  return rel ? `${rootName}/${rel}` : rootName;
}

function DocumentsView({ onBack, tagsData, setTagsData, watchedDir, watchedDirs, defaultWatchedDir, onWatchDirChanged }) {
  const T = useT();
  const lang = React.useContext(LangCtx);
  const confirm = useConfirm();
  const [docs, setDocs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [choosingFolder, setChoosingFolder] = React.useState(false);
  const [watchFolderMessage, setWatchFolderMessage] = React.useState('');
  const [watchPathsOpen, setWatchPathsOpen] = React.useState(false);
  const [watchPaths, setWatchPaths] = React.useState(watchedDirs && watchedDirs.length ? watchedDirs : (watchedDir ? [watchedDir] : []));
  const [draftWatchPaths, setDraftWatchPaths] = React.useState(watchPaths);
  const [savingWatchPaths, setSavingWatchPaths] = React.useState(false);
  const [viewMode, setViewMode] = React.useState('explorer');
  const [tagMode, setTagMode] = React.useState('manual');
  const [tagApplyMessage, setTagApplyMessage] = React.useState('');
  const [newTagName, setNewTagName] = React.useState('');
  const [newTagColor, setNewTagColor] = React.useState('#6366f1');
  const [addingTag, setAddingTag] = React.useState(false);
  const [activeTagFlyout, setActiveTagFlyout] = React.useState(null);
    const newTagInputRef = React.useRef(null);
  const [filterText, setFilterText] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const [lastSelectedId, setLastSelectedId] = React.useState(null);
  const [bulkTagOpen, setBulkTagOpen] = React.useState(false);
  const bulkTagRef = React.useRef(null);
  const [expandSignal, setExpandSignal] = React.useState({ version: 0, value: true });
  const expandAll = () => setExpandSignal(s => ({ version: s.version + 1, value: true }));
  const collapseAll = () => setExpandSignal(s => ({ version: s.version + 1, value: false }));
    const [indexProgress, setIndexProgress] = React.useState({ files: {}, batch: { active: false } });
  const [pollStats, setPollStats] = React.useState({ count: 0, errors: 0, lastAt: 0 });

  // Sidebar resizer
  const [sidebarW, setSidebarW] = React.useState(196);
  const sidebarResizerPillRef = React.useRef(null);
  const onSidebarResizerMouseDown = React.useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarW;
    sidebarResizerPillRef.current?.classList.add('dragging');
    const onMove = (ev) => {
      const next = Math.max(140, Math.min(320, startW + ev.clientX - startX));
      setSidebarW(next);
    };
    const onUp = () => {
      sidebarResizerPillRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sidebarW]);

  const fetchDocs = React.useCallback(() => {
    return fetch('/api/documents')
      .then(r => r.json())
      .then(d => {
        const nextDocs = d.documents || [];
        setDocs(nextDocs);
        return nextDocs;
      })
      .catch(() => []);
  }, []);

  React.useEffect(() => {
    fetchDocs().finally(() => setLoading(false));
  }, [fetchDocs]);

  React.useEffect(() => {
    const next = watchedDirs && watchedDirs.length ? watchedDirs : (watchedDir ? [watchedDir] : []);
    setWatchPaths(next);
    if (!watchPathsOpen) setDraftWatchPaths(next);
  }, [watchedDir, JSON.stringify(watchedDirs || []), watchPathsOpen]);

  // Unconditional polling while DocumentsView is mounted. /api/progress is
  // cheap (a single in-memory dict snapshot) and polling unconditionally
  // means the bars can never get "stuck" because shouldPoll didn't latch.
  // 500 ms keeps wire traffic light while still catching the 5/20/40/85/100
  // checkpoints emitted by the pipeline for any reasonable-sized file.
  React.useEffect(() => {
    let cancelled = false;
    const fetchProgress = () =>
      fetch('/api/progress', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          if (d && typeof d === 'object') setIndexProgress(d);
          setPollStats(s => ({ count: s.count + 1, errors: s.errors, lastAt: Date.now() }));
        })
        .catch(() => {
          if (cancelled) return;
          setPollStats(s => ({ count: s.count, errors: s.errors + 1, lastAt: s.lastAt }));
        });
    fetchProgress();
    const progTimer = setInterval(fetchProgress, 500);
    const docsTimer = setInterval(fetchDocs, 2500);
    return () => { cancelled = true; clearInterval(progTimer); clearInterval(docsTimer); };
  }, [fetchDocs]);

  React.useEffect(() => {
    if (addingTag && newTagInputRef.current) newTagInputRef.current.focus();
  }, [addingTag]);

  // Trigger a background re-index, then refresh the document list.
  const handleRefresh = React.useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch('/api/index', { method: 'POST' });
      await fetchDocs();
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, fetchDocs]);

  const pickWatchFolder = React.useCallback(async (startDir) => {
    const pickRes = await fetch('/api/watch-folder/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_dir: startDir || '' }),
    });
    const pickData = await pickRes.json().catch(() => ({}));
    if (!pickRes.ok) throw new Error(pickData.detail || T('docs_watch_pick_failed'));
    if (pickData.cancelled || !pickData.path) return '';
    return pickData.path;
  }, [T]);

  const openWatchPathsPanel = React.useCallback(async () => {
    setWatchPathsOpen(true);
    setWatchFolderMessage('');
    try {
      const res = await fetch('/api/watch-folders');
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.paths)) {
        setWatchPaths(data.paths);
        setDraftWatchPaths(data.paths);
      }
    } catch(e) {}
  }, []);

  const handleAddWatchPath = React.useCallback(async () => {
    if (choosingFolder) return;
    setChoosingFolder(true);
    setWatchFolderMessage('');
    try {
      const path = await pickWatchFolder('~');
      if (!path) return;
      setDraftWatchPaths(current => {
        const exists = current.some(p => _normalizeWatchPath(p).toLowerCase() === _normalizeWatchPath(path).toLowerCase());
        return exists ? current : [...current, path];
      });
    } catch(e) {
      setWatchFolderMessage(e.message || T('docs_watch_apply_failed'));
    } finally {
      setChoosingFolder(false);
    }
  }, [choosingFolder, pickWatchFolder, T]);

  const handleReplaceWatchPath = React.useCallback(async (index) => {
    if (choosingFolder) return;
    setChoosingFolder(true);
    setWatchFolderMessage('');
    try {
      const currentPath = draftWatchPaths[index] || '';
      const path = await pickWatchFolder(currentPath);
      if (!path) return;
      setDraftWatchPaths(current => current.map((p, i) => i === index ? path : p));
    } catch(e) {
      setWatchFolderMessage(e.message || T('docs_watch_apply_failed'));
    } finally {
      setChoosingFolder(false);
    }
  }, [choosingFolder, draftWatchPaths, pickWatchFolder, T]);

  const handleDeleteWatchPath = React.useCallback(async (index) => {
    const path = draftWatchPaths[index] || '';
    const ok = await confirm(T('docs_delete_path_confirm', { path }), { danger: true });
    if (!ok) return;
    setDraftWatchPaths(current => current.filter((_, i) => i !== index));
  }, [draftWatchPaths, confirm, T]);

  const handleSaveWatchPaths = React.useCallback(async () => {
    if (savingWatchPaths) return;
    const clean = [];
    draftWatchPaths.forEach(path => {
      const trimmed = path.trim();
      if (!trimmed) return;
      const normalized = _normalizeWatchPath(trimmed).toLowerCase();
      if (!clean.some(p => _normalizeWatchPath(p).toLowerCase() === normalized)) clean.push(trimmed);
    });
    if (!clean.length) return;

    setSavingWatchPaths(true);
    setWatchFolderMessage('');
    try {
      const res = await fetch('/api/watch-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: clean, clear_existing: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || T('docs_paths_save_failed'));
      const next = data.watched_docs_dirs || clean;
      setWatchPaths(next);
      setDraftWatchPaths(next);
      if (onWatchDirChanged) await onWatchDirChanged();
      await fetchDocs();
      setWatchFolderMessage(T('docs_paths_saved'));
    } catch(e) {
      setWatchFolderMessage(e.message || T('docs_paths_save_failed'));
    } finally {
      setSavingWatchPaths(false);
    }
  }, [savingWatchPaths, draftWatchPaths, T, onWatchDirChanged, fetchDocs]);

  const handleCloseWatchPathsPanel = React.useCallback(async () => {
    const hasChanges = JSON.stringify(draftWatchPaths) !== JSON.stringify(watchPaths);
    if (hasChanges) {
      const ok = await confirm(T('docs_paths_unsaved_confirm'));
      if (!ok) return;
    }
    setWatchPathsOpen(false);
  }, [draftWatchPaths, watchPaths, confirm, T]);

  // Close bulk tag dropdown on outside click
  React.useEffect(() => {
    if (!bulkTagOpen) return;
    const handler = (e) => { if (bulkTagRef.current && !bulkTagRef.current.contains(e.target)) setBulkTagOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bulkTagOpen]);

  const handleSelectDoc = React.useCallback((docId, e, orderedIds) => {
    const isShift = e && e.shiftKey;
    const isCtrl = e && (e.ctrlKey || e.metaKey);
    setSelectedIds(prev => {
      if (isShift && lastSelectedId && orderedIds) {
        const a = orderedIds.indexOf(lastSelectedId);
        const b = orderedIds.indexOf(docId);
        if (a !== -1 && b !== -1) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          const range = new Set(orderedIds.slice(lo, hi + 1));
          const next = new Set(prev);
          range.forEach(id => next.add(id));
          return next;
        }
      }
      const next = new Set(prev);
      if (isCtrl) {
        if (next.has(docId)) next.delete(docId); else next.add(docId);
      } else {
        if (next.size === 1 && next.has(docId)) next.delete(docId);
        else { next.clear(); next.add(docId); }
      }
      return next;
    });
    setLastSelectedId(docId);
  }, [lastSelectedId]);

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  const handleSelectFolder = React.useCallback((docIds, allSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) docIds.forEach(id => next.delete(id));
      else docIds.forEach(id => next.add(id));
      return next;
    });
  }, []);

  const bulkAssignTag = React.useCallback((tagId) => {
    const assignments = { ...(tagsData.assignments || {}) };
    selectedIds.forEach(docId => {
      const cur = assignments[docId] || [];
      if (!cur.includes(tagId)) assignments[docId] = [...cur, tagId];
    });
    const nd = { ...tagsData, assignments };
    setTagsData(nd);
    saveTagsData(nd);
    setBulkTagOpen(false);
    clearSelection();
  }, [tagsData, setTagsData, selectedIds, clearSelection]);

  const filtered = React.useMemo(() => {
    let ds = docs;
    if (filterText.trim()) { const q = filterText.toLowerCase(); ds = ds.filter(d => d.filename.toLowerCase().includes(q) || d.filepath.toLowerCase().includes(q)); }
    return ds;
  }, [docs, filterText]);

  const openDoc = (doc) => {
    const isPdf = (doc.filepath || '').toLowerCase().endsWith('.pdf');
    if (isPdf) {
      window.open('/api/file/' + encodeURIComponent(doc.doc_id), '_blank', 'noopener');
    } else {
      fetch('/api/open/' + encodeURIComponent(doc.doc_id), { method: 'POST' });
    }
  };

  const createTag = React.useCallback((name, color) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    const tagColor = color || TAG_COLORS[tagsData.customTags.length % TAG_COLORS.length];
    const nd = { ...tagsData, customTags: [...tagsData.customTags, { id, name: cleanName, color: tagColor }] };
    setTagsData(nd);
    saveTagsData(nd);
    setNewTagName('');
    setNewTagColor('#6366f1');
    setAddingTag(false);
  }, [tagsData, setTagsData]);

  const updateTag = React.useCallback((tagId, patch) => {
    const nd = {
      ...tagsData,
      customTags: tagsData.customTags.map(tag => tag.id === tagId ? { ...tag, ...patch } : tag),
    };
    setTagsData(nd);
    saveTagsData(nd);
  }, [tagsData, setTagsData]);

  const deleteTag = React.useCallback(async (tagId) => {
    const tag = tagsData.customTags.find(t => t.id === tagId);
    if (!tag) return;
    const msg = T('docs_delete_tag_confirm', { name: tag.name });
    const ok = await confirm(msg, { danger: true });
    if (!ok) return;

    const assignments = {};
    Object.entries(tagsData.assignments || {}).forEach(([docId, ids]) => {
      const next = Array.isArray(ids) ? ids.filter(id => id !== tagId) : [];
      if (next.length) assignments[docId] = next;
    });
    const nd = {
      ...tagsData,
      customTags: tagsData.customTags.filter(t => t.id !== tagId),
      assignments,
    };
    setTagsData(nd);
    saveTagsData(nd);
  }, [tagsData, setTagsData, T, confirm]);

  const applyFolderTags = React.useCallback(async () => {
    const msg = T('docs_apply_folder_tags_confirm');
    const ok = await confirm(msg);
    if (!ok) return;

    const customTags = [...tagsData.customTags];
    const assignments = {};
    Object.entries(tagsData.assignments || {}).forEach(([docId, ids]) => {
      assignments[docId] = Array.isArray(ids) ? [...ids] : [];
    });

    const tagByName = new Map(customTags.map(tag => [tag.name.trim().toLowerCase(), tag.id]));
    let created = 0;
    let changedDocs = 0;

    docs.forEach(doc => {
      const folder = getFolderName(doc.filepath);
      const key = folder.trim().toLowerCase();
      if (!key) return;

      let tagId = tagByName.get(key);
      if (!tagId) {
        tagId = Date.now().toString(36) + Math.random().toString(36).slice(2,5) + created;
        const color = TAG_COLORS[customTags.length % TAG_COLORS.length];
        customTags.push({ id: tagId, name: folder, color });
        tagByName.set(key, tagId);
        created += 1;
      }

      const cur = assignments[doc.doc_id] || [];
      if (!cur.includes(tagId)) {
        assignments[doc.doc_id] = [...cur, tagId];
        changedDocs += 1;
      }
    });

    const nd = { ...tagsData, customTags, assignments };
    setTagsData(nd);
    saveTagsData(nd);
    setTagApplyMessage(T('docs_folder_tags_applied', { changedDocs, created }));
  }, [docs, tagsData, setTagsData, T, confirm]);

  const removeAllTags = React.useCallback(async () => {
    const msg = T('docs_remove_all_tags_confirm');
    const ok = await confirm(msg, { danger: true });
    if (!ok) return;

    const nd = { ...tagsData, customTags: [], assignments: {} };
    setTagsData(nd);
    saveTagsData(nd);
    setTagApplyMessage(T('docs_all_tags_removed'));
  }, [tagsData, setTagsData, T, confirm]);

  const tree = React.useMemo(() => {
    const root = { name: T('docs_all_files'), children: {}, files: [] };
    filtered.forEach(doc => {
      let rel = _relativeToWatchPaths(doc.filepath, watchPaths);
      const parts = rel.split('/'); parts.pop();
      let node = root;
      parts.forEach(part => {
        if (!part) return;
        if (!node.children[part]) node.children[part] = { name: part, children: {}, files: [] };
        node = node.children[part];
      });
      node.files.push(doc);
    });
    return root;
  }, [filtered, watchPaths, T]);

  const watchPathLabel = watchPaths.length > 1
    ? `${watchPaths[0]} +${watchPaths.length - 1}`
    : (watchPaths[0] || watchedDir || '');

  return (
    <IndexProgressCtx.Provider value={indexProgress}>
    <section className="docs-view">
      <div className="docs-toolbar">
        <button className="iconbtn" onClick={onBack}><Icon.back /> <span style={{ fontSize: 11 }}>{T('docs_back')}</span></button>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }}></div>
        <div className="searchbox" style={{ height: 28, flex: '0 1 260px' }}>
          <div className="glass"><Icon.search /></div>
          <input value={filterText} onChange={e => setFilterText(e.target.value)} placeholder={T('docs_search')} style={{ fontSize: 12 }} />
        </div>
        <span className="spacer"></span>
        {watchPathLabel && (
          <span className="watch-folder-path" title={watchPaths.join('\n')}>
            {watchPathLabel}
          </span>
        )}
        {watchFolderMessage && (
          <span className="watch-folder-message" title={watchFolderMessage}>
            {watchFolderMessage}
          </span>
        )}
        <button
          className="iconbtn"
          onClick={openWatchPathsPanel}
          disabled={choosingFolder}
          data-tip={T('docs_manage_paths')}
          style={choosingFolder ? { opacity: 0.6 } : null}
        >
          <Icon.paths />
          <span style={{ fontSize: 11 }}>{T('docs_manage_paths')}</span>
        </button>
        <button
          className="iconbtn"
          onClick={handleRefresh}
          disabled={refreshing}
          data-tip={T('docs_refresh')}
          style={refreshing ? { opacity: 0.6 } : null}
        >
          <span style={refreshing ? { display: 'inline-flex', animation: 'spin 0.8s linear infinite' } : { display: 'inline-flex' }}>
            <Icon.refresh />
          </span>
          <span style={{ fontSize: 11 }}>{T('docs_refresh')}</span>
        </button>
        <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }}></div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-faint)' }}>
          {filtered.length}{docs.length !== filtered.length ? ' / ' + docs.length : ''} {T('docs_files_count')}
        </span>
        {viewMode === 'explorer' && Object.keys(tree.children).length > 0 && (
          <>
            <button className="iconbtn" onClick={expandAll} data-tip="Expand all" style={{ fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/>
                <path d="M3.5 6h5M6 3.5v5"/>
              </svg>
            </button>
            <button className="iconbtn" onClick={collapseAll} data-tip="Collapse all" style={{ fontSize: 11 }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/>
                <path d="M3.5 6h5"/>
              </svg>
            </button>
          </>
        )}
        <div className="docs-view-toggle">
          <button className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')} data-tip={T('docs_list')}><Icon.rows /></button>
          <button className={viewMode === 'explorer' ? 'on' : ''} onClick={() => setViewMode('explorer')} data-tip={T('docs_explorer')}><Icon.tree /></button>
        </div>
      </div>

      <WatchPathsPanel
        open={watchPathsOpen}
        paths={draftWatchPaths}
        defaultPath={defaultWatchedDir}
        message={watchFolderMessage}
        saving={savingWatchPaths}
        picking={choosingFolder}
        onClose={handleCloseWatchPathsPanel}
        onChangePath={(index, value) => setDraftWatchPaths(current => current.map((path, i) => i === index ? value : path))}
        onAddPath={handleAddWatchPath}
        onReplacePath={handleReplaceWatchPath}
        onDeletePath={handleDeleteWatchPath}
        onSave={handleSaveWatchPaths}
      />

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* Left tag sidebar */}
        <div style={{ width: sidebarW + 'px', flexShrink: 0, borderRight: 'none', background: 'var(--bg-elev)', overflowY: 'auto', padding: '4px 0' }}>
          <div className="fgroup">
            <div className="fgroup-title"><span>{T('docs_tag_mode')}</span></div>
            <div className="tag-mode-toggle">
              <button className={tagMode === 'auto' ? 'on' : ''} onClick={() => setTagMode('auto')}>{T('docs_auto_tags')}</button>
              <button className={tagMode === 'manual' ? 'on' : ''} onClick={() => setTagMode('manual')}>{T('docs_manual_tags')}</button>
            </div>
                        {tagMode === 'auto' && (
              <>
                <button className="tag-manager-apply primary" onClick={applyFolderTags}>{T('docs_apply_folder_tags')}</button>
                <button className="tag-manager-apply danger" onClick={removeAllTags}>{T('docs_remove_all_tags')}</button>
              </>
            )}
          </div>
          <div className="fgroup">
            <div className="fgroup-title">
              <span>{T('docs_tags')}</span>
            </div>
            {tagsData.customTags.map(tag => {
              return (
                <div key={tag.id} className="tag-editor-row">
                  <input
                    type="color"
                    value={tag.color}
                    onChange={e => updateTag(tag.id, { color: e.target.value })}
                    data-tip={T('docs_color')}
                  />
                  <input
                    className="tag-editor-name"
                    defaultValue={tag.name}
                    onBlur={e => {
                      const name = e.target.value.trim();
                      if (name && name !== tag.name) updateTag(tag.id, { name });
                      else e.target.value = tag.name;
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      e.stopPropagation();
                    }}
                  />
                  <button className="iconbtn tag-delete-btn" onClick={() => deleteTag(tag.id)} data-tip={T('bookmarks_remove')}>
                    <Icon.trash />
                  </button>
                </div>
              );
            })}
            <div className="new-tag-row">
              {!addingTag ? (
                <button className="new-tag-trigger" onClick={() => setAddingTag(true)}>
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
                  {T('docs_add_tag')}
                </button>
              ) : (
                <div className="new-tag-form">
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={e => setNewTagColor(e.target.value)}
                  />
                  <input
                    ref={newTagInputRef}
                    type="text"
                    value={newTagName}
                    onChange={e => setNewTagName(e.target.value)}
                    placeholder={T('docs_tag_name_placeholder')}
                    onKeyDown={e => {
                      if (e.key === 'Enter') createTag(newTagName, newTagColor);
                      if (e.key === 'Escape') { setAddingTag(false); setNewTagName(''); }
                      e.stopPropagation();
                    }}
                  />
                  <button className="add-btn" onClick={() => createTag(newTagName, newTagColor)}>{T('docs_add')}</button>
                </div>
              )}
            </div>
                    </div>
        </div>

        {/* Resizer */}
        <div className="resizer" onMouseDown={onSidebarResizerMouseDown}>
          <div ref={sidebarResizerPillRef} className="resizer-pill" />
        </div>

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedIds.size > 0 && (
            <div className="bulk-action-bar">
              <span className="bulk-count">{selectedIds.size} {T('docs_selected')}</span>
              <div className="bulk-tag-wrap" ref={bulkTagRef}>
                <button className="iconbtn bulk-tag-btn" onClick={() => setBulkTagOpen(o => !o)}>
                  <DocumentIcon name="tag" />
                  {T('docs_bulk_tag')}
                  <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="2,3.5 5,6.5 8,3.5"/></svg>
                </button>
                {bulkTagOpen && (
                  <div className="bulk-tag-dropdown">
                    {tagsData.customTags.length === 0
                      ? <div className="fap-flyout-empty">{T('docs_no_tags')}</div>
                      : tagsData.customTags.map(tag => (
                          <button key={tag.id} className="fap-tag-item" onClick={() => bulkAssignTag(tag.id)}>
                            <span className="fap-dot" style={{ background: tag.color }}></span>
                            <span className="fap-tag-name">{tag.name}</span>
                          </button>
                        ))
                    }
                  </div>
                )}
              </div>
              <button className="iconbtn" onClick={clearSelection} style={{ marginLeft: 'auto' }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>
                {T('docs_clear_selection')}
              </button>
            </div>
          )}
          <div className="docs-body">
          <IndexingHeader progress={indexProgress} />
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div>
                <div className="ico"><Icon.page /></div>
                <div className="title">{T('docs_empty')}</div>
                <div className="hint">{T('docs_empty_hint')}</div>
              </div>
            </div>
          ) : viewMode === 'explorer' ? (() => {
              const explorerIds = filtered.map(d => d.doc_id);
              return (
                <div className="explorer-root">
                  {Object.entries(tree.children).sort(([a],[b]) => a.localeCompare(b)).map(([n, node]) => (
                    <ExplorerNode key={n} name={n} {...node} depth={0} tagsData={tagsData} setTagsData={setTagsData} onOpenFile={openDoc} allowTagEdit={true} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} expandSignal={expandSignal} selectedIds={selectedIds} onSelect={handleSelectDoc} onSelectFolder={handleSelectFolder} orderedIds={explorerIds} />
                  ))}
                  {tree.files.map(doc => (
                    <ExplorerFileRow key={doc.doc_id} doc={doc} tagsData={tagsData} setTagsData={setTagsData} onOpen={openDoc} allowTagEdit={true} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} selected={selectedIds.has(doc.doc_id)} onSelect={handleSelectDoc} orderedIds={explorerIds} />
                  ))}
                </div>
              );
            })()
          : (
            <div className="doc-grid">
              {filtered.map(doc => (
                <DocCard key={doc.doc_id} doc={doc} tagsData={tagsData} setTagsData={setTagsData} onOpen={openDoc} allowTagEdit={true} activeTagFlyout={activeTagFlyout} setActiveTagFlyout={setActiveTagFlyout} selected={selectedIds.has(doc.doc_id)} onSelect={handleSelectDoc} orderedIds={filtered.map(d => d.doc_id)} />
              ))}
            </div>
          )}
          </div>
        </div>
      </div>
    </section>
    </IndexProgressCtx.Provider>
  );
}
