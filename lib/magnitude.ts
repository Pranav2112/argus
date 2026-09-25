import type { Claim, EventRecord } from "./types";

// The USGS magnitude is authoritative; a different figure in an article is shown as CONFLICTING, never applied.
export function statedMagnitude(c: Claim): number | null {
  const text = `${c.statement} ${c.evidence_quote}`;
  const m = text.match(/\b(?:[Mm]agnitude(?:\s+of)?|Mw?)\s*[-:]?\s*(\d(?:\.\d)?)\b/) ?? text.match(/\b(\d\.\d)[-\s][Mm]agnitude\b/);
  return m ? Number(m[1]) : null;
}

export function magnitudeConflict(c: Claim, event: EventRecord): number | null {
  if (c.claim_type !== "event_fact" || c.event_id !== event.id || event.magnitude === null) return null;
  const v = statedMagnitude(c);
  return v !== null && Math.abs(v - event.magnitude) >= 0.05 ? v : null;
}
