// Filter widgets: shared FilterGroup, sidebar FiltersRail, top-bar TopFilters.

function FilterGroup({ title, items, selected, onToggle, onClear, clearLabel }) {
  return (
    <div className="fgroup">
      <div className="fgroup-title">
        <span>{title}</span>
        {selected.length > 0 && <span className="clear" onClick={onClear}>{clearLabel}</span>}
      </div>
      {items.map(it => {
        const on = selected.includes(it.id);
        return (
          <div key={it.id} className={'fitem' + (on ? ' on' : '')} onClick={() => onToggle(it.id)}>
            <div className="checkbox"><Icon.check /></div>
            <span className="label">{it.label}</span>
            <span className="count">{it.count}</span>
          </div>
        );
      })}
    </div>
  );
}

// Dimmable (lit/dark) filter group: no checkbox; lit (colored) by default,
// grayscale when excluded. `selected` is an *exclusion* list; clicking toggles
// inclusion/exclusion. Items may provide a custom `icon` node.
function DimmableFilterGroup({ title, items, selected, onToggle, onClear, clearLabel }) {
  return (
    <div className="fgroup">
      <div className="fgroup-title">
        <span>{title}</span>
        {selected.length > 0 && <span className="clear" onClick={onClear}>{clearLabel}</span>}
      </div>
      {items.map(it => {
        const on = !selected.includes(it.id);
        return (
          <div key={it.id} className={'fitem fitem-dim' + (on ? ' on' : '')} onClick={() => onToggle(it.id)}>
            {it.icon && <span className="fitem-ico">{it.icon}</span>}
            <span className="label">{it.label}</span>
            <span className="count">{it.count}</span>
          </div>
        );
      })}
    </div>
  );
}

function isUnderSelected(relPath, selected) {
  if (selected.includes(relPath)) return true;
  return selected.some(p => p && relPath.startsWith(p + '/'));
}

function ExplorerFileNode({ name, relPath, depth, selected, onToggle }) {
  const excluded = isUnderSelected(relPath, selected);
  const ext = (name.match(/\.([^.]+)$/) || ['',''])[1].toUpperCase();
  return (
    <div className="exf-node" style={{ paddingLeft: depth * 10 }}>
      <div className={'exf-row exf-row-file' + (excluded ? ' excluded' : '')} onClick={() => onToggle(relPath)}>
        <span className="exf-caret exf-caret-empty"></span>
        <span className="exf-label">
          <DocumentIcon ext={ext} className="exf-file-ico" />
          <span className="label" title={relPath}>{name}</span>
        </span>
      </div>
    </div>
  );
}

function ExplorerFolderNode({ name, relPath, node, depth, selected, onToggle, expandSignal }) {
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => {
    if (expandSignal && expandSignal.version > 0) setOpen(expandSignal.value);
  }, [expandSignal && expandSignal.version]);
  const childEntries = Object.entries(node.children).sort(([a],[b]) => a.localeCompare(b));
  const files = (node.files || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const excluded = isUnderSelected(relPath, selected);
  const count = node.count;
  const hasChildren = childEntries.length > 0 || files.length > 0;
  return (
    <div className="exf-node" style={{ paddingLeft: depth * 10 }}>
      <div className={'exf-row' + (excluded ? ' excluded' : '')}>
        {hasChildren ? (
          <span className="exf-caret" onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}>
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
              <polyline points="3,1.5 7,5 3,8.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        ) : (
          <span className="exf-caret exf-caret-empty"></span>
        )}
        <span className="exf-label" onClick={() => onToggle(relPath)}>
          <DocumentIcon name="folder" className="exf-folder-ico" />
          <span className="label">{name}</span>
          <span className="count">{count}</span>
        </span>
      </div>
      {open && hasChildren && (
        <div className="exf-children">
          {childEntries.map(([n, child]) => (
            <ExplorerFolderNode
              key={'d:' + n}
              name={n}
              relPath={relPath ? (relPath + '/' + n) : n}
              node={child}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
              expandSignal={expandSignal}
            />
          ))}
          {files.map(f => (
            <ExplorerFileNode
              key={'f:' + f.name}
              name={f.name}
              relPath={relPath ? (relPath + '/' + f.name) : f.name}
              depth={depth + 1}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExplorerFilterGroup({ title, allResults, watchedDir, watchedDirs, defaultWatchedDir, selected, onToggle, onClear, clearLabel }) {
  const tree = React.useMemo(() => {
    const paths = Array.isArray(watchedDirs) && watchedDirs.length ? watchedDirs : (watchedDir ? [watchedDir] : []);
    const bases = paths.map(path => path.replace(/\\/g, '/').replace(/\/$/, '')).filter(Boolean);
    const root = { children: {}, files: [], count: 0 };
    const seenPaths = new Set();
    allResults.forEach(r => {
      const fp = (r.filepath || '').replace(/\\/g, '/');
      if (!fp || seenPaths.has(fp)) return;
      seenPaths.add(fp);
      const base = bases.find(base => fp === base || fp.startsWith(base + '/'));
      let rel = fp;
      if (base) {
        rel = fp.slice(base.length).replace(/^\//, '');
        if (bases.length > 1) {
          const rootName = base.split('/').filter(Boolean).pop() || base;
          rel = rel ? `${rootName}/${rel}` : rootName;
        }
      }
      const parts = rel.split('/');
      const fileName = parts.pop();
      let node = root;
      node.count += 1;
      parts.forEach(part => {
        if (!part) return;
        if (!node.children[part]) node.children[part] = { children: {}, files: [], count: 0 };
        node = node.children[part];
        node.count += 1;
      });
      if (fileName) node.files.push({ name: fileName });
    });
    return root;
  }, [allResults, watchedDir, watchedDirs]);

  const defaultRootName = React.useMemo(() => {
    if (!defaultWatchedDir) return '';
    return defaultWatchedDir.replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean).pop() || '';
  }, [defaultWatchedDir]);

  const paths = Array.isArray(watchedDirs) && watchedDirs.length ? watchedDirs : (watchedDir ? [watchedDir] : []);
  const multiBase = paths.length > 1;

  const childEntries = Object.entries(tree.children)
    .filter(([n, child]) => {
      if (multiBase && defaultRootName && n === defaultRootName && child.count === 0) return false;
      return true;
    })
    .sort(([a],[b]) => a.localeCompare(b));
  const rootFiles = tree.files.slice().sort((a, b) => a.name.localeCompare(b.name));
  const [expandSignal, setExpandSignal] = React.useState({ version: 0, value: true });
  const expandAll   = () => setExpandSignal(s => ({ version: s.version + 1, value: true }));
  const collapseAll = () => setExpandSignal(s => ({ version: s.version + 1, value: false }));
  const hasFolders = childEntries.length > 0;

  return (
    <div className="fgroup">
      <div className="fgroup-title">
        <span>{title}</span>
        <span className="exf-actions">
          {hasFolders && (
            <>
                            <span className="exf-action" onClick={expandAll} data-tip="Expand all">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/>
                  <path d="M3.5 6h5M6 3.5v5"/>
                </svg>
              </span>
              <span className="exf-action" onClick={collapseAll} data-tip="Collapse all">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5"/>
                  <path d="M3.5 6h5"/>
                </svg>
              </span>
            </>
          )}
          {selected.length > 0 && <span className="clear" onClick={onClear}>{clearLabel}</span>}
        </span>
      </div>
      {tree.count === 0 ? (
        <div className="exf-empty">—</div>
      ) : (
        <>
          {childEntries.map(([n, child]) => (
            <ExplorerFolderNode
              key={'d:' + n}
              name={n}
              relPath={n}
              node={child}
              depth={0}
              selected={selected}
              onToggle={onToggle}
              expandSignal={expandSignal}
            />
          ))}
          {rootFiles.map(f => (
            <ExplorerFileNode
              key={'f:' + f.name}
              name={f.name}
              relPath={f.name}
              depth={0}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </div>
  );
}

function FiltersRail({ filters, setFilters, allResults, tagsData, watchedDir, watchedDirs, defaultWatchedDir }) {
  const T = useT();
  const { types, counts } = React.useMemo(() => {
    const c = { type: {} };
    allResults.forEach(r => {
      if (r.type) c.type[r.type] = (c.type[r.type] || 0) + 1;
    });
    return {
      types:  Object.keys(c.type).sort(),
      counts: c,
    };
  }, [allResults]);

  const toggle = (key, id) => {
    const cur = filters[key] || [];
    setFilters({ ...filters, [key]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  };
  const clear = (key) => setFilters({ ...filters, [key]: [] });

  const typeItems = types.map(t => ({
    id: t,
    label: t,
    count: counts.type[t] || 0,
    icon: <DocumentIcon ext={t} fallbackText={t} className="fitem-doc-ico" />,
  }));

  return (
    <aside className="filters-rail">
      <ExplorerFilterGroup
        title={T('f_explorer')}
        allResults={allResults}
        watchedDir={watchedDir}
        watchedDirs={watchedDirs}
        defaultWatchedDir={defaultWatchedDir}
        selected={filters.folder || []}
        onToggle={id => toggle('folder', id)}
        onClear={() => clear('folder')}
        clearLabel={T('f_clear')}
      />
      <DimmableFilterGroup
        title={T('f_spec_type')}
        items={typeItems}
        selected={filters.type}
        onToggle={id => toggle('type', id)}
        onClear={() => clear('type')}
        clearLabel={T('f_clear')}
      />
      <TagsFilterGroup filters={filters} setFilters={setFilters} allResults={allResults} tagsData={tagsData} />
    </aside>
  );
}

function TopFilters({ filters, setFilters, allResults }) {
  const T = useT();
  const { vendors, types, counts } = React.useMemo(() => {
    const c = { vendor: {}, type: {} };
    allResults.forEach(r => {
      if (r.vendor) c.vendor[r.vendor] = (c.vendor[r.vendor] || 0) + 1;
      if (r.type)   c.type[r.type]     = (c.type[r.type]     || 0) + 1;
    });
    return { vendors: Object.keys(c.vendor).sort(), types: Object.keys(c.type).sort(), counts: c };
  }, [allResults]);
  const toggle = (key, id) => {
    const cur = filters[key];
    setFilters({ ...filters, [key]: cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] });
  };
  return (
    <div className="topfilters">
      <div className="grp"><span className="grp-label">{T('f_vendor')}</span>
        {vendors.map(v => <button key={v} className={'chip' + (filters.vendor.includes(v) ? ' on' : '')} onClick={() => toggle('vendor', v)}>{v}<span className="ct">{counts.vendor[v] || 0}</span></button>)}
      </div>
      <div className="grp"><span className="grp-label">{T('f_spec_type')}</span>
        {types.map(v => <button key={v} className={'chip' + (filters.type.includes(v) ? ' on' : '')} onClick={() => toggle('type', v)}>{v}<span className="ct">{counts.type[v] || 0}</span></button>)}
      </div>
    </div>
  );
}
