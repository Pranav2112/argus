import { computeBlastRadius } from "./blastRadius";
import { restatus } from "./status";
import type { AccountAlert, Account, Article, Claim, Edge, Entity, EventRecord } from "./types";

export const tierLabelOf = (a: Pick<AccountAlert, "tier" | "resolved">) => (a.resolved ? "RESOLVED" : a.tier);

export interface TierChange {
  account: Account;
  from: string;
  to: string;
  cause: string | null;
  causeInView: boolean;
}

// Each change names the claim that caused it: a decisive claim that is new or changed status at this step.
export function tierChanges(prev: AccountAlert[], next: AccountAlert[], prevClaims: Claim[], nextClaims: Claim[]): TierChange[] {
  const before = new Map(prev.map((a) => [a.account.id, a]));
  const was = new Map(prevClaims.map((c) => [c.claim_id, c.status]));
  const now = new Set(nextClaims.map((c) => c.claim_id));
  const fresh = new Set(nextClaims.filter((c) => was.get(c.claim_id) !== c.status).map((c) => c.claim_id));
  return next
    .filter((a) => before.has(a.account.id) && tierLabelOf(before.get(a.account.id)!) !== tierLabelOf(a))
    .map((a) => {
      const old = before.get(a.account.id)!;
      const pool = [...(a.decisiveClaimIds ?? []), ...(old.decisiveClaimIds ?? [])];
      const cause = pool.find((id) => fresh.has(id)) ?? pool[0] ?? null;
      return { account: a.account, from: tierLabelOf(old), to: tierLabelOf(a), cause, causeInView: !!cause && now.has(cause) };
    });
}

export const describeChange = (c: TierChange) =>
  `SYNTHETIC · ${c.account.name}: ${c.from} → ${c.to}${!c.cause ? "" : c.causeInView ? ` · cause ${c.cause}` : ` · ${c.cause} no longer in view`}`;

// Claims visible with the first n sources of an event, statuses recomputed from those sources only.
export function claimsAtStep(claims: Claim[], eventId: string, eventArticles: Article[], n: number, extra: Article[] = []): Claim[] {
  const inView = [...eventArticles.slice(0, n), ...extra];
  const shown = new Set(inView.map((a) => a.id));
  return restatus(claims.filter((c) => c.event_id !== eventId || shown.has(c.article_id)), eventId, inView);
}

export function replaySteps(input: { event: EventRecord; claims: Claim[]; articles: Article[]; edges: Edge[]; entities: Entity[]; accounts: Account[] }) {
  const { event, claims, articles } = input;
  const eventArticles = articles.filter((a) => a.event_id === event.id).sort((a, b) => a.published_at.localeCompare(b.published_at));
  const run = (cs: Claim[]) => computeBlastRadius({ ...input, claims: cs });
  let prevClaims = claimsAtStep(claims, event.id, eventArticles, 0);
  let prev = run(prevClaims);
  return eventArticles.map((article, i) => {
    const nextClaims = claimsAtStep(claims, event.id, eventArticles, i + 1);
    const next = run(nextClaims);
    const changes = tierChanges(prev.alerts, next.alerts, prevClaims, nextClaims);
    prevClaims = nextClaims;
    prev = next;
    return { article, result: next, changes };
  });
}
