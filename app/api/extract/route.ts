import { loadArticles, loadArticleText, loadClaims, loadEntities } from "@/lib/data";
import { assignStatuses, extractFromArticle } from "@/lib/extract";
import { shortQuote } from "@/lib/quote";
import type { Article } from "@/lib/types";

const trim = <T extends { evidence_quote: string }>(xs: T[]) => xs.map((x) => ({ ...x, evidence_quote: shortQuote(x.evidence_quote) }));

const MAX_PASTE_CHARS = 20_000;

type Body = {
  article_id?: string;
  event_id?: string;
  text?: string;
  source_name?: string;
  url?: string;
  published_at?: string;
};

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = await req.json();
  } catch {}
  return body.text !== undefined ? pasted(body) : stored(String(body.article_id ?? ""));
}

async function stored(articleId: string) {
  const article = loadArticles().find((a) => a.id === articleId);
  if (!article) return Response.json({ error: `unknown article ${articleId}` }, { status: 400 });

  const cachedResponse = (error: string) => {
    const cf = loadClaims();
    return Response.json({
      cached: true,
      error,
      article_id: article.id,
      claims: trim(cf.claims.filter((c) => c.article_id === article.id)),
      rejected: trim(cf.rejected.filter((r) => r.article_id === article.id)),
    });
  };

  try {
    const text = loadArticleText(article);
    if (!text.trim()) return cachedResponse("article text is empty");
    const { accepted, rejected } = await extractFromArticle(article, text, loadEntities());
    const claims = assignStatuses(accepted.map((claim) => ({ article, claim }))).map((c) => ({ ...c, claim_id: `L${c.claim_id.slice(1)}` }));
    return Response.json({ cached: false, article_id: article.id, claims: trim(claims), rejected: trim(rejected) });
  } catch (err) {
    return cachedResponse((err as Error).message);
  }
}

// Pasted text is verified in memory only and never written to disk.
async function pasted(body: Body) {
  const text = String(body.text ?? "").slice(0, MAX_PASTE_CHARS);
  const source = String(body.source_name ?? "").trim();
  const eventId = String(body.event_id ?? "");
  if (!text.trim() || !source || !eventId) {
    return Response.json({ error: "text, source name and event are required", claims: [], rejected: [], upgraded: [] }, { status: 400 });
  }
  const article: Article = {
    id: `P${Date.now().toString(36)}`,
    url: String(body.url ?? ""),
    source_name: source,
    tier: 3,
    published_at: String(body.published_at ?? "") || new Date().toISOString().slice(0, 10),
    event_id: eventId,
    file: "",
  };
  try {
    const { accepted, rejected } = await extractFromArticle(article, text, loadEntities());
    const cf = loadClaims();
    const articles = new Map(loadArticles().map((a) => [a.id, a]));
    const existing = cf.claims.filter((c) => articles.has(c.article_id));
    const all = assignStatuses([
      ...existing.map((c) => ({ article: articles.get(c.article_id)!, claim: c })),
      ...accepted.map((claim) => ({ article, claim })),
    ]);
    const before = new Map(existing.map((c) => [c.claim_id, c.status]));
    const upgraded = all
      .slice(0, existing.length)
      .map((c, i) => ({ ...c, claim_id: existing[i].claim_id }))
      .filter((c) => before.get(c.claim_id) !== "CONFIRMED" && c.status === "CONFIRMED")
      .map((c) => c.claim_id);
    const claims = all.slice(existing.length).map((c, i) => ({ ...c, claim_id: `${article.id}-${i + 1}` }));
    return Response.json({ cached: false, live: true, article, claims: trim(claims), rejected: trim(rejected), upgraded });
  } catch (err) {
    return Response.json({ cached: false, error: (err as Error).message, article, claims: [], rejected: [], upgraded: [] });
  }
}
