import { useMemo, useState } from 'react';
import { parseRoutingInstruction, type RoutingPreview } from '../lib/routing';
import type { LeadAssignment, Rep, ScannerLead } from '../types/scanner';
import { SendIcon } from './ScannerIcons';

export type RoutingInterpreter = (instruction: string, leads: ScannerLead[], reps: Rep[]) => Promise<RoutingPreview>;

interface Props {
  leads: ScannerLead[];
  reps: Rep[];
  onSendLeads?: (assignments: LeadAssignment[], leads: ScannerLead[]) => Promise<void> | void;
  routingInterpreter?: RoutingInterpreter;
  onClose: () => void;
}

/**
 * A modal, not a permanent panel: sending is a rare, deliberate last step,
 * so it costs the page zero space until it's actually opened.
 */
export function RoutingPanel({ leads, reps, onSendLeads, routingInterpreter, onClose }: Props) {
  const [instructionOpen, setInstructionOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [selectedRepIds, setSelectedRepIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<RoutingPreview>({ assignments: [], understood: false, message: 'No routing preview yet.' });
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const ready = useMemo(() => leads.filter((lead) => lead.status === 'complete' && lead.companyName !== 'Unassociated'), [leads]);
  const selectedReps = reps.filter((rep) => selectedRepIds.includes(rep.id));

  const runInstruction = async () => {
    let next = parseRoutingInstruction(instruction, ready, reps);
    if (!next.understood && routingInterpreter) next = await routingInterpreter(instruction, ready, reps);
    setPreview(next);
  };

  const makeRoundRobin = () => {
    if (!selectedReps.length) {
      setPreview({ assignments: [], understood: false, message: 'Choose at least one rep first.' });
      return;
    }
    setPreview({
      understood: true,
      message: `Round robin across ${selectedReps.map((r) => r.name).join(', ')}.`,
      assignments: ready.map((lead, index) => {
        const rep = selectedReps[index % selectedReps.length];
        return { leadId: lead.id, repId: rep.id, repName: rep.name };
      })
    });
  };

  const send = async () => {
    if (!preview.understood || !preview.assignments.length) {
      setMessage('Create a valid assignment preview first.');
      return;
    }
    if (!onSendLeads) {
      setMessage('CRM send handler is not connected yet. No leads were sent.');
      return;
    }
    setSending(true);
    setMessage('');
    try {
      await onSendLeads(preview.assignments, ready);
      setMessage(`${preview.assignments.length} lead assignments sent to the CRM handler.`);
    } catch (error: any) {
      setMessage(error?.message || 'Sending failed.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="scanner-modal-overlay" onClick={onClose}>
      <div className="scanner-modal routing-modal" onClick={(e) => e.stopPropagation()}>
        <header className="scanner-modal-head">
          <h2>Send · {ready.length} ready</h2>
          <button type="button" className="scanner-modal-close" onClick={onClose} title="Close">✕</button>
        </header>
        <div className="scanner-modal-body">
          <div>
            <h3>Reps</h3>
            {reps.length ? (
              <div className="rep-option-list">
                {reps.map((rep) => (
                  <label className="rep-option" key={rep.id}>
                    <input type="checkbox" checked={selectedRepIds.includes(rep.id)} onChange={(e) => setSelectedRepIds((current) => e.target.checked ? [...current, rep.id] : current.filter((id) => id !== rep.id))} />
                    <span>{rep.name}</span>
                  </label>
                ))}
              </div>
            ) : <p className="muted-copy">No reps connected.</p>}
            <div className="routing-quick-actions">
              <button type="button" onClick={makeRoundRobin}>Round robin selected reps</button>
              <button type="button" onClick={() => {
                if (selectedReps.length !== 1) return setPreview({ assignments: [], understood: false, message: 'Choose exactly one rep.' });
                const rep = selectedReps[0];
                setPreview({ understood: true, message: `All ready leads → ${rep.name}.`, assignments: ready.map((lead) => ({ leadId: lead.id, repId: rep.id, repName: rep.name })) });
              }}>Send all to selected rep</button>
            </div>
          </div>

          <button className="routing-command-toggle" type="button" onClick={() => setInstructionOpen((open) => !open)}>
            <span>Routing instructions</span><small>{instructionOpen ? 'Close' : 'Click to write'}</small>
          </button>

          {instructionOpen && <div className="routing-command-box">
            <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder='Example: "split leads odds and even between Jerry and Mike"' />
            <button type="button" onClick={runInstruction}>Preview</button>
          </div>}

          <div className={`routing-preview ${preview.understood ? 'valid' : ''}`}>
            <div className="routing-preview-head"><span>Assignment preview</span><b>{preview.assignments.length}</b></div>
            <p>{preview.message}</p>
            <div className="assignment-list">
              {preview.assignments.slice(0, 12).map((assignment, index) => {
                const lead = ready.find((item) => item.id === assignment.leadId);
                return <div key={`${assignment.leadId}-${index}`}><span>{lead?.companyName || `Lead ${index + 1}`}</span><b>{assignment.repName}</b></div>;
              })}
              {preview.assignments.length > 12 && <div><span>+ {preview.assignments.length - 12} more</span><b>Preview only</b></div>}
            </div>
          </div>

          <button className="send-primary" type="button" onClick={send}><SendIcon />{sending ? 'Sending…' : 'Send ready leads'}</button>
          {message && <p className="routing-message">{message}</p>}
        </div>
      </div>
    </div>
  );
}
