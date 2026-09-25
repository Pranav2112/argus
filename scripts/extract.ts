import { createHash } from "node:crypto";
import { loadArticles, loadArticleText, loadEdges, loadEntities, readJson, writeJson } from "../lib/data";
import { assignStatuses, extractRaw, verifyClaims, type RawClaimT } from "../lib/extract";
import { linkClaimsToEdges } from "../lib/link";
import { llmInfo, llmLabel } from "../lib/llm";
import type { Article, ClaimsFile, RejectedClaim } from "../lib/types";

// Raw LLM output per article, keyed by a hash of the article text. Unchanged articles are
// never re-sent to the LLM, so adding new sources cannot shift existing results.
type RawCache = Record<string, { hash: string; raw: RawClaimT[] }>;
const CACHE = "extract_cache.json";
const fresh = process.argv.includes("--fresh");

async function main() {
  const info = llmInfo();
  console.log(`LLM: ${llmLabel()}${fresh ? " (--fresh: ignoring cached LLM output)" : ""}`);
  const articles = loadArticles();
  const entities = loadEntities();
  const cache = readJson<RawCache>(CACHE, {});
  const raw: { article: Article; claim: RawClaimT }[] = [];
  const rejected: RejectedClaim[] = [];

  for (const article of articles) {
    const text = loadArticleText(article);
    if (!text.trim()) {
      console.log(`skip ${article.id}: data/articles/${article.file} is empty`);
      continue;
    }
    const hash = createHash("sha256").update(text).digest("hex");
    let rawClaims = !fresh && cache[article.id]?.hash === hash ? cache[article.id].raw : null;
    const cached = !!rawClaims;
    if (!rawClaims) {
      if (info.error) {
        console.error(`${article.id}: no cached extraction and ${info.error} Skipped.`);
        continue;
      }
      try {
        rawClaims = await extractRaw(article, text, entities);
        cache[article.id] = { hash, raw: rawClaims };
      } catch (err) {
        console.error(`${article.id}: extraction failed:`, (err as Error).message);
        continue;
      }
    }
    const res = verifyClaims(article, text, rawClaims, entities);
    res.accepted.forEach((claim) => raw.push({ article, claim }));
    rejected.push(...res.rejected);
    console.log(`${article.id}: ${res.accepted.length} accepted, ${res.rejected.length} rejected${cached ? " (cached LLM output)" : ""}`);
  }

  writeJson(CACHE, cache);
  const before = readJson<ClaimsFile>("claims.json", { generated_at: "", claims: [], rejected: [] }).claims;
  const edgesBefore = loadEdges();
  const claims = assignStatuses(raw);
  const edges = linkClaimsToEdges(edgesBefore, claims, entities);
  const out: ClaimsFile = { generated_at: new Date().toISOString(), claims, rejected };
  writeJson("claims.json", out);
  writeJson("edges.json", edges);

  // Summaries cite claim and edge ids: keep them only if every previously cited id still means the same thing.
  const next = new Map(claims.map((c) => [c.claim_id, JSON.stringify(c)]));
  const claimsStable = before.every((c) => next.get(c.claim_id) === JSON.stringify(c));
  const edgeMap = new Map(edges.map((e) => [e.id, JSON.stringify(e)]));
  const edgesStable = edgesBefore.every((e) => edgeMap.get(e.id) === JSON.stringify(e));
  if (claimsStable && edgesStable) {
    console.log(`wrote ${claims.length} claims (${rejected.length} rejected); existing claims and edges unchanged, explanation cache kept`);
  } else {
    writeJson("explanations.json", {});
    writeJson("briefs.json", {});
    console.log(`wrote ${claims.length} claims (${rejected.length} rejected); edges linked; explanation cache cleared`);
  }
}

main();
