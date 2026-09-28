import { useEffect, useRef, useState } from 'react';
import type { ScannerDocument, ScannerLead, ScanSettings } from '../types/scanner';
import { MoreIcon, PauseIcon, PlayIcon, RefreshIcon, SendIcon, StopIcon, UploadIcon } from './ScannerIcons';
import { StatsStrip } from './StatsStrip';
import { StoragePanel } from './StoragePanel';
import { expandZips } from '../lib/zipUpload';
import { useElapsedTimer } from '../hooks/useElapsedTimer';
import { shortFilenameLabel, SETTLED_STATUSES } from '../lib/format';

const ACTIVE_STATUSES = ['validating', 'extracting', 'ocr'];

interface Props {
  documents: ScannerDocument[];
  leads: ScannerLead[];
  running: boolean;
  paused: boolean;
  settings: ScanSettings;
  onSettings: (settings: ScanSettings) => void;
  onAddFiles: (files: File[]) => void;
  onPause: () => void;
  onResume: () => void;
  onRun: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRetryFailed: () => void;
  onRunOcr: () => void;
  onClearCompleted: () => void;
  onOpenOcrFiles: () => void;
  onOpenSend: () => void;
  onClearStorage: () => Promise<void>;
  storageEpoch: number;
  readyToSend: number;
}

/** Upload + run controls and the stats bar. Everything used rarely lives behind the Options modal instead. */
export function QueuePanel(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [unzipProgress, setUnzipProgress] = useState<{ found: number; scanned: number; total: number } | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const rescanCount = props.documents.filter((d) => d.processingStatus === 'failed' || d.processingStatus === 'stopped').length;
  const queued = props.documents.filter((d) => d.processingStatus === 'queued' || d.processingStatus === 'stopped').length;
  // Files the regular scan reported as scans of paper. OCR reads them only
  // when this count is acted on: nothing here starts OCR on its own.
  const needsOcrCount = props.documents.filter((d) => d.needsOcr && !d.usedOcr).length;
  const usedOcrCount = props.documents.filter((d) => d.usedOcr).length;
  // OCR is by far the slowest stage -- called out by name in the status line
  // (instead of a generic "Scanning") so it's obvious why things have slowed down.
  const ocrRunningCount = props.documents.filter((d) => d.processingStatus === 'ocr').length;
  const elapsed = useElapsedTimer(props.running, props.paused);
  // A worker cold-start (loading the OCR engine's WASM + language data) can
  // take several real seconds with nothing else visibly changing -- this
  // local flag covers that whole dead zone, from the instant of the click
  // until either a document actually reaches the 'ocr' stage (real progress
  // to show instead) or the run ends without ever getting there (nothing
  // was flagged, a genuine no-op click).
  const [ocrStarting, setOcrStarting] = useState(false);
  const wasRunningRef = useRef(false);
  useEffect(() => {
    if (ocrRunningCount > 0) setOcrStarting(false);
    else if (wasRunningRef.current && !props.running) setOcrStarting(false);
    wasRunningRef.current = props.running;
  }, [props.running, ocrRunningCount]);
  const activeDoc = props.documents.find((d) => ACTIVE_STATUSES.includes(d.processingStatus));
  const settledCount = props.documents.filter((d) => SETTLED_STATUSES.includes(d.processingStatus)).length;

  const ingest = async (list: File[]) => {
    if (!list.length) return;
    setUnzipping(true);
    setUnzipProgress(null);
    // Zip inflate is CPU-bound and single-threaded; without an explicit
    // yield here the browser can go straight from this state update into a
    // long synchronous stretch without ever painting it -- "accepted" would
    // never actually appear on screen. Two rAFs guarantee a real paint
    // happens first.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      const { files, notices: found } = await expandZips(list, (foundCount, scanned, total) => {
        setUnzipProgress({ found: foundCount, scanned, total });
      });
      if (found.length) setNotices((prev) => [...found, ...prev].slice(0, 8));
      if (files.length) props.onAddFiles(files);
    } finally {
      setUnzipping(false);
      setUnzipProgress(null);
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
          <span>
            <b>
              {unzipping
                ? 'Zip accepted -- reading…'
                : props.running
                  ? `Scanning ${settledCount} / ${props.documents.length}`
                  : 'Drop documents here'}
            </b>
            <small>
              {unzipping
                ? (unzipProgress
                    ? `${unzipProgress.found} document${unzipProgress.found === 1 ? '' : 's'} found · ${unzipProgress.scanned} / ${unzipProgress.total} entries scanned`
                    : 'Unpacking…')
                : props.running
                  ? (activeDoc ? shortFilenameLabel(activeDoc.filename) : 'Processing queue…')
                  : 'or click to browse · PDF, PNG, JPG, or a .zip of them'}
            </small>
          </span>
          {props.running && props.documents.length > 0 && (
            <div className="dropzone-progress" title={`${settledCount} / ${props.documents.length} settled`}>
              <div className="dropzone-progress-fill" style={{ width: `${Math.round((settledCount / props.documents.length) * 100)}%` }} />
            </div>
          )}
        </button>
        <input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.zip" hidden onChange={(e) => add(e.target.files)} />

        <div className="toolbar-center">
          <div className="toolbar-title-row">
            <h1>Scanner</h1>
            <span>
              {props.running
                ? (props.paused ? 'Paused' : ocrRunningCount ? `Running OCR (${ocrRunningCount}) -- this is the slow part` : 'Scanning')
                : queued
                  ? `${queued} queued`
                  : needsOcrCount
                    ? `Scan complete -- ${needsOcrCount} need${needsOcrCount === 1 ? 's' : ''} OCR`
                    : 'Ready'}
            </span>
          </div>
          <StatsStrip documents={props.documents} leads={props.leads} elapsed={elapsed} />
        </div>

        <div className="toolbar-controls">
          <div className="page-limits" title="Pages read per file before the scan stops reading it">
            <label>Reg
              <input
                data-field="regular-pages"
                type="number" min="1" max="9999" value={props.settings.regularPages}
                onChange={(e) => props.onSettings({ ...props.settings, regularPages: Math.max(1, Number(e.target.value) || 9999) })}
              />
            </label>
            <label>OCR
              <input
                data-field="ocr-pages"
                type="number" min="1" max="9999" value={props.settings.ocrPages}
                onChange={(e) => props.onSettings({ ...props.settings, ocrPages: Math.max(1, Number(e.target.value) || 9999) })}
              />
            </label>
          </div>
          <div className="options-row">
            <label className="option-pill" title="Whether a scan reads pages as printed text or goes straight to OCR">Mode
              <select data-field="scan-mode" value={props.settings.mode} onChange={(e) => props.onSettings({ ...props.settings, mode: e.target.value as 'regular' | 'ocr' })}>
                <option value="regular">Regular</option>
                <option value="ocr">OCR</option>
              </select>
            </label>
            <label className="option-pill" title="OCR is by far the slowest stage. Off: flagged files wait for Run OCR. On: a regular scan runs OCR on them automatically right after.">Auto OCR
              <select data-field="auto-ocr" value={props.settings.autoContinueOcr ? 'on' : 'off'} onChange={(e) => props.onSettings({ ...props.settings, autoContinueOcr: e.target.value === 'on' })}>
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </label>
            <label className="option-pill" title="Your initials go at the front of the exported XLSX filename, e.g. MM9.17.13L1342.xlsx">Initials
              <input
                type="text" maxLength={4} placeholder="MM" value={props.settings.exporterInitials}
                onChange={(e) => props.onSettings({ ...props.settings, exporterInitials: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) })}
              />
            </label>
            <label className="option-pill" title="The application is always scanned first. If its stated revenue is under this amount, that company's statements are skipped. 0 turns this off.">Skip under $
              <input
                type="number" min="0" step="1000" value={props.settings.revenueExclusionThreshold}
                onChange={(e) => props.onSettings({ ...props.settings, revenueExclusionThreshold: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
            <label className="option-pill" title="What happens to a file that's already been uploaded">Dupes
              <select value={props.settings.duplicateHandling} onChange={(e) => props.onSettings({ ...props.settings, duplicateHandling: e.target.value as 'flag' | 'skip' })}>
                <option value="flag">Flag</option>
                <option value="skip">Skip</option>
              </select>
            </label>
          </div>
          <StoragePanel onClear={props.onClearStorage} epoch={props.storageEpoch} />
          <div className="toolbar-controls-row">
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
                <button type="button" onClick={props.onClearCompleted}>Clear completed</button>
                <div className="menu-divider" />
                <button type="button" onClick={props.onOpenOcrFiles}>OCR files <b>{usedOcrCount || ''}</b></button>
                <button type="button" onClick={props.onOpenSend}><SendIcon />Send leads <b>{props.readyToSend || ''}</b></button>
              </div>
            </details>
          </div>
          <button
            className={`toolbar-action-btn${ocrStarting ? ' starting' : ''}`}
            type="button"
            onClick={() => { if (needsOcrCount > 0) setOcrStarting(true); props.onRunOcr(); }}
            title={needsOcrCount ? `${needsOcrCount} file(s) have no text layer and need OCR` : 'No file needs OCR right now -- click anyway to recheck'}
          >
            <RefreshIcon />
            {ocrStarting
              ? 'Starting OCR…'
              : props.running && ocrRunningCount > 0
                ? 'Running OCR…'
                : 'Run OCR'}
            <b>{needsOcrCount || ''}</b>
          </button>
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
