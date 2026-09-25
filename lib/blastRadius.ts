import type { Account, AccountAlert, Article, Claim, Edge, Entity, EventRecord, PlantState, PriorityTier } from "./types";
import { groupIds, isCompanyLevel } from "./groups";

export const DISRUPTION_TYPES = new Set(["production_halted", "facility_damaged", "supply_disruption"]);
export const MEMORY_EVENT = "kumamoto-2016";
const MAX_HOPS = 3;

export const TIER_RULES: Record<PriorityTier, string> = {
  "REVIEW NOW":
    "Path to an affected facility with a CONFIRMED claim AND account dependency is critical AND alternate supplier is not known.",
  MONITOR: "Any other path to an affected facility, or insured location inside the event region (direct).",
  "NO ACTION": "No dependency path to any affected facility and no direct exposure.",
};

export const RECOVERY_RULE =
  "De-escalation: each plant's status follows its claims in publication order and only moves forward, DISRUPTED → RECOVERING → RECOVERED. " +
  "RECOVERING = a verified claim of a past-tense resumption (partial, or full but not yet CONFIRMED). " +
  "RECOVERED = a CONFIRMED claim (tier 1–2 source or 2+ independent publishers) of a past-tense full restoration. " +
  "Planned or expected restarts never change status. RECOVERING caps REVIEW NOW at MONITOR. " +
  "RECOVERED: the path no longer counts as affected and the account is shown as RESOLVED.";

export const DIRECT_LABEL = "DIRECT — covered by existing catastrophe tools";

export interface BlastInput {
  event: EventRecord;
  claims: Claim[];
  edges: Edge[];
  entities: Entity[];
  accounts: Account[];
  assumePersists?: boolean;
  // Publication dates order the plant-status timeline; without them, claim order is used.
  articles?: Article[];
}

export interface BlastResult {
  affected: Record<string, Claim[]>;
  plantStates: Record<string, PlantState>;
  alerts: AccountAlert[];
  reachedNodes: string[];
  reachedEdges: string[];
}

// Keyed by plant node: company-level reports (e.g. "tsmc") attach to every grouped plant in the event region.
export function affectedFacilities(event: EventRecord, claims: Claim[]): Record<string, Claim[]> {
  const out: Record<string, Claim[]> = {};
  for (const c of claims) {
    if (c.event_id !== event.id) continue;
    if (!DISRUPTION_TYPES.has(c.claim_type)) continue;
    if (c.status !== "CONFIRMED" && c.status !== "REPORTED") continue;
    for (const node of groupIds(c.subject_entity_id, event.region)) (out[node] ??= []).push(c);
  }
  return out;
}

// Classified from the verbatim, verified quote; planned/expected wording in quote or statement always wins.
const PLANNED =
  /\b(will|would|shall|plans?|planned|planning|expects?|expected|expecting|aims?|aiming|intends?|intending|scheduled|set to|hopes?|hoping|once|moving to|working to|targets?|targeting|next week|soon)\b/i;
const PAST =
  /\b(resumed|restored|recovered|restarted|reopened|returned|began|begun|started|exceeded|reached|achieved|back online|has been|have been|were back|was back)\b/i;
const FULL =
  /\b(fully|full|completely|entirely|back to normal|returned to normal|normal operations|all (of )?(the |its |our )?[\w-]*\s?(fabs?|tools?|equipment|production|operations|lines|plants?|facilities))\b|\b(9\d|100)(\.\d+)?\s?(%|percent)/i;

export function resumptionKind(c: Claim): "planned" | "partial" | "full" | null {
  if (c.claim_type !== "resumption") return null;
  const said = (s: string) => s.replace(/\b(than|as) (expected|planned)\b/gi, "");
  if (PLANNED.test(said(c.statement)) || PLANNED.test(said(c.evidence_quote))) return "planned";
  if (!PAST.test(c.evidence_quote)) return "planned";
  return FULL.test(c.evidence_quote) ? "full" : "partial";
}

export function plantStates(event: EventRecord, claims: Claim[], articles?: Article[]): Record<string, PlantState> {
  const date = new Map((articles ?? []).map((a) => [a.id, a.published_at]));
  const ordered = claims
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.event_id === event.id && (c.status === "CONFIRMED" || c.status === "REPORTED"))
    .sort((a, b) => (date.get(a.c.article_id) ?? "").localeCompare(date.get(b.c.article_id) ?? "") || a.i - b.i);
  const out: Record<string, PlantState> = {};
  for (const { c } of ordered) {
    const nodes = groupIds(c.subject_entity_id, event.region);
    if (DISRUPTION_TYPES.has(c.claim_type)) {
      for (const n of nodes) out[n] ??= { status: "DISRUPTED", causeClaimId: c.claim_id };
      continue;
    }
    const kind = resumptionKind(c);
    if (kind === "full" && c.status === "CONFIRMED") {
      for (const n of nodes) if (out[n] && out[n].status !== "RECOVERED") out[n] = { status: "RECOVERED", causeClaimId: c.claim_id };
    } else if (kind === "partial" || kind === "full") {
      for (const n of nodes) if (out[n]?.status === "DISRUPTED") out[n] = { status: "RECOVERING", causeClaimId: c.claim_id };
    }
  }
  return out;
}

interface Path {
  nodes: string[];
  edges: Edge[];
}

function pathsFrom(start: string, edges: Edge[]): Path[] {
  const out: Path[] = [];
  const queue: Path[] = [{ nodes: [start], edges: [] }];
  while (queue.length) {
    const p = queue.shift()!;
    out.push(p);
    if (p.edges.length >= MAX_HOPS) continue;
    const tail = p.nodes[p.nodes.length - 1];
    for (const e of edges) {
      if (e.from !== tail || p.nodes.includes(e.to) || e.relation === "located_in_region") continue;
      queue.push({ nodes: [...p.nodes, e.to], edges: [...p.edges, e] });
    }
  }
  return out;
}

const RANK: Record<PriorityTier, number> = { "REVIEW NOW": 2, MONITOR: 1, "NO ACTION": 0 };

// Accounts downstream of the given nodes. Used for unverified proximity alerts, never for tiers.
export function downstreamAccounts(nodeIds: string[], edges: Edge[], accounts: Account[]): string[] {
  const ids = new Set(accounts.map((a) => a.id));
  const out = new Set<string>();
  for (const n of nodeIds) {
    for (const p of pathsFrom(n, edges)) {
      const tail = p.nodes[p.nodes.length - 1];
      if (p.edges.length && ids.has(tail)) out.add(tail);
    }
  }
  return [...out];
}

// Identifies the tier outcome an event brief was written for.
export const briefSignature = (alerts: AccountAlert[]) =>
  alerts
    .filter((a) => a.tier !== "NO ACTION" || a.resolved)
    .map((a) => `${a.account.id}=${a.resolved ? "RESOLVED" : a.tier}`)
    .join(",");

const altText = (v: boolean | null) => (v === true ? "alternate supplier known" : v === false ? "no known alternate supplier" : "alternate supplier UNKNOWN");

export function computeBlastRadius(input: BlastInput): BlastResult {
  const { event, claims, edges, entities, accounts, assumePersists } = input;
  const affected = affectedFacilities(event, claims);
  const states = plantStates(event, claims, input.articles);
  const allPaths = Object.keys(affected).flatMap((f) => pathsFrom(f, edges));
  const eventClaims = claims.filter((c) => c.event_id === event.id);
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const short = (id: string) => entityById.get(id)?.short_name ?? entityById.get(id)?.name ?? accounts.find((a) => a.id === id)?.name ?? id;

  const reachedNodes = new Set<string>(Object.keys(affected));
  const reachedEdges = new Set<string>();

  const alerts = accounts.map((account): AccountAlert => {
    const direct = edges.some(
      (e) => e.relation === "located_in_region" && e.to === account.id && e.from === `region:${event.region}`,
    );
    let best: { tier: PriorityTier; rule: string; headline: string; path: Path; recovering: boolean; decisive: string[] } | null = null;
    let recovered: { path: Path; state: PlantState } | null = null;
    for (const p of allPaths) {
      if (p.nodes[p.nodes.length - 1] !== account.id || !p.edges.length) continue;
      p.nodes.forEach((n) => reachedNodes.add(n));
      p.edges.forEach((e) => reachedEdges.add(e.id));
      const state = states[p.nodes[0]];
      if (state?.status === "RECOVERED") {
        if (!recovered || p.edges.length < recovered.path.edges.length) recovered = { path: p, state };
        continue;
      }
      const recovering = state?.status === "RECOVERING";
      const confirmedClaims = affected[p.nodes[0]].filter((c) => c.status === "CONFIRMED");
      const confirmed = confirmedClaims.length > 0;
      const last = p.edges[p.edges.length - 1];
      const escalated = !!assumePersists && last.criticality === "moderate";
      const critical = last.criticality === "critical" || escalated;
      const review = confirmed && critical && last.alt_supplier_known !== true;
      const tier: PriorityTier = review && !recovering ? "REVIEW NOW" : "MONITOR";
      const origin = short(p.nodes[0]);
      const altRule = last.alt_supplier_known === true ? "known" : last.alt_supplier_known === false ? "none known" : "UNKNOWN";
      const rule =
        review && recovering
          ? `MONITOR (capped): CONFIRMED disruption at ${p.nodes[0]} with a ${last.criticality} dependency would be REVIEW NOW, but ${p.nodes[0]} is RECOVERING (verified past-tense resumption, ${state.causeClaimId}).`
          : review
            ? `REVIEW NOW: CONFIRMED disruption at ${p.nodes[0]}; dependency ${last.criticality}${
                escalated ? " (escalated: disruption assumed to persist)" : ""
              }; alternate supplier ${last.alt_supplier_known === false ? "none known" : "UNKNOWN"}.`
            : `MONITOR: path to affected facility ${p.nodes[0]} (${confirmed ? "CONFIRMED" : "REPORTED only"}; dependency ${
                last.criticality
              }; alternate supplier ${altRule})${recovering ? `; plant RECOVERING (${state.causeClaimId})` : ""}.`;
      const headline = `${confirmed ? "Confirmed" : "Reported (not yet confirmed)"} disruption at ${origin}${
        recovering ? ", now RECOVERING (past-tense resumption verified)" : ""
      } + ${last.criticality} dependency${escalated ? " (assumed to persist)" : ""} + ${altText(last.alt_supplier_known)}.`;
      const decisive = recovering ? [state.causeClaimId] : (review ? confirmedClaims : affected[p.nodes[0]]).map((c) => c.claim_id);
      if (!best || RANK[tier] > RANK[best.tier] || (tier === best.tier && p.edges.length < best.path.edges.length)) {
        best = { tier, rule, headline, path: p, recovering, decisive };
      }
    }

    if (!best && direct) {
      reachedNodes.add(account.id);
      return {
        account,
        tier: "MONITOR",
        rule: `MONITOR: ${DIRECT_LABEL}. Insured location inside the ${event.region} event region; no indirect supplier path.`,
        headline: "Insured location is inside the event region. Handled by existing catastrophe tools; no supplier dependency on affected plants.",
        nextSteps: ["monitor event"],
        direct,
        path: [],
        pathEdgeIds: edges.filter((e) => e.to === account.id && e.relation === "located_in_region").map((e) => e.id),
        memory: false,
        claimIds: eventClaims.filter((c) => c.claim_type === "event_fact").map((c) => c.claim_id),
        unknowns: ["Damage status of insured location: UNKNOWN"],
      };
    }

    if (!best && recovered) {
      const { path: rp, state } = recovered;
      const plant = rp.nodes[0];
      const pathSet = new Set(rp.nodes);
      const ids = new Set(eventClaims.filter((c) => groupIds(c.subject_entity_id, event.region).some((n) => pathSet.has(n))).map((c) => c.claim_id));
      rp.edges.forEach((e) => e.claim_ids.forEach((id) => ids.add(id)));
      return {
        account,
        tier: "NO ACTION",
        resolved: true,
        rule: `RESOLVED (NO ACTION): ${plant} is RECOVERED — CONFIRMED past-tense full restoration (${state.causeClaimId}); the path no longer counts as affected.`,
        headline: `${short(plant)} recovered: CONFIRMED full restoration reported (${state.causeClaimId}). The dependency path no longer counts as affected.`,
        nextSteps: [],
        direct,
        path: rp.nodes,
        pathEdgeIds: rp.edges.map((e) => e.id),
        memory: event.id !== MEMORY_EVENT && rp.edges.some((e) => e.first_seen_event === MEMORY_EVENT),
        claimIds: [...ids],
        unknowns: [`Residual effect on ${account.name} after the recovery: UNKNOWN (not in portfolio data)`],
        recovery: { plant, status: "RECOVERED", claimId: state.causeClaimId },
        decisiveClaimIds: [state.causeClaimId],
      };
    }

    if (!best) {
      // Absence of a verified claim is not evidence of no disruption.
      const suppliers = [...new Set(edges.filter((e) => e.to === account.id && e.relation !== "located_in_region").map((e) => short(e.from)))];
      return {
        account,
        tier: "NO ACTION",
        rule: `NO ACTION: no dependency path within ${MAX_HOPS} hops to any facility with a verified disruption claim; no direct exposure.`,
        headline: suppliers.length
          ? `${suppliers.join(", ")}: no verified disruption · UNKNOWN. No insured location in the event region.`
          : "No known dependency on any facility with a verified disruption claim and no insured location in the event region.",
        nextSteps: [],
        direct,
        path: [],
        pathEdgeIds: [],
        memory: false,
        claimIds: [],
        unknowns: suppliers.map((s) => `Status of ${s} in this event: no verified disruption · UNKNOWN`),
      };
    }

    const { path } = best;
    const pathSet = new Set(path.nodes);
    const claimIds = new Set<string>();
    eventClaims
      .filter((c) => groupIds(c.subject_entity_id, event.region).some((n) => pathSet.has(n)))
      .forEach((c) => claimIds.add(c.claim_id));
    path.edges.forEach((e) => e.claim_ids.forEach((id) => claimIds.add(id)));

    const origin = path.nodes[0];
    const unknowns: string[] = [`Inventory buffer at ${account.name} for this dependency: UNKNOWN (not in portfolio data)`];
    for (const e of path.edges) {
      if (e.alt_supplier_known === null) unknowns.push(`Alternate supplier for ${short(e.from)} → ${short(e.to)}: UNKNOWN`);
    }
    for (const n of path.nodes) {
      const ent = entityById.get(n);
      if (ent && (ent.lat === null || ent.lon === null)) unknowns.push(`Location of ${short(n)}: UNKNOWN`);
    }
    if (affected[origin].every((c) => isCompanyLevel(c.subject_entity_id, event.region))) {
      unknowns.push(`Specific ${short(origin)} plant affected: UNKNOWN (company-level report only)`);
    }
    const restarts = eventClaims.filter((c) => groupIds(c.subject_entity_id, event.region).includes(origin) && c.claim_type === "resumption");
    if (!restarts.some((c) => c.status === "CONFIRMED")) {
      unknowns.push(`Confirmed restart date for ${short(origin)}: UNKNOWN (${restarts.length ? "restart only planned or reported" : "no restart reported"})`);
    }
    unknowns.push("Duration of disruption: UNKNOWN (ARGUS does not estimate durations)");
    if (event.magnitude === null) unknowns.push("Event magnitude: UNKNOWN");

    const nextSteps =
      best.tier === "REVIEW NOW"
        ? ["verify supplier operational status", "contact account", "review business-continuity / alternate sourcing"]
        : ["monitor event", "verify supplier operational status"];

    return {
      account,
      tier: best.tier,
      rule: best.rule,
      headline: best.headline,
      nextSteps,
      direct,
      path: path.nodes,
      pathEdgeIds: path.edges.map((e) => e.id),
      memory: event.id !== MEMORY_EVENT && path.edges.some((e) => e.first_seen_event === MEMORY_EVENT),
      claimIds: [...claimIds],
      unknowns,
      recovery: best.recovering ? { plant: origin, status: "RECOVERING", claimId: states[origin].causeClaimId } : null,
      decisiveClaimIds: best.decisive,
    };
  });

  alerts.sort((a, b) => RANK[b.tier] - RANK[a.tier] || Number(!!b.resolved) - Number(!!a.resolved));
  return { affected, plantStates: states, alerts, reachedNodes: [...reachedNodes], reachedEdges: [...reachedEdges] };
}
