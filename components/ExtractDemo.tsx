"use client";

import { useState } from "react";
import type { Article, Claim, RejectedClaim } from "@/lib/types";
import { shortQuote } from "@/lib/quote";
import { Label, rejectedSummary, StatusBadge } from "./ui";

type Result = { cached: boolean; error?: string; claims: Claim[]; rejected: RejectedClaim[]; upgraded?: string[]; article?: Article };
export type PasteResult = { article: Article; claims: Claim[]; rejected: RejectedClaim[]; upgraded: string[] };

export default function ExtractDemo({
  articles,
  eventId,
  onApply,
  onClose,
}: {
  articles: Article[];
  eventId: string;
  onApply: (r: PasteResult) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"paste" | "stored">("paste");
  const [articleId, setArticleId] = useState(articles[0]?.id ?? "");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  const run = async () => {
    setLoading(true);
    setRes(null);
    try {
      const body =
        mode === "stored"
          ? { article_id: articleId }
          : { event_id: eventId, text, source_name: source, url, published_at: date };
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const out: Result = await r.json();
      setRes(out);
      if (mode === "paste" && out.article && !out.error) {
        onApply({ article: out.article, claims: out.claims, rejected: out.rejected, upgraded: out.upgraded ?? [] });
      }
    } catch (e) {
      setRes({ cached: true, error: String(e), claims: [], rejected: [] });
    } finally {
      setLoading(false);
    }
  };

  const canRun = mode === "stored" ? !!articleId : text.trim().length > 40 && source.trim().length > 0;
  const tab = (m: typeof mode, label: string) => (
    <button
      onClick={() => {
        setMode(m);
        setRes(null);
      }}
      className={`border px-2 py-0.5 font-mono text-[10px] ${mode === m ? "border-accent text-accent" : "border-line text-dim hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="absolute inset-x-6 top-10 z-20 max-h-[85%] overflow-y-auto border border-accent/60 bg-panel p-3 text-xs shadow-2xl">
      <div className="mb-2 flex items-center gap-2">
        <Label>Live claim extraction · quote-verified</Label>
        {tab("paste", "PASTE ARTICLE")}
        {tab("stored", "RE-RUN SAVED SOURCE")}
        <button onClick={onClose} className="ml-auto font-mono text-dim hover:text-ink">
          close ✕
        </button>
      </div>

      {mode === "stored" ? (
        <div className="mb-3 flex gap-2">
          <select
            value={articleId}
            onChange={(e) => setArticleId(e.target.value)}
            className="flex-1 border border-line bg-panel2 px-2 py-1 font-mono text-[11px]"
          >
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.source_name} · {a.published_at}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mb-3 space-y-2">
          <div className="grid grid-cols-[1fr_1fr_130px] gap-2">
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source name (required)" className="border border-line bg-panel2 px-2 py-1 font-mono text-[11px]" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link (optional)" className="border border-line bg-panel2 px-2 py-1 font-mono text-[11px]" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-line bg-panel2 px-2 py-1 font-mono text-[11px]" />
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the article text. Claims are extracted live, every quote is checked against this text, and the blast radius recomputes. Nothing is saved to disk."
            rows={6}
            className="w-full border border-line bg-panel2 px-2 py-1 text-[11px] leading-snug"
          />
          <div className="font-mono text-[10px] text-dim">
            Pasted sources count as tier 3. A claim becomes CONFIRMED only when a different publisher reports the same thing.
          </div>
        </div>
      )}
      <button onClick={run} disabled={loading || !canRun} className="mb-3 border border-accent px-3 py-1 font-mono text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50">
        {loading ? "EXTRACTING…" : mode === "paste" ? "EXTRACT & APPLY TO BLAST RADIUS" : "EXTRACT"}
      </button>

      {res && (
        <div className="space-y-2">
          <div className="font-mono text-[11px]">
            <span className={res.cached ? "text-monitor" : "text-accent"}>{res.cached ? "CACHED" : "LIVE"}</span>
            <span className="text-dim"> · {res.claims.length} accepted · </span>
            <span className={res.rejected.length ? "text-review" : "text-dim"}>{rejectedSummary(res.rejected)}</span>
            {!!res.upgraded?.length && <span className="text-[#4fd18b]"> · {res.upgraded.length} earlier claim(s) now CONFIRMED by an independent source</span>}
            {res.error && <span className="text-dim"> · live call failed: {res.error}</span>}
          </div>
          {res.claims.map((c) => (
            <div key={c.claim_id} className="border border-line bg-panel2 p-2">
              <div className="mb-1 flex gap-2 font-mono text-[10px] text-dim">
                <span className="text-accent">[{c.claim_id}]</span>
                <StatusBadge status={c.status} />
                <span>{c.claim_type}</span>
                <span>{c.subject_entity_id ?? "no entity"}</span>
              </div>
              <div>{c.statement}</div>
              <div className="text-[11px] italic text-dim">“{shortQuote(c.evidence_quote)}”</div>
            </div>
          ))}
          {res.rejected.map((r, i) => (
            <div key={i} className="border border-review/40 bg-panel2 p-2 opacity-80">
              <div className="font-mono text-[10px] text-review">REJECTED · {r.reason}</div>
              <div className="line-through decoration-review/60">{r.statement}</div>
              <div className="text-[11px] italic text-dim">“{shortQuote(r.evidence_quote)}”</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
