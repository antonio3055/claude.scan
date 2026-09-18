import { useRef, useState } from 'react';
import type { ScannerDocument, ScannerLead } from '../types/scanner';
import { MoreIcon, PauseIcon, PlayIcon, RefreshIcon, SendIcon, StopIcon, UploadIcon } from './ScannerIcons';
import { StatsStrip } from './StatsStrip';
import { StoragePanel } from './StoragePanel';
import { expandZips } from '../lib/zipUpload';
import { useElapsedTimer } from '../hooks/useElapsedTimer';

interface Props {
  documents: ScannerDocument[];
  leads: ScannerLead[];
  running: boolean;
  paused: boolean;
  onAddFiles: (files: File[]) => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRetryFailed: () => void;
  onRunOcr: () => void;
  onClearCompleted: () => void;
  onOpenOptions: () => void;
  onOpenOcrFiles: () => void;
  onOpenSend: () => void;
  onClearStorage: () => void;
  storageEpoch: number;
  readyToSend: number;
}

/** Upload + run controls and the stats bar. Everything used rarely lives behind the Options modal instead. */
export function QueuePanel(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const rescanCount = props.documents.filter((d) => d.processingStatus === 'failed' || d.processingStatus === 'stopped').length;
  const queued = props.documents.filter((d) => d.processingStatus === 'queued' || d.processingStatus === 'stopped').length;
  // Files the regular scan reported as scans of paper. OCR reads them only
  // when this count is acted on: nothing here starts OCR on its own.
  const needsOcrCount = props.documents.filter((d) => d.needsOcr && !d.usedOcr).length;
  const usedOcrCount = props.documents.filter((d) => d.usedOcr).length;
  const elapsed = useElapsedTimer(props.running, props.paused);

  const ingest = async (list: File[]) => {
    if (!list.length) return;
    setUnzipping(true);
    try {
      const { files, notices: found } = await expandZips(list);
      if (found.length) setNotices((prev) => [...found, ...prev].slice(0, 8));
      if (files.length) props.onAddFiles(files);
    } finally {
      setUnzipping(false);
    }
  };

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    void ingest(Array.from(files));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="scanner-toolbar">
      <div className="toolbar-top">
        <button
          className={`upload-dropzone ${drag ? 'drag' : ''}`}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void ingest(Array.from(e.dataTransfer.files)); }}
        >
          <UploadIcon />
          <span><b>{unzipping ? 'Reading zip…' : 'Drop documents here'}</b><small>or click to browse · PDF, PNG, JPG, or a .zip of them</small></span>
        </button>
        <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.zip" hidden onChange={(e) => add(e.target.files)} />

        <div className="toolbar-right">
          <div className="toolbar-title-row">
            <div><h1>Forge Scanner</h1><span>{props.running ? (props.paused ? 'Paused' : 'Scanning') : queued ? `${queued} queued` : 'Ready'}</span></div>
            <div className="head-actions">
              <StoragePanel onClear={props.onClearStorage} epoch={props.storageEpoch} />
              {props.running ? (
                <button className="icon-control" type="button" onClick={props.paused ? props.onResume : props.onPause} title={props.paused ? 'Resume scan' : 'Pause scan'}>
                  {props.paused ? <PlayIcon /> : <PauseIcon />}
                </button>
              ) : (
                <button className="icon-control" type="button" onClick={props.onRun} title="Start queued scans"><PlayIcon /></button>
              )}
              <button className="icon-control" type="button" onClick={props.onStop} title="Stop scan"><StopIcon /></button>
              <details className="more-menu">
                <summary className="icon-control" title="More scanner options"><MoreIcon /></summary>
                <div className="menu-card">
                  <button type="button" onClick={props.onRestart}><RefreshIcon />Restart stopped <b>{rescanCount || ''}</b></button>
                  <button type="button" onClick={props.onRetryFailed}><RefreshIcon />Retry failed <b>{props.documents.filter((d) => d.processingStatus === 'failed').length || ''}</b></button>
                  <button type="button" onClick={props.onRunOcr} disabled={!needsOcrCount} title={needsOcrCount ? `${needsOcrCount} file(s) have no text layer and need OCR` : 'No file needs OCR'}><RefreshIcon />Run OCR on flagged <b>{needsOcrCount || ''}</b></button>
                  <button type="button" onClick={props.onClearCompleted}>Clear completed</button>
                  <div className="menu-divider" />
                  <button type="button" onClick={props.onOpenOcrFiles}>OCR files <b>{usedOcrCount || ''}</b></button>
                  <button type="button" onClick={props.onOpenSend}><SendIcon />Send leads <b>{props.readyToSend || ''}</b></button>
                  <button type="button" onClick={props.onOpenOptions}>Options…</button>
                </div>
              </details>
            </div>
          </div>
          <StatsStrip documents={props.documents} leads={props.leads} elapsed={elapsed} />
        </div>
      </div>

      {notices.length > 0 && (
        <ul className="upload-notices">
          {notices.map((n, i) => (
            <li key={i}>
              {n}
              <button type="button" onClick={() => setNotices((prev) => prev.filter((_, j) => j !== i))} aria-label="Dismiss">✕</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
