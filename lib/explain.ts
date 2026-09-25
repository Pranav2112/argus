import { z } from "zod";
import { complete, parseJsonLoose, type JsonSchema } from "./llm";
import { readJson, tryWriteJson } from "./data";
import { loadBundle } from "./bundle";
import { computeBlastRadius, RECOVERY_RULE } from "./blastRadius";
import { FORBIDDEN } from "./banned";
import { ALLOWED_ACTIONS, type AccountAlert, type Explanation } from "./types";

const Out = z.object({ sentences: z.array(z.string()), actions: z.array(z.string()) });
const EXPLAIN_SCHEMA: JsonSchema = {
  name: "alert_explanation",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sentences", "actions"],
    properties: {
      sentences: { type: "array", items: { type: "string" } },
      actions: { type: "array", items: { type: "string" } },
    },
  },
};
export function buildAlert(eventId: string, accountId: string, assumePersists: boolean) {
  const b = loadBundle();
  const event = b.events.find((e) => e.id === eventId);
  if (!event) throw new Error(`unknown event ${eventId}`);
  const result = computeBlastRadius({
    event, claims: b.claims, edges: b.edges, entities: b.entities, accounts: b.accounts, articles: b.articles, assumePersists,
  });
  const alert = result.alerts.find((a) => a.account.id === accountId);
  if (!alert) throw new Error(`unknown account ${accountId}`);
  const claims = b.claims.filter((c) => alert.claimIds.includes(c.claim_id));
  const edges = b.edges.filter((e) => alert.pathEdgeIds.includes(e.id));
  const names = Object.fromEntries([...b.entities, ...b.accounts].map((x) => [x.id, x.name]));
  return { event, alert, claims, edges, names };
}

export function validateExplanation(raw: { sentences: string[]; actions: string[] }, alert: AccountAlert) {
  const valid = new Set([...alert.claimIds, ...alert.pathEdgeIds]);
  const sentences: string[] = [];
  let removed = 0;
  for (const s of raw.sentences.map((x) => x.trim()).filter(Boolean)) {
    const trailing = s.match(/((?:\s*\[[CE]\d+\])+)\s*\.?$/);
    const tags = trailing ? [...trailing[1].matchAll(/\[([CE]\d+)\]/g)].map((m) => m[1]) : [];
    const inline = [...s.matchAll(/\[([CE]\d+)\]/g)].map((m) => m[1]);
    if (!tags.length || !inline.every((t) => valid.has(t)) || FORBIDDEN.test(s)) {
      removed++;
      continue;
    }
    sentences.push(s);
  }
  const allowed = new Set<string>(ALLOWED_ACTIONS);
  const actions = [...new Set(raw.actions.map((a) => a.trim().toLowerCase().replace(/\.$/, "")))]
    .filter((a) => allowed.has(a))
    .slice(0, 4);
  return { sentences: sentences.slice(0, 4), actions, removed };
}

const SYSTEM = `You write short, sober risk-alert summaries for insurance underwriters.
Return ONLY JSON: {"sentences": [string], "actions": [string]}.
- 2 to 4 sentences. Every sentence MUST end with one or more citation tags drawn only from the provided ids, e.g. "... [C3]." or "... [E1][C7]." Use [C#] for claims and [E#] for edges.
- Use the phrasing "potentially exposed" for the account and "recommend review" for next steps. Do not assert certainty beyond the claim status given (CONFIRMED vs REPORTED).
- Never state dollar amounts, losses, durations, percentages, or probabilities. If something is UNKNOWN, you may say it is unknown.
- The account is SYNTHETIC demonstration data; refer to it by name.
- If de_escalation is present, explain it using its rule and cite its claim: RECOVERING means a restart has been reported but not confirmed as complete; RESOLVED means a CONFIRMED full restoration, so do not call the account exposed and do not recommend review.
- actions: 2 to 4 items, each copied exactly from this list: ${ALLOWED_ACTIONS.map((a) => `"${a}"`).join(", ")}.`;

type Cache = Record<string, Omit<Explanation, "cached">>;

export async function explain(
  eventId: string,
  accountId: string,
  assumePersists: boolean,
  expectedTier?: string,
): Promise<Explanation & { error?: string; stale?: boolean }> {
  const { event, alert, claims, edges, names } = buildAlert(eventId, accountId, assumePersists);
  const label = alert.resolved ? "RESOLVED" : alert.tier;
  if (expectedTier && expectedTier !== label) {
    return { sentences: [], actions: [], removed: 0, cached: false, generated_at: "", stale: true, error: `summary exists for ${label} (latest sources), not ${expectedTier}` };
  }
  const key = `${eventId}:${accountId}:${label}`;
  const cache = readJson<Cache>("explanations.json", {});
  if (cache[key]) return { ...cache[key], cached: true };

  try {
    const user = JSON.stringify(
      {
        event: { id: event.id, title: event.title, magnitude: event.magnitude ?? "UNKNOWN", occurred_at: event.occurred_at ?? "UNKNOWN" },
        account: { name: alert.account.name, description: alert.account.description, synthetic: true },
        tier: label,
        rule_fired: alert.rule,
        de_escalation: alert.recovery ? { rule: RECOVERY_RULE, plant: names[alert.recovery.plant] ?? alert.recovery.plant, status: alert.recovery.status, claim: alert.recovery.claimId } : null,
        direct_exposure: alert.direct,
        path: alert.path.map((id) => names[id] ?? id),
        memory: alert.memory ? "Dependency first observed during Kumamoto 2016 earthquakes" : null,
        edges: edges.map((e) => ({
          id: e.id,
          from: names[e.from] ?? e.from,
          to: names[e.to] ?? e.to,
          relation: e.label ?? e.relation,
          origin: e.origin,
          criticality: e.criticality,
          alt_supplier_known: e.alt_supplier_known ?? "UNKNOWN",
          first_seen_event: e.first_seen_event,
        })),
        claims: claims.map((c) => ({ id: c.claim_id, event: c.event_id, status: c.status, type: c.claim_type, statement: c.statement })),
        unknowns: alert.unknowns,
      },
      null,
      2,
    );
    const out = Out.parse(parseJsonLoose(await complete({ system: SYSTEM, user, jsonSchema: EXPLAIN_SCHEMA, maxTokens: 1000 })));
    const v = validateExplanation(out, alert);
    if (!v.sentences.length) throw new Error("no sentences survived citation validation");
    const entry = { ...v, generated_at: new Date().toISOString() };
    cache[key] = entry;
    tryWriteJson("explanations.json", cache);
    return { ...entry, cached: false };
  } catch (err) {
    const fallbackKey = Object.keys(cache).find((k) => k.startsWith(`${eventId}:${accountId}:`));
    if (fallbackKey) return { ...cache[fallbackKey], cached: true };
    return { sentences: [], actions: [], removed: 0, cached: false, generated_at: "", error: (err as Error).message };
  }
}
