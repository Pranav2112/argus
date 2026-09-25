"use client";

import { NEARBY_KM, type LiveFeed } from "@/lib/live";
import type { Account } from "@/lib/types";
import { ago } from "./useLiveFeed";
import { Label } from "./ui";

export default function LiveFeedPanel({
  feed,
  ageSec,
  now,
  accounts,
}: {
  feed: LiveFeed | null;
  ageSec: number | null;
  now: number | null;
  accounts: Account[];
}) {
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const flagged = feed?.quakes.filter((q) => q.nearby.length) ?? [];
  const others = feed?.quakes.filter((q) => !q.nearby.length).slice(0, 6) ?? [];

  return (
    <div className="border-b border-line p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${feed?.live ? "animate-pulse bg-[#4fd18b]" : "bg-monitor"}`} />
        <Label>USGS live feed · M4.5+ · past 7 days</Label>
        <span className={`ml-auto font-mono text-[10px] ${feed?.live ? "text-[#4fd18b]" : "text-monitor"}`}>
          {!feed ? "CONNECTING…" : feed.live ? "LIVE" : "CACHED"}
        </span>
      </div>
      <div className="mb-2 font-mono text-[10px] text-dim">
        {feed ? `${feed.quakes.length} quakes · ` : ""}
        {ageSec !== null ? `updated ${ageSec}s ago · refresh every 60s` : "refresh every 60s"}
        {feed && !feed.live && feed.error ? ` · live fetch failed, showing last saved copy` : ""}
      </div>

      {feed && flagged.length === 0 && (
        <div className="mb-2 border border-line bg-panel2 p-2 font-mono text-[10px] text-dim">
          No quake this week within {NEARBY_KM} km of a tracked supplier plant.
        </div>
      )}
      {flagged.map((q) => (
        <a key={q.id} href={q.url} target="_blank" rel="noreferrer" className="mb-2 block border border-monitor/60 bg-panel2 p-2 hover:border-monitor">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="font-semibold text-monitor">M{q.magnitude.toFixed(1)} · {q.place}</span>
            <span className="font-mono text-[10px] text-dim">{ago(q.time, now)}</span>
          </div>
          <div className="mt-1 font-mono text-[10px] text-ink">
            {q.nearby.length} tracked plant(s) within {NEARBY_KM} km: {q.nearby.slice(0, 3).map((n) => `${n.name} (${n.km} km)`).join(", ")}
          </div>
          {q.exposedAccounts.length > 0 && (
            <div className="mt-1 font-mono text-[10px] text-dim">
              {q.exposedAccounts.length} downstream SYNTHETIC account{q.exposedAccounts.length === 1 ? "" : "s"}: {q.exposedAccounts.slice(0, 3).map(name).join(", ")}
              {q.exposedAccounts.length > 3 ? ` +${q.exposedAccounts.length - 3} more` : ""}
            </div>
          )}
          <div className="mt-1 font-mono text-[10px] text-accent">
            Proximity only · no verified disruption reports · tier not assigned
          </div>
        </a>
      ))}
      <div className="space-y-0.5">
        {others.map((q) => (
          <a key={q.id} href={q.url} target="_blank" rel="noreferrer" className="flex justify-between gap-2 font-mono text-[10px] text-dim hover:text-ink">
            <span className="truncate">M{q.magnitude.toFixed(1)} · {q.place}</span>
            <span className="shrink-0">{ago(q.time, now)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
