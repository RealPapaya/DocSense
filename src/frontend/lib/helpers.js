// Helpers: text highlighting, score class, vendor class, shared Icon set.
// Top-level `var` (not `const`) so each binding attaches to the global scope
// and is visible to later <script type="text/babel"> tags.

function highlightText(text, terms) {
  if (!terms || !terms.length) return text;
  if (typeof terms[0] === 'object') {
    const spans = terms
      .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const parts = [];
    let cursor = 0;
    spans.forEach((span, i) => {
      const start = Math.max(0, Math.min(text.length, span.start));
      const end = Math.max(start, Math.min(text.length, span.end));
      if (start < cursor) return;
      if (start > cursor) parts.push(<React.Fragment key={'t' + i}>{text.slice(cursor, start)}</React.Fragment>);
      parts.push(<mark key={'m' + i}>{text.slice(start, end)}</mark>);
      cursor = end;
    });
    if (cursor < text.length) parts.push(<React.Fragment key="tail">{text.slice(cursor)}</React.Fragment>);
    return parts;
  }
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('(' + escaped.join('|') + ')', 'i');
  const parts = text.split(pattern);
  return parts.map((p, i) =>
    pattern.test(p) ? <mark key={i}>{p}</mark> : <React.Fragment key={i}>{p}</React.Fragment>
  );
}
function vendorClass(v) { return v.toLowerCase().replace(/[^a-z]/g, ''); }
function scoreClass(s) { return s >= 0.9 ? '' : s >= 0.85 ? ' mid' : ' low'; }

const DOCUMENT_ICON_PATHS = {
  ppt: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6',
    'M11 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6',
    'M16.5 15h3',
    'M18 15v6',
    'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
  ],
  xls: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
    'M4 15l4 6',
    'M4 21l4 -6',
    'M17 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75',
    'M11 15v6h3',
  ],
  docx: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
    'M2 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1',
    'M17 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0',
    'M9.5 15a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1 -3 0v-3a1.5 1.5 0 0 1 1.5 -1.5',
    'M19.5 15l3 6',
    'M19.5 21l3 -6',
  ],
  pdf: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
    'M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6',
    'M17 18h2',
    'M20 15h-3v6',
    'M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1',
  ],
  folder: [
    'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2',
  ],
  tag: [
    'M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    'M3 6v5.172a2 2 0 0 0 .586 1.414l7.71 7.71a2.41 2.41 0 0 0 3.408 0l5.592 -5.592a2.41 2.41 0 0 0 0 -3.408l-7.71 -7.71a2 2 0 0 0 -1.414 -.586h-5.172a3 3 0 0 0 -3 3',
  ],
};

const DOCUMENT_ICON_EXT_MAP = {
  PPT: 'ppt',
  PPTX: 'ppt',
  XLS: 'xls',
  XLSX: 'xls',
  DOC: 'docx',
  DOCX: 'docx',
  PDF: 'pdf',
};

const DOCUMENT_ICON_COLORS = {
  docx: '#3b82f6',
  xls: '#10b981',
  ppt: '#f59e0b',
  pdf: '#ef4444',
};

function DocumentIcon({ name, ext, className, fallbackText }) {
  const normalizedExt = (ext || '').toUpperCase();
  const iconName = name || DOCUMENT_ICON_EXT_MAP[normalizedExt];
  const paths = DOCUMENT_ICON_PATHS[iconName];
  const color = DOCUMENT_ICON_COLORS[iconName];

  if (!paths) {
    return <span className={className}>{fallbackText || normalizedExt || '?'}</span>;
  }

  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={className ? null : { width: '1.4em', height: '1.4em' }}
    >
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
      {paths.map(path => <path key={path} d={path} />)}
    </svg>
  );
}

var Icon = {
  search:   () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="5" /><path d="M11 11l3 3" strokeLinecap="round" /></svg>,
  check:    () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  sun:      () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" strokeLinecap="round"/></svg>,
  moon:     () => <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 10.5a5.5 5.5 0 11-7-7 4.5 4.5 0 007 7z" /></svg>,
  settings: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5c-.55 0-1.1.04-1.63.12L9.5 4.8A7 7 0 0 0 7.2 6.1L4.9 5.4 3.4 7.9l1.7 1.7a7 7 0 0 0 0 4.8L3.4 16.1l1.5 2.5 2.3-.7a7 7 0 0 0 2.3 1.3l.87 2.18C10.9 21.46 11.44 21.5 12 21.5s1.1-.04 1.63-.12l.87-2.18a7 7 0 0 0 2.3-1.3l2.3.7 1.5-2.5-1.7-1.7a7 7 0 0 0 0-4.8l1.7-1.7-1.5-2.5-2.3.7A7 7 0 0 0 14.5 4.8l-.87-2.18A9.3 9.3 0 0 0 12 2.5z"/><circle cx="12" cy="12" r="3"/></svg>,
  copy:     () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg>,
  external: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M7 3H3v10h10V9M9 3h4v4M13 3l-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  arrow:    () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  list:     () => <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3.5" width="12" height="1.5" rx="0.5"/><rect x="2" y="7.25" width="12" height="1.5" rx="0.5"/><rect x="2" y="11" width="12" height="1.5" rx="0.5"/></svg>,
  rows:     () => <svg viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2.5" width="3" height="3" rx="0.5"/><rect x="6.5" y="3" width="7.5" height="1" rx="0.5"/><rect x="6.5" y="4.5" width="5" height="1" rx="0.5"/><rect x="2" y="7.5" width="3" height="3" rx="0.5"/><rect x="6.5" y="8" width="7.5" height="1" rx="0.5"/><rect x="6.5" y="9.5" width="5" height="1" rx="0.5"/><rect x="2" y="12.5" width="3" height="1" rx="0.5"/><rect x="6.5" y="12.5" width="7.5" height="1" rx="0.5"/></svg>,
  bookmark: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4" /></svg>,
  bookmarkFill: () => <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h8v12l-4-3-4 3z"/></svg>,
  download: () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2v9M4 7l4 4 4-4M2 14h12" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  page:     () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 1.5h5.5L12 4v10.5H4z" strokeLinejoin="round"/><path d="M9.5 1.5V4H12M5.5 7.5h5M5.5 10h5M5.5 12.5h3" strokeLinecap="round"/></svg>,
  trash:    () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.5 9.5h6L11.5 4M6.5 6.5v5M9.5 6.5v5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  back:     () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 3l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  tree:     () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2.5v11M3 8h4M3 13h7M7 8v5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="10" cy="13" r="1.5" fill="currentColor" stroke="none"/><circle cx="7" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="2.5" r="1.5" fill="currentColor" stroke="none"/></svg>,
  tag:      () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 2h5.5l6.5 6.5-5.5 5.5L2 7.5V2z" strokeLinejoin="round"/><circle cx="5" cy="5" r="1" fill="currentColor" stroke="none"/></svg>,
  folder:   () => <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.586a1 1 0 0 1 .707.293l.914.914H13.5a1 1 0 0 1 1 1V12.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z" opacity=".3"/><path d="M1.5 5.5h13v7a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7z"/></svg>,
  refresh:   () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 6A6 6 0 1 0 12 11.2"/><path d="M13.5 2.5v3.5H10"/></svg>,
  pencil:    () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.8 2.8l2.4 2.4M3 13l3.2-.7 7-7a1.7 1.7 0 0 0-2.4-2.4l-7 7L3 13z"/></svg>,
  paths:     () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4.5h4l1.2 1.5H13v5.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/><path d="M5 2.5h4l1.2 1.5H13"/></svg>,
  matchCase:  () => <svg viewBox="0 0 16 16" fill="currentColor"><text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">Aa</text></svg>,
  wholeWord:  () => <svg viewBox="0 0 16 16" fill="currentColor"><text x="8" y="11" textAnchor="middle" fontSize="10" fontWeight="700" fontFamily="system-ui, sans-serif">ab</text><rect x="2" y="13" width="12" height="1.4"/></svg>,
};
