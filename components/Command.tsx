"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { Bundle } from "@/lib/bundle";
import { computeBlastRadius, downstreamAccounts } from "@/lib/blastRadius";
import type { PriorityTier } from "@/lib/types";
import Map, { type MapLine, type MapMarker } from "./Map";
import LiveFeedPanel from "./LiveFeedPanel";
import { useLiveFeed } from "./useLiveFeed";
import { Label, TIER_COLOR } from "./ui";

const RANK: Record<PriorityTier, number> = { "REVIEW NOW": 2, MONITOR: 1, "NO ACTION": 0 };

export default function Command({ bundle }: { bundle: Bundle }) {
  const router = useRouter();
  const { feed, ageSec, now } = useLiveFeed();
  const concentration = useMemo(
    () =>
      bundle.entities
        .filter((e) => e.type === "facility")
        .map((e) => ({ entity: e, accounts: downstreamAccounts([e.id], bundle.edges, bundle.accounts) }))
        .filter((x) => x.accounts.length)
        .sort((a, b) => b.accounts.length - a.accounts.length)
        .slice(0, 5),
    [bundle],
  );
  const rows = useMemo(() => {
    return bundle.events
      .map((event) => {
        const r = computeBlastRadius({
          event, claims: bundle.claims, edges: bundle.edges, entities: bundle.entities, accounts: bundle.accounts, articles: bundle.articles,
        });
        const count = (t: PriorityTier) => r.alerts.filter((a) => a.tier === t && !a.resolved).length;
        return {
          event,
          result: r,
          review: count("REVIEW NOW"),
          monitor: count("MONITOR"),
          none: count("NO ACTION"),
          resolved: r.alerts.filter((a) => a.resolved).length,
          claims: bundle.claims.filter((c) => c.event_id === event.id).length,
          memory: r.alerts.filter((a) => a.memory).length,
        };
      })
      // Labelled teaching examples (e.g. de-escalation) list after live-ranked events.
      .sort((a, b) => Number(!!a.event.label) - Number(!!b.event.label) || b.review - a.review || b.monitor - a.monitor);
  }, [bundle]);

  const worst = new globalThis.Map<string, PriorityTier>();
  for (const row of rows) {
    for (const a of row.result.alerts) {
      const cur = worst.get(a.account.id);
      if (!cur || RANK[a.tier] > RANK[cur]) worst.set(a.account.id, a.tier);
    }
  }

  const markers: MapMarker[] = [];
  for (const row of rows) {
    const e = row.event;
    if (e.lat === null || e.lon === null) continue;
    markers.push({ id: e.id, lat: e.lat, lon: e.lon, color: "#5aa9e6", radius: 9, label: `${e.title} · M${e.magnitude ?? "UNKNOWN"}` });
  }
  // Pacific-centred view: shift western-hemisphere points east so US accounts sit across from Japan.
  const pLon = (lon: number) => (lon < 0 ? lon + 360 : lon);
  for (const q of feed?.quakes ?? []) {
    markers.push({
      id: `live:${q.id}`,
      lat: q.lat,
      lon: pLon(q.lon),
      color: q.nearby.length ? "#e2a336" : "#7d8797",
      radius: Math.max(2, q.magnitude - 3),
      label: `LIVE USGS · M${q.magnitude.toFixed(1)} · ${q.place}${q.nearby.length ? ` · ${q.nearby.length} tracked plant(s) nearby` : ""}`,
    });
  }
  for (const a of bundle.accounts) {
    const t = worst.get(a.id) ?? "NO ACTION";
    markers.push({ id: `acct:${a.id}`, lat: a.lat, lon: pLon(a.lon), color: TIER_COLOR[t], radius: 5, fill: false, label: `SYNTHETIC · ${a.name} · ${t}` });
  }
  const lines: MapLine[] = [];
  const top = rows[0];
  if (top && top.event.lat !== null && top.event.lon !== null) {
    for (const al of top.result.alerts.filter((a) => a.tier !== "NO ACTION" && !a.direct)) {
      lines.push({
        id: al.account.id,
        points: [
          [top.event.lat, top.event.lon],
          [al.account.lat, pLon(al.account.lon)],
        ],
        color: TIER_COLOR[al.tier],
      });
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-line bg-panel px-4 py-2">
        <span className="font-mono text-sm font-bold tracking-[0.3em] text-accent">ARGUS</span>
        <span className="text-xs text-dim">Traditional systems see where an event happened. ARGUS shows where its consequences travel.</span>
        <Link
          href="/event/kyushu-2026?demo=1"
          className="ml-auto border border-accent bg-accent/15 px-3 py-1 font-mono text-[11px] font-semibold tracking-wider text-accent hover:bg-accent/25"
        >
          ▶ RUN DEMO
        </Link>
        <div className="border border-monitor/60 px-2 py-0.5 font-mono text-[10px] tracking-widest text-monitor">
          PORTFOLIO: SYNTHETIC DEMONSTRATION DATA
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_420px]">
        <div className="relative min-h-0">
          <Map
            markers={markers}
            lines={lines}
            center={[36, 205]}
            zoom={2.5}
            onClick={(id) => {
              if (!id.startsWith("acct:") && !id.startsWith("live:")) router.push(`/event/${id}`);
            }}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] space-y-0.5 border border-line bg-panel/90 p-2 font-mono text-[10px] text-dim">
            <div><span className="text-accent">●</span> event (USGS)</div>
            <div><span className="text-dim">●</span><span className="text-monitor">●</span> live USGS quake, past 7 days (amber = near a tracked plant)</div>
            <div><span className="text-review">○</span><span className="text-monitor">○</span><span className="text-noaction">○</span> SYNTHETIC account, worst tier (approx)</div>
            <div>┈ indirect exposure from top-ranked event</div>
          </div>
        </div>
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel">
          <div className="border-b border-line p-3">
            <Label>Events · ranked by REVIEW NOW accounts</Label>
            <div className="font-mono text-[11px] text-dim">
              {bundle.accounts.length} synthetic accounts reviewed against {bundle.events.length} events · {bundle.claims.length} verified claims ·{" "}
              {bundle.rejected.length} rejected
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-line p-3">
            {rows.map((row, i) => (
              <Link
                key={row.event.id}
                href={`/event/${row.event.id}`}
                className="mb-2 block border border-line bg-panel2 p-3 hover:border-accent"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold">
                    <span className="mr-2 font-mono text-dim">{String(i + 1).padStart(2, "0")}</span>
                    {row.event.title}
                  </span>
                  <span className="font-mono text-[10px] text-dim">M{row.event.magnitude ?? "UNKNOWN"}</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-dim">
                  {row.event.occurred_at ? row.event.occurred_at.slice(0, 10) : "date UNKNOWN"} · {row.claims} claims ·{" "}
                  {Object.keys(row.result.affected).length} affected facilities
                </div>
                <div className="mt-2 flex gap-3 font-mono text-[11px]">
                  <span style={{ color: TIER_COLOR["REVIEW NOW"] }}>{row.review} REVIEW NOW</span>
                  <span style={{ color: TIER_COLOR.MONITOR }}>{row.monitor} MONITOR</span>
                  <span style={{ color: TIER_COLOR["NO ACTION"] }}>{row.none} NO ACTION</span>
                  {row.resolved > 0 && <span style={{ color: TIER_COLOR["NO ACTION"] }}>{row.resolved} RESOLVED</span>}
                </div>
                {row.event.label && (
                  <div className="mt-1 inline-block border border-noaction/60 px-1 font-mono text-[9px] tracking-widest text-noaction">
                    {row.event.label.toUpperCase()}
                  </div>
                )}
                {row.memory > 0 && (
                  <div className="mt-1 font-mono text-[10px] text-accent">{row.memory} path(s) via dependencies first observed in Kumamoto 2016</div>
                )}
              </Link>
            ))}
            </div>
            <LiveFeedPanel feed={feed} ageSec={ageSec} now={now} accounts={bundle.accounts} />
            <div className="p-3">
              <Label>Portfolio concentration · supplier plants feeding most accounts</Label>
              <div className="space-y-1.5">
                {concentration.map(({ entity, accounts }) => (
                  <div key={entity.id} className="font-mono text-[10px]">
                    <div className="flex justify-between">
                      <span className="text-ink">{entity.short_name ?? entity.name}</span>
                      <span className="text-dim">{accounts.length} SYNTHETIC account{accounts.length === 1 ? "" : "s"}</span>
                    </div>
                    <div className="h-1 bg-panel2">
                      <div className="h-1 bg-accent/70" style={{ width: `${(accounts.length / bundle.accounts.length) * 100}%` }} />
                    </div>
                    <div className="truncate text-dim">
                      {accounts.map((id) => bundle.accounts.find((a) => a.id === id)?.name ?? id).join(", ")}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 font-mono text-[9px] text-dim">Counts of dependency paths only. No loss estimates.</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
