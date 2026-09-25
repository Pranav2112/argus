"use client";

import { useEffect, useState } from "react";
import type { Bundle } from "@/lib/bundle";
import { isCompanyLevel, regionOf } from "@/lib/groups";
import { DISRUPTION_TYPES, RECOVERY_RULE, resumptionKind } from "@/lib/blastRadius";
import { magnitudeConflict } from "@/lib/magnitude";
import { shortQuote } from "@/lib/quote";
import type { AccountAlert, EventRecord, Explanation } from "@/lib/types";
import {
  EvidenceTag,
  formatDate,
  Label,
  MemoryBadge,
  originKind,
  RecoveryNote,
  StatusBadge,
  SyntheticBadge,
  TierBadge,
  tierLabel,
} from "./ui";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function AlertDetail({
  alert,
  bundle,
  event,
  persist,
}: {
  alert: AccountAlert;
  bundle: Bundle;
  event: EventRecord;
  persist: boolean;
}) {
  const short = (id: string) => {
    const e = bundle.entities.find((x) => x.id === id);
    return (
      e?.short_name ??
      e?.name ??
      bundle.accounts.find((a) => a.id === id)?.name ??
      id
    );
  };
  const claims = alert.claimIds
    .map((id) => bundle.claims.find((c) => c.claim_id === id))
    .filter((c) => !!c);
  const pathEdges = alert.pathEdgeIds
    .map((id) => bundle.edges.find((e) => e.id === id))
    .filter((e) => !!e);
  const indirect = alert.path.length > 0;
  const pathText = [
    event.short_title ?? event.title,
    ...alert.path.map(short),
  ].join(" → ");

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-2.5 border border-line bg-panel2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={alert.tier} resolved={alert.resolved} large />
          {alert.memory && <MemoryBadge />}
          <RecoveryNote alert={alert} />
        </div>
        <div className="text-base font-semibold leading-tight">
          <SyntheticBadge />
          {alert.account.name}
        </div>
        <div className="space-y-1 text-[13px]">
          <div className={alert.direct ? "text-monitor" : "text-dim"}>
            {alert.direct
              ? "● Direct physical exposure — covered by existing catastrophe tools"
              : "○ No direct physical exposure"}
          </div>
          <div className={indirect ? "text-ink" : "text-dim"}>
            {indirect
              ? "● Indirect supply-chain exposure"
              : "○ No dependency path to a facility with a verified disruption claim"}
          </div>
        </div>
        {indirect && (
          <div className="border-l-2 border-accent pl-2 font-mono text-[12px] text-ink">
            {pathText}
          </div>
        )}
        <div>
          <Label>Why {tierLabel(alert)}</Label>
          <div className="text-[13px]">{alert.headline}</div>
          {alert.recovery && (
            <div className="mt-1.5 border-l-2 border-noaction/60 pl-2 font-mono text-[10px] leading-snug text-dim">{RECOVERY_RULE}</div>
          )}
        </div>
        <div>
          <Label>Recommended human action</Label>
          {alert.nextSteps.length ? (
            <div className="text-[13px]">
              Recommend review:{" "}
              {alert.nextSteps
                .map((s, i) => (i === 0 ? cap(s) : s))
                .join(" → ")}
              .
            </div>
          ) : (
            <div className="text-[13px] text-dim">None required.</div>
          )}
        </div>
      </section>

      <div>
        <Label>Rule that fired</Label>
        <div className="border-l-2 border-line pl-2 font-mono text-[11px] text-dim">
          {alert.rule}
        </div>
        {pathEdges.length > 0 && (
          <div className="mt-2 space-y-1">
            {pathEdges.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-dim"
              >
                <span className="text-accent">[{e.id}]</span>
                <EvidenceTag kind={originKind(e.origin)} />
                <span className="text-ink">{e.label ?? e.relation}</span>
                {e.relation !== "located_in_region" && (
                  <>
                    <span>· {e.criticality}</span>
                    <span>
                      · alt supplier{" "}
                      {e.alt_supplier_known === null ? (
                        <EvidenceTag kind="UNKNOWN" />
                      ) : e.alt_supplier_known ? (
                        "known"
                      ) : (
                        "none known"
                      )}
                    </span>
                  </>
                )}
                {e.first_seen_event && (
                  <span className="text-accent">
                    · first seen {e.first_seen_event}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label>Evidence · {claims.length} verified claim(s)</Label>
        {claims.length === 0 && (
          <div className="text-dim">No claims on this path.</div>
        )}
        {[
          {
            title: "Disruption reported for this event",
            list: claims
              .filter(
                (c) =>
                  c.event_id === event.id && DISRUPTION_TYPES.has(c.claim_type),
              )
              .sort((a, b) =>
                a.status === b.status ? 0 : a.status === "CONFIRMED" ? -1 : 1,
              ),
          },
          {
            title: "Supplier links and restart statements",
            list: claims.filter(
              (c) =>
                c.event_id === event.id &&
                !DISRUPTION_TYPES.has(c.claim_type) &&
                c.claim_type !== "event_fact",
            ),
          },
          {
            title: "Event facts",
            list: claims.filter(
              (c) => c.event_id === event.id && c.claim_type === "event_fact",
            ),
          },
          {
            title: "Dependency memory · Kumamoto 2016",
            list: claims.filter((c) => c.event_id !== event.id),
          },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <div key={g.title} className="mb-3 space-y-2">
              <div className="font-mono text-[10px] text-ink">
                {g.title} · {g.list.length}
              </div>
              {g.list.map((c) => {
                const art = bundle.articles.find((a) => a.id === c.article_id);
                return (
                  <div
                    key={c.claim_id}
                    className="border border-line bg-panel2 p-2"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-dim">
                      <span className="text-accent">[{c.claim_id}]</span>
                      <StatusBadge status={c.status} />
                      <span>{c.claim_type.replace(/_/g, " ")}</span>
                      <span>· {c.event_id}</span>
                      {isCompanyLevel(c.subject_entity_id, regionOf(c.event_id)) && (
                        <span className="border border-line px-1 text-[9px] text-ink">
                          company-level report
                        </span>
                      )}
                      {magnitudeConflict(c, event) !== null && (
                        <span
                          className="border border-monitor/60 px-1 text-[9px] text-monitor"
                          title="The USGS magnitude is used; this figure is shown for transparency only."
                        >
                          CONFLICTING · USGS M{event.magnitude}
                        </span>
                      )}
                      {resumptionKind(c) && (
                        <span className="border border-line px-1 text-[9px] text-ink">
                          {resumptionKind(c) === "planned" ? "planned / not yet happened · no status change" : `past-tense ${resumptionKind(c)} restart`}
                        </span>
                      )}
                    </div>
                    <div className="mb-1">{c.statement}</div>
                    <blockquote className="border-l border-dim/50 pl-2 text-[11px] italic text-dim">
                      “{shortQuote(c.evidence_quote)}”
                    </blockquote>
                    {art && (
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-mono text-[10px] text-accent hover:underline"
                      >
                        {art.source_name} ·{" "}
                        {formatDate(art.published_at, art.date_precision)} ·
                        tier {art.tier} ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
      </div>

      <div>
        <Label>Unknowns · not guessed</Label>
        {alert.unknowns.length === 0 ? (
          <div className="text-dim">None.</div>
        ) : (
          <ul className="space-y-1">
            {alert.unknowns.map((u) => (
              <li
                key={u}
                className="flex items-start gap-1.5 font-mono text-[11px]"
              >
                <EvidenceTag kind="UNKNOWN" />
                <span>
                  {u.replace(/: UNKNOWN.*$/, "")}
                  {u.includes("(") ? ` ${u.slice(u.indexOf("("))}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(alert.tier !== "NO ACTION" || alert.resolved) && (
        <ExplainPanel alert={alert} eventId={event.id} persist={persist} />
      )}
    </div>
  );
}

function Cited({ text }: { text: string }) {
  const parts = text.split(/(\[[CE]\d+\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[CE]\d+\]$/.test(p) ? (
          <span key={i} className="font-mono text-[10px] text-accent">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function ExplainPanel({
  alert,
  eventId,
  persist,
}: {
  alert: AccountAlert;
  eventId: string;
  persist: boolean;
}) {
  const shown = tierLabel(alert);
  const key = `${eventId}:${alert.account.id}:${shown}:${persist}`;
  const [state, setState] = useState<{
    key: string;
    data: Explanation & { error?: string; stale?: boolean };
  } | null>(null);
  const data = state?.key === key ? state.data : null;
  const loading = !data;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: eventId,
        account_id: alert.account.id,
        assume_persists: persist,
        expected_tier: shown,
      }),
    })
      .then((r) => r.json())
      .then((d) => !cancelled && setState({ key, data: d }))
      .catch(
        (e) =>
          !cancelled &&
          setState({
            key,
            data: {
              sentences: [],
              actions: [],
              removed: 0,
              cached: false,
              generated_at: "",
              error: String(e),
            },
          }),
      );
    return () => {
      cancelled = true;
    };
  }, [key, alert.account.id, eventId, persist, shown]);

  const unavailable = !!data && !data.sentences.length;

  return (
    <div className="border border-line bg-bg p-2">
      <div className="mb-1 flex items-center justify-between">
        <Label>Analyst summary · every sentence cited</Label>
        {data && (
          <span className="font-mono text-[9px] text-dim">
            {unavailable ? "NOT CACHED" : data.cached ? "CACHED" : "LIVE"}
            {data.removed
              ? ` · ${data.removed} uncited sentence(s) removed`
              : ""}
          </span>
        )}
      </div>
      {loading && (
        <div className="font-mono text-[11px] text-dim">loading…</div>
      )}
      {unavailable && (
        <div className="font-mono text-[11px] text-dim">
          {data.stale
            ? "Summaries are generated for the latest sources only. Move replay to the last source to see it; the deterministic rule and evidence above apply to this step."
            : "No pre-generated summary for this alert. The deterministic rule and evidence above stand on their own."}
        </div>
      )}
      {data && data.sentences.length > 0 && (
        <p className="mb-2 leading-relaxed">
          {data.sentences.map((s, i) => (
            <span key={i}>
              <Cited text={s} />{" "}
            </span>
          ))}
        </p>
      )}
      {data && data.actions.length > 0 && (
        <>
          <Label>Recommended review actions</Label>
          <ul className="space-y-0.5">
            {data.actions.map((a) => (
              <li key={a} className="font-mono text-[11px]">
                ☐ {a}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
