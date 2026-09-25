import type { Article, Claim, ClaimStatus, ClaimType } from "./types";
import { groupIds, regionOf } from "./groups";

type StatusInput = { article: Article; subject: string | null; type: ClaimType };

// CONFIRMED = tier 1–2 source, or 2+ independent publishers agree on the same plant and claim type.
// Client-safe so replay can recompute statuses from only the sources published so far.
export function statusesFor(items: StatusInput[]): ClaimStatus[] {
  const support = new Map<string, Set<string>>();
  const keys = (eventId: string, subj: string | null, t: ClaimType) =>
    groupIds(subj, regionOf(eventId)).map((node) => `${eventId}|${node}|${t}`);
  for (const { article, subject, type } of items) {
    for (const k of keys(article.event_id, subject, type)) {
      if (!support.has(k)) support.set(k, new Set());
      // Corroboration requires independent publishers, not two pieces from the same outlet.
      support.get(k)!.add(article.source_name);
    }
  }
  return items.map(({ article, subject, type }) => {
    const publishers = new Set(keys(article.event_id, subject, type).flatMap((k) => [...(support.get(k) ?? [])]));
    return article.tier <= 2 || publishers.size >= 2 ? "CONFIRMED" : "REPORTED";
  });
}

// Recompute statuses for one event's claims using only the given articles; other claims pass through.
export function restatus(claims: Claim[], eventId: string, articles: Article[]): Claim[] {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const idx: number[] = [];
  const items: StatusInput[] = [];
  claims.forEach((c, i) => {
    const article = byId.get(c.article_id);
    if (c.event_id !== eventId || !article) return;
    idx.push(i);
    items.push({ article, subject: c.subject_entity_id, type: c.claim_type });
  });
  const st = statusesFor(items);
  const out = claims.slice();
  idx.forEach((i, k) => (out[i] = { ...claims[i], status: st[k] }));
  return out;
}
