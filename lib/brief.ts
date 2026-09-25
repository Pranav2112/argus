import { z } from "zod";
import { complete, parseJsonLoose, type JsonSchema } from "./llm";
import { readJson, tryWriteJson } from "./data";
import { loadBundle } from "./bundle";
import { briefSignature, computeBlastRadius, RECOVERY_RULE } from "./blastRadius";
import { validateExplanation } from "./explain";
import type { AccountAlert } from "./types";

const Out = z.object({ sentences: z.array(z.string()) });
const BRIEF_SCHEMA: JsonSchema = {
  name: "event_brief",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sentences"],
    properties: { sentences: { type: "array", items: { type: "string" } } },
  },
};

const SYSTEM = `You write a short, sober portfolio brief for insurance underwriters about one catastrophe event.
Return ONLY JSON: {"sentences": [string]}.
- 3 to 5 sentences. Every sentence MUST end with one or more citation tags drawn only from the provided ids, e.g. "... [C3]." or "... [E1][C7]." Use [C#] for claims and [E#] for edges.
- Lead with which accounts need review now and why, then what is only reported or unknown.
- Use "potentially exposed" for accounts and "recommend review" for next steps. Do not assert certainty beyond the claim status given (CONFIRMED vs REPORTED).
- Never state dollar amounts, losses, durations, percentages, or probabilities. If something is UNKNOWN, you may say it is unknown.
- All accounts are SYNTHETIC demonstration data; refer to them by name.
- An account marked RESOLVED depends on a plant with a CONFIRMED full restoration: say it recovered, cite the recovery claim, and do not call it exposed. RECOVERING means a restart was reported but is not yet confirmed complete.`;

export interface Brief {
  sentences: string[];
  removed: number;
  cached: boolean;
  generated_at: string;
  error?: string;
  stale?: boolean;
}

type Cache = Record<string, Omit<Brief, "cached" | "error" | "stale">>;

export async function brief(eventId: string, assumePersists: boolean, expected?: string): Promise<Brief> {
  const b = loadBundle();
  const event = b.events.find((e) => e.id === eventId);
  if (!event) throw new Error(`unknown event ${eventId}`);
  const result = computeBlastRadius({
    event, claims: b.claims, edges: b.edges, entities: b.entities, accounts: b.accounts, articles: b.articles, assumePersists,
  });
  const alerts = result.alerts.filter((a) => a.tier !== "NO ACTION" || a.resolved);
  const signature = briefSignature(result.alerts);
  if (expected !== undefined && expected !== signature) {
    return { sentences: [], removed: 0, cached: false, generated_at: "", stale: true, error: "brief exists for the latest sources only" };
  }
  const key = `${eventId}:${assumePersists}:${signature}`;
  const cache = readJson<Cache>("briefs.json", {});
  if (cache[key]) return { ...cache[key], cached: true };

  const names = Object.fromEntries([...b.entities.map((e) => [e.id, e.short_name ?? e.name]), ...b.accounts.map((a) => [a.id, a.name])]);
  const union: AccountAlert = {
    ...alerts[0],
    claimIds: [...new Set(alerts.flatMap((a) => a.claimIds))],
    pathEdgeIds: [...new Set(alerts.flatMap((a) => a.pathEdgeIds))],
  };
  try {
    if (!alerts.length) throw new Error("no exposed accounts to brief");
    const claimIds = new Set(union.claimIds);
    const user = JSON.stringify(
      {
        event: { title: event.title, magnitude: event.magnitude ?? "UNKNOWN", occurred_at: event.occurred_at ?? "UNKNOWN" },
        de_escalation_rule: alerts.some((a) => a.recovery) ? RECOVERY_RULE : undefined,
        accounts: alerts.map((a) => ({
          name: a.account.name,
          tier: a.resolved ? "RESOLVED" : a.tier,
          why: a.headline,
          recovery: a.recovery ?? undefined,
          direct_exposure: a.direct,
          path: a.path.map((id) => names[id] ?? id),
          path_edges: a.pathEdgeIds,
          claims: a.claimIds,
          unknowns: a.unknowns,
        })),
        claims: b.claims.filter((c) => claimIds.has(c.claim_id)).map((c) => ({ id: c.claim_id, status: c.status, type: c.claim_type, statement: c.statement })),
        edges: b.edges.filter((e) => union.pathEdgeIds.includes(e.id)).map((e) => ({
          id: e.id,
          from: names[e.from] ?? e.from,
          to: names[e.to] ?? e.to,
          origin: e.origin,
          criticality: e.criticality,
          alt_supplier_known: e.alt_supplier_known ?? "UNKNOWN",
        })),
      },
      null,
      2,
    );
    const out = Out.parse(parseJsonLoose(await complete({ system: SYSTEM, user, jsonSchema: BRIEF_SCHEMA, maxTokens: 1000 })));
    const v = validateExplanation({ sentences: out.sentences, actions: [] }, union);
    if (!v.sentences.length) throw new Error("no sentences survived citation validation");
    const entry = { sentences: v.sentences, removed: v.removed, generated_at: new Date().toISOString() };
    cache[key] = entry;
    tryWriteJson("briefs.json", cache);
    return { ...entry, cached: false };
  } catch (err) {
    const fallbackKey = Object.keys(cache).find((k) => k.startsWith(`${eventId}:${assumePersists}:`));
    if (fallbackKey) return { ...cache[fallbackKey], cached: true };
    return { sentences: [], removed: 0, cached: false, generated_at: "", error: (err as Error).message };
  }
}
