import { useRef, useState } from 'react';
import type { ScannerDocument, ScannerLead, ScanSettings } from '../types/scanner';
import { AuditSection } from './AuditSection';
import { LeadRows } from './LeadRows';
import { MoreIcon, PauseIcon, PlayIcon, RefreshIcon, StopIcon, UploadIcon } from './ScannerIcons';
import { StatsStrip } from './StatsStrip';

interface Props {
  documents: ScannerDocument[];
  leads: ScannerLead[];
  selectedLeadId: string | null;
  onSelectLead: (id: string) => void;
  settings: ScanSettings;
  onSettings: (settings: ScanSettings) => void;
  running: boolean;
  paused: boolean;
  onAddFiles: (files: File[]) => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRetryFailed: () => void;
  onClearCompleted: () => void;
}

export function QueuePanel(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const rescanCount = props.documents.filter((d) => d.processingStatus === 'failed' || d.processingStatus === 'stopped').length;
  const queued = props.documents.filter((d) => d.processingStatus === 'queued' || d.processingStatus === 'stopped').length;

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    props.onAddFiles(Array.from(files));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <section className="scanner-panel queue-panel">
      <header className="scanner-panel-head">
        <div><h2>Scanner</h2><span>{props.running ? (props.paused ? 'Paused' : 'Scanning') : queued ? `${queued} queued` : 'Ready'}</span></div>
        <div className="head-actions">
          {props.running ? (
            <button className="icon-control" type="button" onClick={props.paused ? props.onResume : props.onPause} title={props.paused ? 'Resume scan' : 'Pause scan'}>
              {props.paused ? <PlayIcon /> : <PauseIcon />}
            </button>
          ) : (
            <button className="icon-control" type="button" onClick={props.onRun} title="Start queued scans"><PlayIcon /></button>
          )}
          <details className="more-menu">
            <summary className="icon-control" title="More scanner options"><MoreIcon /></summary>
            <div className="menu-card">
              <button type="button" onClick={props.onStop}><StopIcon />Stop scan</button>
              <button type="button" onClick={props.onRestart}><RefreshIcon />Restart stopped <b>{rescanCount || ''}</b></button>
              <button type="button" onClick={props.onRetryFailed}><RefreshIcon />Retry failed <b>{props.documents.filter((d) => d.processingStatus === 'failed').length || ''}</b></button>
              <button type="button" onClick={props.onClearCompleted}>Clear completed</button>
              <div className="menu-divider" />
              <div className="scan-settings">
                <label>Scan mode
                  <select value={props.settings.mode} onChange={(e) => props.onSettings({ ...props.settings, mode: e.target.value as 'regular' | 'ocr' })}>
                    <option value="regular">Regular</option>
                    <option value="ocr">OCR</option>
                  </select>
                </label>
                <label>Regular pages
                  <input type="number" min="1" max="50" value={props.settings.regularPages} onChange={(e) => props.onSettings({ ...props.settings, regularPages: Math.max(1, Number(e.target.value) || 3) })} />
                </label>
                <label>OCR pages
                  <input type="number" min="1" max="20" value={props.settings.ocrPages} onChange={(e) => props.onSettings({ ...props.settings, ocrPages: Math.max(1, Number(e.target.value) || 1) })} />
                </label>
              </div>
            </div>
          </details>
        </div>
      </header>

      <StatsStrip documents={props.documents} leads={props.leads} />

      <button
        className={`upload-zone ${drag ? 'drag' : ''}`}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); props.onAddFiles(Array.from(e.dataTransfer.files)); }}
      >
        <UploadIcon />
        <span><b>Upload documents</b><small>PDF, PNG, JPG · multiple files</small></span>
      </button>
      <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => add(e.target.files)} />

      <div className="rows-scroll">
        <LeadRows leads={props.leads} selectedId={props.selectedLeadId} onSelect={props.onSelectLead} />
      </div>
      <AuditSection leads={props.leads} />
    </section>
  );
}
