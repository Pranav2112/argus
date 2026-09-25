import type { Claim, Edge, Entity } from "./types";
import { groupIds, regionOf } from "./groups";

const LINK_TYPES = new Set(["supplier_relationship", "supply_disruption", "production_halted"]);
const DISRUPTION_TYPES = new Set(["production_halted", "facility_damaged", "supply_disruption"]);
export const MEMORY_EVENT = "kumamoto-2016";

function keyword(id: string, entities: Entity[]): string {
  const e = entities.find((x) => x.id === id);
  return (e?.name ?? id).split(/[\s(]/)[0].toLowerCase();
}

// Real edges: supported by supply-type claims whose text names both sides; otherwise INFERRED.
// Synthetic account edges: remembered from 2016 when the upstream facility had a 2016 disruption claim.
export function linkClaimsToEdges(edges: Edge[], claims: Claim[], entities: Entity[]): Edge[] {
  return edges.map((edge) => {
    if (edge.origin === "SYNTHETIC") {
      const past = claims.filter(
        (c) =>
          c.event_id === MEMORY_EVENT &&
          groupIds(c.subject_entity_id, regionOf(c.event_id)).includes(edge.from) &&
          DISRUPTION_TYPES.has(c.claim_type),
      );
      return { ...edge, first_seen_event: past.length ? MEMORY_EVENT : null, claim_ids: past.map((c) => c.claim_id) };
    }
    const a = keyword(edge.from, entities);
    const b = keyword(edge.to, entities);
    const matches = claims.filter((c) => {
      if (!LINK_TYPES.has(c.claim_type)) return false;
      const t = `${c.statement} ${c.evidence_quote}`.toLowerCase();
      return t.includes(a) && t.includes(b);
    });
    return {
      ...edge,
      claim_ids: matches.map((c) => c.claim_id),
      origin: matches.length ? "PUBLIC_VERIFIED" : "INFERRED",
      first_seen_event: matches.some((c) => c.event_id === MEMORY_EVENT) ? MEMORY_EVENT : null,
    };
  });
}
