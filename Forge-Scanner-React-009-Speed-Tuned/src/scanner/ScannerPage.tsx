import { useEffect, useMemo, useState } from 'react';
import { QueuePanel } from './components/QueuePanel';
import { ExtractionPanel } from './components/ExtractionPanel';
import { RoutingPanel, type RoutingInterpreter } from './components/RoutingPanel';
import { buildLeads, assertEngineReady } from './lib/leads';
import { useResizablePanels } from './hooks/useResizablePanels';
import { useScannerQueue } from './hooks/useScannerQueue';
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
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const selectedLead = leads.find((lead) => lead.id === selectedLeadId) ?? leads[0] ?? null;
  const panels = useResizablePanels();

  useEffect(() => {
    assertEngineReady();
  }, []);

  useEffect(() => {
    if (!selectedLeadId && leads[0]) setSelectedLeadId(leads[0].id);
    if (selectedLeadId && !leads.some((lead) => lead.id === selectedLeadId)) setSelectedLeadId(leads[0]?.id ?? null);
  }, [leads, selectedLeadId]);

  return (
    <div
      className={`forge-scanner ${className}`.trim()}
      style={{ '--scanner-left': `${panels.widths.left}px`, '--scanner-middle': `${panels.widths.middle}px` } as React.CSSProperties}
    >
      <QueuePanel
        documents={scanner.documents}
        leads={leads}
        selectedLeadId={selectedLead?.id ?? null}
        onSelectLead={setSelectedLeadId}
        settings={scanner.settings}
        onSettings={scanner.setSettings}
        running={scanner.running}
        paused={scanner.paused}
        onAddFiles={(files) => void scanner.addFiles(files)}
        onPause={scanner.pause}
        onResume={scanner.resume}
        onRun={() => void scanner.runQueue()}
        onStop={() => void scanner.stop()}
        onRestart={() => void scanner.restart()}
        onRetryFailed={() => void scanner.retryFailed()}
        onClearCompleted={() => void scanner.clearCompleted()}
      />

      <div className="scanner-resize-handle" onPointerDown={(e) => panels.onPointerDown('left', e)} onPointerMove={panels.onPointerMove} onPointerUp={panels.onPointerUp} onDoubleClick={panels.reset} />
      <ExtractionPanel lead={selectedLead} />
      <div className="scanner-resize-handle" onPointerDown={(e) => panels.onPointerDown('middle', e)} onPointerMove={panels.onPointerMove} onPointerUp={panels.onPointerUp} onDoubleClick={panels.reset} />
      <RoutingPanel leads={leads} reps={reps} onSendLeads={onSendLeads} routingInterpreter={routingInterpreter} />
    </div>
  );
}

export default ScannerPage;
