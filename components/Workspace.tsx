"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Bundle } from "@/lib/bundle";
import { computeBlastRadius, DIRECT_LABEL, RECOVERY_RULE, TIER_RULES } from "@/lib/blastRadius";
import { magnitudeConflict } from "@/lib/magnitude";
import { claimsAtStep, describeChange, tierChanges } from "@/lib/replay";
import type { AccountAlert, Article, Claim, PriorityTier, RejectedClaim } from "@/lib/types";
import BlastGraph, { EVENT_NODE } from "./BlastGraph";
import Map, { type MapMarker } from "./Map";
import AlertDetail from "./AlertDetail";
import EventOverview from "./EventOverview";
import ExtractDemo, { type PasteResult } from "./ExtractDemo";
import { EvidenceLegend, Label, RecoveryNote, rejectedSummary, SyntheticBadge, TIER_COLOR, TierBadge } from "./ui";

const TIERS: PriorityTier[] = ["REVIEW NOW", "MONITOR", "NO ACTION"];
const DEMO_ACCOUNT = "acct-lakeshore";
const DEMO_STEP_MS = 1100;

type Session = { articles: Article[]; claims: Claim[]; rejected: RejectedClaim[]; upgraded: string[] };
type LogEntry = { id: number; time: string; kind: "info" | "ok" | "warn" | "tier"; text: string };
const EMPTY_SESSION: Session = { articles: [], claims: [], rejected: [], upgraded: [] };

export default function Workspace({ bundle, eventId, autoDemo }: { bundle: Bundle; eventId: string; autoDemo?: boolean }) {
  const event = bundle.events.find((e) => e.id === eventId)!;
  const usgs = bundle.usgs[eventId];
  const [persist, setPersist] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showExtract, setShowExtract] = useState(false);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const eventArticles = useMemo(
    () => bundle.articles.filter((a) => a.event_id === eventId).sort((a, b) => a.published_at.localeCompare(b.published_at)),
    [bundle, eventId],
  );
  const [replay, setReplay] = useState(eventArticles.length);

  const liveBundle: Bundle = {
    ...bundle,
    articles: [...bundle.articles, ...session.articles],
    claims: [
      ...bundle.claims.map((c) => (session.upgraded.includes(c.claim_id) ? { ...c, status: "CONFIRMED" as const } : c)),
      ...session.claims,
    ],
    rejected: [...bundle.rejected, ...session.rejected],
  };
  // Statuses are recomputed from only the sources in view, so replay never borrows later corroboration.
  const claimsFor = (s: Session, n: number) => claimsAtStep([...bundle.claims, ...s.claims], eventId, eventArticles, n, s.articles);
  const replayClaims = claimsFor(session, replay);

  const input = { event, edges: bundle.edges, entities: bundle.entities, accounts: bundle.accounts, articles: liveBundle.articles };
  const compute = (claims: Claim[], p: boolean) => computeBlastRadius({ ...input, claims, assumePersists: p });
  const result = compute(replayClaims, persist);

  const pushLog = (entries: Omit<LogEntry, "id" | "time">[]) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    setLog((l) => [...entries.map((e) => ({ ...e, id: ++logId.current, time })).reverse(), ...l].slice(0, 60));
  };
  const logTierChanges = (nextClaims: Claim[], p: boolean, cause: string) => {
    const changes = tierChanges(result.alerts, compute(nextClaims, p).alerts, replayClaims, nextClaims).map(describeChange);
    pushLog(changes.length ? changes.map((text) => ({ kind: "tier" as const, text: `${text} (${cause})` })) : [{ kind: "info", text: `No tier changes (${cause})` }]);
  };

  const applyPaste = (r: PasteResult) => {
    const next: Session = {
      articles: [...session.articles, r.article],
      claims: [...session.claims, ...r.claims],
      rejected: [...session.rejected, ...r.rejected],
      upgraded: [...new Set([...session.upgraded, ...r.upgraded])],
    };
    pushLog([
      { kind: "ok", text: `Pasted source "${r.article.source_name}": ${r.claims.length} claims verified against text` },
      ...(r.rejected.length ? [{ kind: "warn" as const, text: rejectedSummary(r.rejected) }] : []),
      ...(r.upgraded.length ? [{ kind: "ok" as const, text: `${r.upgraded.length} earlier claim(s) now CONFIRMED by an independent publisher` }] : []),
    ]);
    logTierChanges(claimsFor(next, replay), persist, "new source");
    setSession(next);
  };
  const clearSession = () => {
    logTierChanges(claimsFor(EMPTY_SESSION, replay), persist, "pasted sources cleared");
    setSession(EMPTY_SESSION);
  };
  const changeReplay = (n: number) => {
    const a = eventArticles[n - 1];
    logTierChanges(claimsFor(session, n), persist, n ? `replay to ${a.published_at} · ${a.id} ${a.source_name}` : "replay: no sources");
    setReplay(n);
  };
  const changePersist = (p: boolean) => {
    logTierChanges(replayClaims, p, p ? "assume disruption persists" : "persistence assumption off");
    setPersist(p);
  };
  const demoEnabled = event.demo !== false;
  const demoAlert = demoEnabled ? (computeBlastRadius({ ...input, claims: bundle.claims }).alerts.find((a) => a.account.id === DEMO_ACCOUNT) ?? null) : null;
  const demoSeq = demoAlert?.path.length ? [EVENT_NODE, ...demoAlert.path] : [];

  const runDemo = () => {
    if (!demoSeq.length) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setSelectedId(null);
    setPersist(false);
    setShowExtract(false);
    setReplay(eventArticles.length);
    setDemoStep(0);
    for (let k = 1; k <= demoSeq.length; k++) {
      timers.current.push(setTimeout(() => setDemoStep(k), k * DEMO_STEP_MS));
    }
    timers.current.push(
      setTimeout(() => {
        setDemoStep(null);
        setSelectedId(DEMO_ACCOUNT);
      }, (demoSeq.length + 1.5) * DEMO_STEP_MS),
    );
  };
  const startAutoDemo = useEffectEvent(runDemo);

  useEffect(() => {
    if (!autoDemo) return;
    const t = setTimeout(startAutoDemo, 800);
    return () => clearTimeout(t);
  }, [autoDemo]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const selected = result.alerts.find((a) => a.account.id === selectedId) ?? null;
  const eventClaims = replayClaims.filter((c) => c.event_id === eventId);
  const eventArticleIds = new Set(liveBundle.articles.filter((a) => a.event_id === eventId).map((a) => a.id));
  const rejected = liveBundle.rejected.filter((r) => eventArticleIds.has(r.article_id));
  const baseLog: Omit<LogEntry, "id">[] = [
    { time: "saved", kind: "info", text: `USGS ${usgs?.usgs_id ?? ""}: M${event.magnitude ?? "UNKNOWN"} ${event.short_title ?? event.title} (tier 1 source)` },
    ...eventArticles.map((a) => {
      const n = bundle.claims.filter((c) => c.article_id === a.id).length;
      const r = bundle.rejected.filter((x) => x.article_id === a.id).length;
      return { time: "saved", kind: (r ? "warn" : "ok") as LogEntry["kind"], text: `${a.source_name} (${a.published_at}): ${n} claims verified${r ? `, ${r} rejected` : ""}` };
    }),
  ];
  const shortName = (id: string) => bundle.entities.find((e) => e.id === id)?.short_name ?? id;

  const markers: MapMarker[] = [];
  if (event.lat !== null && event.lon !== null) {
    markers.push({ id: event.id, lat: event.lat, lon: event.lon, color: "#5aa9e6", radius: 12, label: `Epicenter M${event.magnitude} (USGS)`, permanent: true });
  }
  const unknownLoc: string[] = [];
  for (const fid of Object.keys(result.affected)) {
    const e = bundle.entities.find((x) => x.id === fid);
    if (!e) continue;
    if (e.lat === null || e.lon === null) {
      unknownLoc.push(e.short_name ?? e.name);
      continue;
    }
    const onPath = selected?.path.includes(fid);
    const st = result.plantStates[fid]?.status;
    const color = onPath ? "#5aa9e6" : st === "RECOVERED" ? TIER_COLOR["NO ACTION"] : "#e2a336";
    const note = st && st !== "DISRUPTED" ? ` · ${st}` : "";
    markers.push({ id: fid, lat: e.lat, lon: e.lon, color, radius: 6, label: `${e.short_name ?? e.name}${note} (approx)` });
  }
  for (const al of result.alerts.filter((a) => a.direct)) {
    markers.push({
      id: al.account.id,
      lat: al.account.lat,
      lon: al.account.lon,
      color: TIER_COLOR[al.tier],
      radius: 6,
      fill: false,
      label: `SYNTHETIC · ${al.account.name} · ${DIRECT_LABEL} (approx)`,
    });
  }
  // Widen the view only when affected plants sit well away from the epicenter.
  const plantPts = Object.keys(result.affected)
    .map((id) => bundle.entities.find((x) => x.id === id))
    .filter((e) => e && e.lat !== null && e.lon !== null)
    .map((e) => [e!.lat!, e!.lon!] as [number, number]);
  const far = event.lat !== null && event.lon !== null && plantPts.some(([la, lo]) => Math.abs(la - event.lat!) > 1 || Math.abs(lo - event.lon!) > 1);
  const pts = far ? [[event.lat!, event.lon!] as [number, number], ...plantPts] : [];
  const center: [number, number] = far
    ? [(Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2, (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2]
    : event.lat !== null && event.lon !== null
      ? [event.lat + 0.4, event.lon]
      : [33.2, 130.7];
  const zoom = far ? 7 : 8;
  const magConflicts = eventClaims
    .map((c) => ({ c, m: magnitudeConflict(c, event) }))
    .filter((x): x is { c: Claim; m: number } => x.m !== null);

  const caption = (() => {
    if (demoStep === null || !demoAlert) return null;
    if (demoStep === 0) return `USGS: M${event.magnitude ?? "UNKNOWN"} ${event.short_title ?? event.title}`;
    if (demoStep === 1) return `Verified claim: disruption at ${shortName(demoSeq[1])}`;
    if (demoStep < demoSeq.length - 1) return `Dependency → ${shortName(demoSeq[demoStep])}`;
    if (demoStep === demoSeq.length - 1) return `SYNTHETIC insured account depends on ${shortName(demoSeq[demoStep - 1])}`;
    return `${demoAlert.tier}: ${demoAlert.headline}`;
  })();

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b border-line bg-panel">
        <div className="flex items-center gap-4 px-4 py-2">
          <Link href="/" className="font-mono text-sm font-bold tracking-[0.3em] text-accent">
            ARGUS
          </Link>
          <span className="text-dim">/</span>
          <h1 className="text-sm font-semibold">{event.title}</h1>
          <div className="flex gap-4 font-mono text-[11px] text-dim">
            <span>
              MAG <span className="text-ink">{event.magnitude ?? "UNKNOWN"}</span>
              {event.magnitude !== null && <span className="text-[10px]"> (USGS)</span>}
              {magConflicts.map(({ c, m }) => (
                <span key={c.claim_id} className="ml-1.5 border border-monitor/60 px-1 text-[10px] text-monitor" title="Article figure shown for transparency; the USGS magnitude is used.">
                  M{m} in {c.claim_id} · CONFLICTING
                </span>
              ))}
            </span>
            <span>
              UTC <span className="text-ink">{event.occurred_at ? event.occurred_at.replace("T", " ").slice(0, 16) : "UNKNOWN"}</span>
            </span>
            <span>
              DEPTH <span className="text-ink">{usgs ? `${usgs.depth_km} km` : "UNKNOWN"}</span>
            </span>
            <span>
              LOC <span className="text-ink">{event.lat !== null ? `${event.lat.toFixed(2)}, ${event.lon!.toFixed(2)}` : "UNKNOWN"}</span>
            </span>
            {event.source_url && (
              <a href={event.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                USGS {usgs?.usgs_id} ↗
              </a>
            )}
          </div>
          {demoEnabled ? (
            <button
              onClick={runDemo}
              disabled={!demoSeq.length || demoStep !== null}
              title={demoSeq.length ? "Reveal event → supplier → Lakeshore → tier" : "Lakeshore has no path yet: run extraction"}
              className="ml-auto border border-accent bg-accent/15 px-3 py-1 font-mono text-[11px] font-semibold tracking-wider text-accent hover:bg-accent/25 disabled:opacity-40"
            >
              ▶ RUN DEMO
            </button>
          ) : (
            <span className="ml-auto font-mono text-[10px] tracking-widest text-dim">{event.label?.toUpperCase()} · USE REPLAY</span>
          )}
          <div className="border border-monitor/60 px-2 py-0.5 font-mono text-[10px] tracking-widest text-monitor">
            PORTFOLIO: SYNTHETIC DEMONSTRATION DATA
          </div>
        </div>
        <div className="flex items-center gap-5 border-t border-line px-4 py-1.5 font-mono text-[11px] text-dim">
          <span>
            CLAIMS <span className="text-ink">{eventClaims.length}</span> ({eventClaims.filter((c) => c.status === "CONFIRMED").length} confirmed,{" "}
            {eventClaims.filter((c) => c.status === "REPORTED").length} reported)
          </span>
          <span className={rejected.length ? "text-review" : ""}>
            {rejectedSummary(rejected)}
          </span>
          <span>
            AFFECTED FACILITIES <span className="text-ink">{Object.keys(result.affected).length}</span>
          </span>
          <span className="whitespace-nowrap text-[10px]">LLM: {bundle.llm}</span>
          <label className="ml-auto flex items-center gap-2">
            REPLAY
            <input
              type="range"
              min={0}
              max={eventArticles.length}
              value={replay}
              onChange={(e) => changeReplay(Number(e.target.value))}
              className="w-28 accent-[#5aa9e6]"
            />
            <span className="w-40 truncate text-ink">
              {replay === 0 ? "no sources" : `${replay}/${eventArticles.length} · to ${eventArticles[replay - 1].published_at}`}
            </span>
          </label>
          <button onClick={() => setShowExtract((s) => !s)} className="border border-accent/70 px-2 py-0.5 text-accent hover:bg-accent/10">
            + PASTE ARTICLE (LIVE)
          </button>
          {session.articles.length > 0 && (
            <button onClick={clearSession} className="border border-monitor/60 px-2 py-0.5 text-monitor hover:bg-monitor/10" title="Remove pasted sources from this session">
              {session.articles.length} PASTED · CLEAR
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 select-none">
            <input type="checkbox" checked={persist} onChange={(e) => changePersist(e.target.checked)} className="accent-[#5aa9e6]" />
            ASSUME DISRUPTION PERSISTS
          </label>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,22%)_1fr_460px]">
        <section className="flex min-h-0 flex-col border-r border-line">
          <div className="px-3 pt-2">
            <Label>Physical impact · coordinates approx</Label>
          </div>
          <div className="min-h-0 flex-1">
            <Map key={event.id} markers={markers} center={center} zoom={zoom} />
          </div>
          <div className="space-y-1 border-t border-line p-3 font-mono text-[10px] text-dim">
            <div><span className="text-accent">●</span> epicenter (USGS)</div>
            <div><span className="text-monitor">●</span> affected facility (claim-backed, approx)</div>
            <div><span className="text-monitor">○</span> {DIRECT_LABEL} (SYNTHETIC)</div>
            {unknownLoc.map((n) => (
              <div key={n} className="text-ink">{n}: location UNKNOWN</div>
            ))}
          </div>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="flex items-end justify-between gap-4 border-b border-line px-4 py-2">
            <div>
              <div className="font-mono text-[13px] font-bold tracking-[0.2em] text-ink">ECONOMIC BLAST RADIUS</div>
              <div className="text-[12px] text-dim">Physical impact ends here. Economic exposure doesn&apos;t.</div>
            </div>
            <div className="text-right">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-dim">Evidence status</div>
              <EvidenceLegend />
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            {showExtract && <ExtractDemo articles={eventArticles} eventId={eventId} onApply={applyPaste} onClose={() => setShowExtract(false)} />}
            {caption && (
              <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
                <div className="border border-accent/60 bg-panel/95 px-3 py-1.5 font-mono text-[12px] text-ink">{caption}</div>
              </div>
            )}
            {Object.keys(result.affected).length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-xs text-dim">
                No claim-backed affected facilities for this event. Paste articles and run extraction.
              </div>
            ) : (
              <BlastGraph
                event={event}
                result={result}
                entities={bundle.entities}
                accounts={bundle.accounts}
                edges={bundle.edges}
                selected={selected}
                demo={demoStep !== null ? { seq: demoSeq, step: demoStep } : null}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
              />
            )}
          </div>
          <div className="flex gap-4 border-t border-line px-4 py-1.5 font-mono text-[10px] text-dim">
            <span>Lines: <span className="text-[#c3cad5]">━ VERIFIED LINK</span> · <span className="text-[#6b7485]">━ SYNTHETIC</span> · ┄ INFERRED</span>
            <span>Node ring = priority tier</span>
          </div>
          <div className="h-[118px] shrink-0 overflow-y-auto border-t border-line bg-panel px-4 py-1.5 font-mono text-[10px]">
            <div className="mb-1 flex items-center gap-2 text-dim">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4fd18b]" />
              ACTIVITY · tiers recompute on every new source, replay step or assumption
            </div>
            {[...log, ...baseLog.slice().reverse()].map((e, i) => (
              <div key={"id" in e ? `l${e.id}` : `b${i}`} className="argus-log flex gap-3">
                <span className="w-16 shrink-0 whitespace-nowrap text-dim">{e.time}</span>
                <span
                  className={
                    e.kind === "tier" ? "text-accent" : e.kind === "warn" ? "text-review" : e.kind === "ok" ? "text-ink" : "text-dim"
                  }
                >
                  {e.kind === "tier" ? "▲ " : e.kind === "warn" ? "✕ " : e.kind === "ok" ? "✓ " : "· "}
                  {e.text}
                </span>
              </div>
            ))}
          </div>
        </section>

        <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
          <div className="max-h-[38%] overflow-y-auto border-b border-line p-3">
            {TIERS.map((tier) => {
              const list = result.alerts.filter((a) => a.tier === tier);
              return (
                <div key={tier} className="mb-3">
                  <div className="mb-1 flex items-center justify-between" title={TIER_RULES[tier]}>
                    <TierBadge tier={tier} />
                    <span className="font-mono text-[10px] text-dim">{list.length}</span>
                  </div>
                  {list.map((a) => (
                    <AlertRow key={a.account.id} alert={a} active={a.account.id === selectedId} onClick={() => setSelectedId(a.account.id === selectedId ? null : a.account.id)} />
                  ))}
                </div>
              );
            })}
            <details className="border border-line bg-panel2 px-2 py-1 font-mono text-[10px] text-dim">
              <summary className="cursor-pointer text-ink">TIER RULES · deterministic</summary>
              <ul className="mt-1 space-y-1">
                {TIERS.map((t) => (
                  <li key={t}>
                    <span style={{ color: TIER_COLOR[t] }}>{t}</span>: {TIER_RULES[t]}
                  </li>
                ))}
                <li>
                  <span className="text-noaction">RESOLVED / RECOVERING</span>: {RECOVERY_RULE}
                </li>
              </ul>
            </details>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {selected ? (
              <AlertDetail key={selected.account.id} alert={selected} bundle={{ ...liveBundle, claims: replayClaims }} event={event} persist={persist} />
            ) : (
              <>
                <div className="mb-3 font-mono text-[11px] text-dim">Select an account to see why it was flagged, the evidence, and what is unknown.</div>
                <EventOverview
                  eventId={eventId}
                  persist={persist}
                  result={result}
                  entities={bundle.entities}
                  sessionActive={session.articles.length > 0}
                  onSelect={setSelectedId}
                />
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AlertRow({ alert, active, onClick }: { alert: AccountAlert; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-2 border px-2 py-1.5 text-left text-xs ${
        active ? "border-accent bg-accent/10" : "border-line bg-panel2 hover:border-dim/50"
      }`}
    >
      <span className="h-2 w-2 shrink-0" style={{ background: TIER_COLOR[alert.tier] }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          <SyntheticBadge />
          {alert.account.name}
        </span>
        {alert.direct && <span className="block font-mono text-[10px] text-monitor">{DIRECT_LABEL}</span>}
        {alert.resolved && <span className="block font-mono text-[10px] text-noaction">RESOLVED · supplier recovered</span>}
      </span>
      <RecoveryNote alert={alert} />
      {!alert.direct && (
        <span className="shrink-0 font-mono text-[10px] text-dim">{alert.path.length ? `indirect · ${alert.path.length - 1} hop` : "no path"}</span>
      )}
      {alert.memory && <span className="font-mono text-[10px] text-accent" title="Dependency first observed: Kumamoto 2016">2016</span>}
    </button>
  );
}
