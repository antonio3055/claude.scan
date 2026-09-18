import type { LeadAssignment, Rep, ScannerLead } from '../types/scanner';

const normalize = (value: string) => value.trim().toLowerCase();

function findRep(name: string, reps: Rep[]) {
  const wanted = normalize(name);
  return reps.find((rep) => normalize(rep.name) === wanted)
    ?? reps.find((rep) => normalize(rep.name).includes(wanted) || wanted.includes(normalize(rep.name)));
}

export interface RoutingPreview {
  assignments: LeadAssignment[];
  understood: boolean;
  message: string;
}

export function parseRoutingInstruction(instruction: string, leads: ScannerLead[], reps: Rep[]): RoutingPreview {
  const text = instruction.trim();
  if (!text) return { assignments: [], understood: false, message: 'Type a routing instruction.' };

  // Example: "split leads odds and even between Jerry and Mike"
  const oddEven = text.match(/(?:split\s+)?(?:leads\s+)?(?:odds?\s*(?:and|&)\s*evens?|odd\s*(?:and|&)\s*even)\s+between\s+(.+?)\s+(?:and|&)\s+(.+)$/i);
  if (oddEven) {
    const oddRep = findRep(oddEven[1], reps);
    const evenRep = findRep(oddEven[2], reps);
    if (!oddRep || !evenRep) return { assignments: [], understood: false, message: 'One or both rep names were not found.' };
    const assignments = leads.map((lead, index) => {
      const rep = (index + 1) % 2 === 1 ? oddRep : evenRep;
      return { leadId: lead.id, repId: rep.id, repName: rep.name };
    });
    return { assignments, understood: true, message: `Odd leads → ${oddRep.name}; even leads → ${evenRep.name}.` };
  }

  // Example: "round robin between Jerry, Mike and Sarah"
  const rr = text.match(/round\s*robin(?:\s+leads)?\s+(?:between|across)\s+(.+)$/i);
  if (rr) {
    const names = rr[1].split(/,|\band\b|&/i).map((s) => s.trim()).filter(Boolean);
    const selected = names.map((name) => findRep(name, reps)).filter((rep): rep is Rep => !!rep);
    if (!selected.length || selected.length !== names.length) return { assignments: [], understood: false, message: 'One or more rep names were not found.' };
    const assignments = leads.map((lead, index) => {
      const rep = selected[index % selected.length];
      return { leadId: lead.id, repId: rep.id, repName: rep.name };
    });
    return { assignments, understood: true, message: `Round robin across ${selected.map((r) => r.name).join(', ')}.` };
  }

  // Example: "send leads over $300k to Mike"
  const over = text.match(/(?:send\s+)?leads?\s+(?:over|above)\s+\$?([\d,.]+)\s*(k|m)?\s+to\s+(.+)$/i);
  if (over) {
    const raw = Number(over[1].replace(/,/g, ''));
    const mult = over[2]?.toLowerCase() === 'm' ? 1_000_000 : over[2]?.toLowerCase() === 'k' ? 1_000 : 1;
    const threshold = raw * mult;
    const rep = findRep(over[3], reps);
    if (!rep) return { assignments: [], understood: false, message: 'Rep name was not found.' };
    const assignments = leads.filter((lead) => lead.revenue > threshold).map((lead) => ({ leadId: lead.id, repId: rep.id, repName: rep.name }));
    return { assignments, understood: true, message: `${assignments.length} lead(s) above $${Math.round(threshold).toLocaleString()} → ${rep.name}.` };
  }

  // Example: "send all leads to Jerry"
  const all = text.match(/(?:send\s+)?(?:all\s+)?leads?\s+to\s+(.+)$/i);
  if (all) {
    const rep = findRep(all[1], reps);
    if (!rep) return { assignments: [], understood: false, message: 'Rep name was not found.' };
    return {
      assignments: leads.map((lead) => ({ leadId: lead.id, repId: rep.id, repName: rep.name })),
      understood: true,
      message: `All leads → ${rep.name}.`
    };
  }

  return {
    assignments: [],
    understood: false,
    message: 'This instruction needs the CRM routing interpreter. Nothing will be sent until a valid preview exists.'
  };
}
