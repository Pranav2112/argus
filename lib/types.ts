export type Tier = 1 | 2 | 3;

export interface Article {
  id: string;
  url: string;
  source_name: string;
  tier: Tier;
  published_at: string;
  event_id: string;
  file: string;
  date_precision?: "exact" | "approx";
}

export interface EventRecord {
  id: string;
  title: string;
  hazard: string;
  occurred_at: string | null;
  lat: number | null;
  lon: number | null;
  magnitude: number | null;
  source_url: string | null;
  tier: Tier;
  status: string;
  region: string;
  short_title?: string;
  label?: string;
  // false = excluded from the guided RUN DEMO.
  demo?: boolean;
}

export interface Entity {
  id: string;
  name: string;
  type: "facility" | "company";
  lat: number | null;
  lon: number | null;
  coord_precision: string;
  country: string;
  short_name?: string;
}

export interface Account {
  id: string;
  name: string;
  location: string;
  lat: number;
  lon: number;
  description: string;
  synthetic: true;
}

export type Relation = "supplies" | "depends_on" | "ships_for" | "located_in_region";
export type Criticality = "critical" | "moderate" | "low";
export type Origin = "PUBLIC_VERIFIED" | "SYNTHETIC" | "INFERRED";

// Edges point in the direction disruption flows: from = upstream, to = dependent.
export interface Edge {
  id: string;
  from: string;
  to: string;
  relation: Relation;
  label?: string;
  criticality: Criticality;
  alt_supplier_known: boolean | null;
  origin: Origin;
  claim_ids: string[];
  first_seen_event: string | null;
}

export const CLAIM_TYPES = [
  "production_halted",
  "facility_damaged",
  "supply_disruption",
  "supplier_relationship",
  "resumption",
  "event_fact",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];
export type ClaimStatus = "CONFIRMED" | "REPORTED" | "UNKNOWN";

export interface Claim {
  claim_id: string;
  event_id: string;
  article_id: string;
  subject_entity_id: string | null;
  claim_type: ClaimType;
  statement: string;
  evidence_quote: string;
  status: ClaimStatus;
}

export interface RejectedClaim {
  article_id: string;
  statement: string;
  evidence_quote: string;
  reason: string;
}

export interface ClaimsFile {
  generated_at: string;
  claims: Claim[];
  rejected: RejectedClaim[];
}

export type PriorityTier = "REVIEW NOW" | "MONITOR" | "NO ACTION";
export type PlantStatus = "DISRUPTED" | "RECOVERING" | "RECOVERED";

export interface PlantState {
  status: PlantStatus;
  // Claim that moved the plant into this status.
  causeClaimId: string;
}

export interface AccountAlert {
  account: Account;
  tier: PriorityTier;
  rule: string;
  headline: string;
  nextSteps: string[];
  direct: boolean;
  path: string[]; // node ids, affected facility first, account last
  pathEdgeIds: string[];
  memory: boolean;
  claimIds: string[];
  unknowns: string[];
  // Only set when a de-escalation status (RECOVERING / RECOVERED) changed the outcome.
  recovery?: { plant: string; status: Exclude<PlantStatus, "DISRUPTED">; claimId: string } | null;
  // RECOVERED supplier: shown as RESOLVED with NO ACTION styling.
  resolved?: boolean;
  // Claims that decided this tier (used to name the cause of a tier change).
  decisiveClaimIds?: string[];
}

export interface Explanation {
  sentences: string[];
  actions: string[];
  removed: number;
  cached: boolean;
  generated_at: string;
}

export const ALLOWED_ACTIONS = [
  "verify supplier operational status",
  "contact account",
  "review business-continuity / alternate sourcing",
  "escalate to risk engineering",
  "monitor event",
] as const;
