"use client";

import { useEffect, useState } from "react";
import { briefSignature, type BlastResult } from "@/lib/blastRadius";
import type { Brief } from "@/lib/brief";
import type { Entity, PriorityTier } from "@/lib/types";
import { Label, TIER_COLOR, tierLabel } from "./ui";

const TIERS: PriorityTier[] = ["REVIEW NOW", "MONITOR"];
const STATUS_CLASS = { DISRUPTED: "text-review", RECOVERING: "text-monitor", RECOVERED: "text-noaction" } as const;

export default function EventOverview({
  eventId,
  persist,
  result,
  entities,
  sessionActive,
  onSelect,
}: {
  eventId: string;
  persist: boolean;
  result: BlastResult;
  entities: Entity[];
  sessionActive: boolean;
  onSelect: (accountId: string) => void;
}) {
  const short = (id: string) => entities.find((e) => e.id === id)?.short_name ?? id;
  const byPlant = Object.keys(result.affected)
    .map((plant) => ({
      plant,
      claims: result.affected[plant],
      state: result.plantStates[plant],
      alerts: result.alerts.filter((a) => a.path[0] === plant && (a.tier !== "NO ACTION" || a.resolved)),
    }))
    .sort((a, b) => b.alerts.length - a.alerts.length || b.claims.length - a.claims.length);
  const maxAlerts = Math.max(1, ...byPlant.map((p) => p.alerts.length));

  return (
    <div className="space-y-4 text-xs">
      <BriefPanel
        eventId={eventId}
        persist={persist}
        sessionActive={sessionActive}
        signature={sessionActive ? undefined : briefSignature(result.alerts)}
      />
      <div>
        <Label>Exposure by affected plant · live</Label>
        <div className="space-y-2">
          {byPlant.map(({ plant, claims, state, alerts }) => {
            const confirmed = claims.some((c) => c.status === "CONFIRMED");
            return (
              <div key={plant} className="border border-line bg-panel2 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12px] text-ink">{short(plant)}</span>
                  <span className={`font-mono text-[10px] ${confirmed ? "text-ink" : "text-dim"}`}>
                    {state && state.status !== "DISRUPTED" && (
                      <span className={STATUS_CLASS[state.status]} title={`Status set by ${state.causeClaimId}`}>
                        {state.status} ({state.causeClaimId}) ·{" "}
                      </span>
                    )}
                    {confirmed ? "CONFIRMED" : "REPORTED only"} · {claims.length} claim{claims.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="my-1 flex h-1.5 bg-bg">
                  {TIERS.map((t) => {
                    const n = alerts.filter((a) => a.tier === t).length;
                    return n ? <div key={t} style={{ width: `${(n / maxAlerts) * 100}%`, background: TIER_COLOR[t] }} /> : null;
                  })}
                </div>
                {alerts.length ? (
                  <div className="flex flex-wrap gap-1">
                    {alerts.map((a) => (
                      <button
                        key={a.account.id}
                        onClick={() => onSelect(a.account.id)}
                        className="border px-1 font-mono text-[10px] hover:bg-accent/10"
                        style={{ borderColor: TIER_COLOR[a.tier], color: TIER_COLOR[a.tier] }}
                      >
                        SYNTHETIC · {a.account.name}
                        {a.resolved ? ` · ${tierLabel(a)}` : ""}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="font-mono text-[10px] text-dim">No SYNTHETIC account depends on this plant.</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-2 font-mono text-[9px] text-dim">Counts of dependency paths only. No loss, duration or probability estimates.</div>
      </div>
    </div>
  );
}

function BriefPanel({
  eventId,
  persist,
  sessionActive,
  signature,
}: {
  eventId: string;
  persist: boolean;
  sessionActive: boolean;
  signature?: string;
}) {
  const key = `${eventId}:${persist}:${signature ?? "*"}`;
  const [state, setState] = useState<{ key: string; data: Brief } | null>(null);
  const data = state?.key === key ? state.data : null;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, assume_persists: persist, expected_signature: signature }),
    })
      .then((r) => r.json())
      .then((d: Brief) => !cancelled && setState({ key, data: d }))
      .catch((e) => !cancelled && setState({ key, data: { sentences: [], removed: 0, cached: false, generated_at: "", error: String(e) } }));
    return () => {
      cancelled = true;
    };
  }, [key, eventId, persist, signature]);

  const unavailable = !!data && !data.sentences.length;
  return (
    <div className="border border-accent/40 bg-bg p-2">
      <div className="mb-1 flex items-center justify-between">
        <Label>Event brief · every sentence cited</Label>
        {data && (
          <span className="font-mono text-[9px] text-dim">
            {unavailable ? "NOT CACHED" : data.cached ? "CACHED" : "LIVE"}
            {data.removed ? ` · ${data.removed} uncited sentence(s) removed` : ""}
          </span>
        )}
      </div>
      {!data && <div className="font-mono text-[11px] text-dim">loading…</div>}
      {unavailable && (
        <div className="font-mono text-[11px] text-dim">
          {data.stale
            ? "The brief covers the latest sources only. Move replay to the last source to see it; the tiers above apply to this step."
            : "No brief available. The tiers and evidence stand on their own."}
        </div>
      )}
      {data && data.sentences.length > 0 && <p className="leading-relaxed">{data.sentences.join(" ")}</p>}
      {sessionActive && <div className="mt-1 font-mono text-[9px] text-monitor">Brief covers saved sources only; pasted articles are reflected in the tiers, not here.</div>}
    </div>
  );
}
