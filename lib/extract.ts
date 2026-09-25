import { z } from "zod";
import { complete, parseJsonLoose, type JsonSchema } from "./llm";
import type { Article, Claim, Entity, RejectedClaim } from "./types";
import { CLAIM_TYPES } from "./types";
import { statusesFor } from "./status";
import { FORBIDDEN } from "./banned";

const RawClaim = z.object({
  subject_entity_id: z.string().nullable(),
  claim_type: z.enum(CLAIM_TYPES),
  statement: z.string().min(1),
  evidence_quote: z.string().min(1),
});
const RawClaims = z.object({ claims: z.array(RawClaim) });
export type RawClaimT = z.infer<typeof RawClaim>;

const CLAIMS_SCHEMA: JsonSchema = {
  name: "claims",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["subject_entity_id", "claim_type", "statement", "evidence_quote"],
          properties: {
            subject_entity_id: { type: ["string", "null"] },
            claim_type: { type: "string", enum: [...CLAIM_TYPES] },
            statement: { type: "string" },
            evidence_quote: { type: "string" },
          },
        },
      },
    },
  },
};

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function quoteInText(quote: string, text: string): boolean {
  const q = normalizeText(quote);
  return q.length > 0 && normalizeText(text).includes(q);
}

const SYSTEM = `You extract factual claims from a news article for an insurance risk-monitoring tool.
Return ONLY a JSON object: {"claims": [ ... ]}. No prose, no markdown.
Each claim: {"subject_entity_id": string|null, "claim_type": one of ${CLAIM_TYPES.join(", ")}, "statement": string, "evidence_quote": string}.
Rules:
- evidence_quote MUST be copied character-for-character from the article text: one short contiguous clause, 5 to 15 words, just enough to support the claim. Never paraphrase, join fragments, or quote whole paragraphs. Do not add, remove or change punctuation: if the clause continues in the source, end the quote without a period; never use "..." or "…" inside a quote.
- subject_entity_id MUST be one of the provided entity ids, or null if the claim is about none of them. Prefer the facility id when the claim concerns operations at that plant or region (e.g. Aisin's Kumamoto plants -> aisin-kumamoto; Renesas' Kumamoto/Kawajiri plant -> renesas-kawajiri; Toyota's Kyushu vehicle plant -> toyota-kyushu-miyata; Nissan's Kyushu plant -> nissan-kyushu; TSMC's Kumamoto plant -> tsmc-kumamoto; Sony's Kumamoto semiconductor plant -> sony-kumamoto; Tokyo Electron's factory in the area -> tel-kyushu; Honda's Ozu motorcycle factory -> honda-kumamoto; FCC in Uki city -> fcc-uki; Giken Kogyo -> giken-kogyo; Daihatsu's Oita and Kurume factories -> daihatsu-kyushu; TSMC's Hsinchu fabs -> tsmc-hsinchu; TSMC's Taichung fabs -> tsmc-taichung; TSMC's Tainan fabs -> tsmc-tainan; UMC's Hsinchu fabs -> umc-hsinchu). If a claim is about a company's operations in general without naming a site (e.g. "TSMC evacuated some fabs"), use the company id (tsmc, umc).
- claim_type meanings: production_halted (operations suspended/stopped, including evacuations), facility_damaged (physical damage), supply_disruption (parts shortage affecting a customer), supplier_relationship (A supplies B), resumption (restart: planned, partial or full), event_fact (magnitude, location, casualties of the event itself; state the magnitude exactly as the source gives it).
- For resumption claims, keep the source's tense and scope in the statement: say whether the restart already happened or is planned/expected, and whether it is partial or full.
- For supplier_relationship claims, the statement must name both supplier and customer.
- statement: one short neutral sentence. Never include dollar amounts, percentages, durations or probabilities in the statement; describe them qualitatively instead (the quote may keep the source's figures).
- Extract at most 15 claims. Only include what the text states.`;

export const REJECT_QUOTE = "quote not found in source";
export const REJECT_BANNED = "contains a figure ARGUS never displays";

export async function extractRaw(article: Article, text: string, entities: Entity[]): Promise<RawClaimT[]> {
  const entityList = entities.map((e) => `- ${e.id}: ${e.name} (${e.type})`).join("\n");
  const user = `Entities:\n${entityList}\n\nArticle (${article.source_name}, ${article.published_at}):\n"""\n${text}\n"""`;
  const out = await complete({ system: SYSTEM, user, jsonSchema: CLAIMS_SCHEMA });
  return RawClaims.parse(parseJsonLoose(out)).claims;
}

// Deterministic: same raw claims + same text always give the same accepted/rejected split.
export function verifyClaims(
  article: Article,
  text: string,
  raw: RawClaimT[],
  entities: Entity[],
): { accepted: RawClaimT[]; rejected: RejectedClaim[] } {
  const ids = new Set(entities.map((e) => e.id));
  const accepted: RawClaimT[] = [];
  const rejected: RejectedClaim[] = [];
  for (const c of RawClaims.parse({ claims: raw }).claims) {
    if (!quoteInText(c.evidence_quote, text)) {
      rejected.push({ article_id: article.id, statement: c.statement, evidence_quote: c.evidence_quote, reason: REJECT_QUOTE });
      continue;
    }
    if (FORBIDDEN.test(c.statement)) {
      rejected.push({ article_id: article.id, statement: c.statement, evidence_quote: c.evidence_quote, reason: REJECT_BANNED });
      continue;
    }
    accepted.push({ ...c, subject_entity_id: c.subject_entity_id && ids.has(c.subject_entity_id) ? c.subject_entity_id : null });
  }
  return { accepted, rejected };
}

export async function extractFromArticle(
  article: Article,
  text: string,
  entities: Entity[],
): Promise<{ accepted: RawClaimT[]; rejected: RejectedClaim[] }> {
  return verifyClaims(article, text, await extractRaw(article, text, entities), entities);
}

export function assignStatuses(
  raw: { article: Article; claim: RawClaimT }[],
  startIndex = 1,
): Claim[] {
  const st = statusesFor(raw.map(({ article, claim }) => ({ article, subject: claim.subject_entity_id, type: claim.claim_type })));
  return raw.map(({ article, claim }, i) => {
    return {
      claim_id: `C${startIndex + i}`,
      event_id: article.event_id,
      article_id: article.id,
      subject_entity_id: claim.subject_entity_id,
      claim_type: claim.claim_type,
      statement: claim.statement,
      evidence_quote: claim.evidence_quote,
      status: st[i],
    };
  });
}
