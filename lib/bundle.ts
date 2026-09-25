import { loadAccounts, loadArticles, loadClaims, loadEdges, loadEntities } from "./data";
import { getEvents, loadUsgsCache, type UsgsQuake } from "./usgs";
import { llmLabel } from "./llm";
import { shortQuote } from "./quote";
import type { Account, Article, Claim, Edge, Entity, EventRecord, RejectedClaim } from "./types";

export interface Bundle {
  events: EventRecord[];
  usgs: Record<string, UsgsQuake>;
  claims: Claim[];
  rejected: RejectedClaim[];
  claimsGeneratedAt: string | null;
  articles: Article[];
  entities: Entity[];
  accounts: Account[];
  edges: Edge[];
  llm: string;
}

export function loadBundle(): Bundle {
  const cf = loadClaims();
  return {
    events: getEvents(),
    usgs: loadUsgsCache(),
    // Only the short display clause of each quote is ever sent to the browser.
    claims: cf.claims.map((c) => ({ ...c, evidence_quote: shortQuote(c.evidence_quote) })),
    rejected: cf.rejected.map((r) => ({ ...r, evidence_quote: shortQuote(r.evidence_quote) })),
    claimsGeneratedAt: cf.generated_at || null,
    articles: loadArticles(),
    entities: loadEntities(),
    accounts: loadAccounts(),
    edges: loadEdges(),
    llm: llmLabel(),
  };
}
