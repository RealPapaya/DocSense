// StatusBar — bottom strip showing connection, mode, embedder info, count summary.

function StatusBar({ totalMs, mode, results, summary = {} }) {
  const T = useT();
  const isOcc = summary.view === 'occurrences';

  return (
    <div className="statusbar">
      <span className="item"><span className="ok">●</span> {T('sb_connected')}</span>
      <span className="item">{T('sb_mode')} {isOcc ? T('view_occurrences') : mode}</span>
      <span className="item">{T('sb_embedder')}</span>
      <span className="item">{T('sb_alpha')}</span>
      <span className="spacer"></span>
      <span className="item">{T('sb_cache')}</span>
      {isOcc ? (
        <span className="item">
          {summary.totalDocuments || 0} {T('sb_docs')} ·
          {' '}{summary.totalChunks || 0} {T('sb_chunks')} ·
          {' '}{summary.totalOccurrences || 0} {T('sb_matches')} ·
          {' '}{totalMs}ms
        </span>
      ) : (
        <span className="item">
          {summary.totalChunks || results.length} {T('sb_chunks')}
          {(summary.totalOccurrences || 0) > 0 && (
            <> · {summary.totalOccurrences} {T('sb_matches')}</>
          )}
          {' '}· {totalMs}ms
        </span>
      )}
    </div>
  );
}
