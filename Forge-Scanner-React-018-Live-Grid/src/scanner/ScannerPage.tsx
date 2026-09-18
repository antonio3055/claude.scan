import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueuePanel } from './components/QueuePanel';
import { LeadsSheet } from './components/LeadsSheet';
import { AuditTable } from './components/AuditTable';
import { RoutingPanel, type RoutingInterpreter } from './components/RoutingPanel';
import { OptionsModal } from './components/OptionsModal';
import { OcrFilesModal } from './components/OcrFilesModal';
import { buildLeads, assertEngineReady } from './lib/leads';
import { exportLeadsToXlsx } from './lib/xlsxExport';
import { useScannerQueue } from './hooks/useScannerQueue';
import { ensureLocalFonts } from './services/offlineVendor';
import type { LeadAssignment, Rep, ScannerLead } from './types/scanner';
import './styles/scanner.css';

export interface ScannerPageProps {
  reps?: Rep[];
  onSendLeads?: (assignments: LeadAssignment[], leads: ScannerLead[]) => Promise<void> | void;
  routingInterpreter?: RoutingInterpreter;
  className?: string;
}

export function ScannerPage({ reps = [], onSendLeads, routingInterpreter, className = '' }: ScannerPageProps) {
  const scanner = useScannerQueue();
  const leads = useMemo(() => buildLeads(scanner.documents), [scanner.documents]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [ocrFilesOpen, setOcrFilesOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [storageEpoch, setStorageEpoch] = useState(0);
  const readyToSend = leads.filter((l) => l.status === 'complete' && l.companyName !== 'Unassociated').length;

  // The Results sheet fills remaining space by default (sheetHeight === null).
  // Dragging the handle below it pins an explicit height instead, so the
  // user can make it taller than the viewport -- the page scrolls to it.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const sheetWrapRef = useRef<HTMLDivElement>(null);

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const current = sheetWrapRef.current?.getBoundingClientRect().height ?? 400;
    dragStart.current = { y: e.clientY, height: current };
  }, []);
  const onResizeMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const next = Math.max(220, dragStart.current.height + (e.clientY - dragStart.current.y));
    setSheetHeight(next);
  }, []);
  const onResizeEnd = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).hasPointerCapture?.(e.pointerId)) (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragStart.current = null;
  }, []);

  useEffect(() => {
    assertEngineReady();
    ensureLocalFonts();
  }, []);

  return (
    <div className={`forge-scanner ${className}`.trim()}>
      <QueuePanel
        documents={scanner.documents}
        leads={leads}
        running={scanner.running}
        paused={scanner.paused}
        onAddFiles={(files) => void scanner.addFiles(files)}
        onPause={scanner.pause}
        onResume={scanner.resume}
        onRun={() => void scanner.runQueue()}
        onStop={() => void scanner.stop()}
        onRestart={() => void scanner.restart()}
        onRetryFailed={() => void scanner.retryFailed()}
        onRunOcr={() => void scanner.runOcrOnFlagged()}
        onClearCompleted={() => void scanner.clearCompleted()}
        onOpenOptions={() => setOptionsOpen(true)}
        onOpenOcrFiles={() => setOcrFilesOpen(true)}
        onOpenSend={() => setSendOpen(true)}
        readyToSend={readyToSend}
      />

      <div className="scanner-main">
        <div
          className="leads-sheet-wrap"
          ref={sheetWrapRef}
          style={sheetHeight ? { flex: `0 0 ${sheetHeight}px` } : undefined}
        >
          <LeadsSheet leads={leads} onExport={() => exportLeadsToXlsx(leads)} />
          <div
            className="leads-sheet-resize-handle"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            title="Drag to resize"
          />
        </div>
        <AuditTable documents={scanner.documents} />
      </div>

      {optionsOpen && (
        <OptionsModal
          settings={scanner.settings}
          onSettings={scanner.setSettings}
          onClose={() => setOptionsOpen(false)}
          onClearStorage={() => {
            void scanner.clearStorage().then(() => setStorageEpoch((n) => n + 1));
          }}
          storageEpoch={storageEpoch}
        />
      )}
      {ocrFilesOpen && <OcrFilesModal documents={scanner.documents} onClose={() => setOcrFilesOpen(false)} />}
      {sendOpen && (
        <RoutingPanel leads={leads} reps={reps} onSendLeads={onSendLeads} routingInterpreter={routingInterpreter} onClose={() => setSendOpen(false)} />
      )}
    </div>
  );
}

export default ScannerPage;
