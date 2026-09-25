import type { AccountAlert, ClaimStatus, Origin, PriorityTier } from "@/lib/types";
import { RECOVERY_RULE, TIER_RULES } from "@/lib/blastRadius";

export const TIER_COLOR: Record<PriorityTier, string> = {
  "REVIEW NOW": "#e5484d",
  MONITOR: "#e2a336",
  "NO ACTION": "#4f9d7a",
};

export { tierLabelOf as tierLabel } from "@/lib/replay";

export function TierBadge({ tier, large, resolved }: { tier: PriorityTier; large?: boolean; resolved?: boolean }) {
  return (
    <span
      title={resolved ? RECOVERY_RULE : TIER_RULES[tier]}
      className={`inline-block cursor-help border font-mono font-semibold tracking-wider ${large ? "px-2 py-0.5 text-sm" : "px-1.5 py-px text-[10px]"}`}
      style={{ color: TIER_COLOR[tier], borderColor: TIER_COLOR[tier] + "80", background: large ? TIER_COLOR[tier] + "18" : undefined }}
    >
      {resolved ? "RESOLVED" : tier}
    </span>
  );
}

export function RecoveryNote({ alert }: { alert: AccountAlert }) {
  if (!alert.recovery) return null;
  const done = alert.recovery.status === "RECOVERED";
  return (
    <span className={`font-mono text-[10px] ${done ? "text-noaction" : "text-monitor"}`}>
      {done ? "recovered" : "recovering"} · {alert.recovery.claimId}
    </span>
  );
}

export type EvidenceKind = "CONFIRMED" | "REPORTED" | "VERIFIED LINK" | "INFERRED" | "SYNTHETIC" | "UNKNOWN";

export const EVIDENCE_HELP: Record<EvidenceKind, string> = {
  CONFIRMED: "Claim from an official/company source, or corroborated by 2+ independent articles",
  REPORTED: "Claim from a single news/trade-press article; not yet corroborated",
  "VERIFIED LINK": "Supplier link backed by a quote-verified public claim",
  INFERRED: "Supplier link not yet backed by a verified claim",
  SYNTHETIC: "Fictional demonstration data (insured accounts and their links)",
  UNKNOWN: "Data not available; never guessed",
};

const EVIDENCE_CLASS: Record<EvidenceKind, string> = {
  CONFIRMED: "bg-ink text-bg border border-ink",
  REPORTED: "border border-ink/70 text-ink",
  "VERIFIED LINK": "border border-[#c3cad5] text-[#c3cad5]",
  INFERRED: "border border-dashed border-dim text-dim",
  SYNTHETIC: "bg-line text-dim border border-line",
  UNKNOWN: "border border-dotted border-ink/60 text-ink",
};

const EVIDENCE_GLYPH: Partial<Record<EvidenceKind, string>> = {
  "VERIFIED LINK": "━ ",
  INFERRED: "┄ ",
  UNKNOWN: "? ",
};

export function EvidenceTag({ kind }: { kind: EvidenceKind }) {
  return (
    <span title={EVIDENCE_HELP[kind]} className={`inline-block cursor-help px-1 font-mono text-[9px] leading-[14px] tracking-wider whitespace-nowrap ${EVIDENCE_CLASS[kind]}`}>
      {EVIDENCE_GLYPH[kind] ?? ""}
      {kind}
    </span>
  );
}

export function rejectedSummary(rejected: { reason: string }[]): string {
  const n = rejected.length;
  const head = `${n} claim${n === 1 ? "" : "s"} rejected`;
  if (!n) return `${head}: quote not found in source`;
  const by = new Map<string, number>();
  rejected.forEach((r) => by.set(r.reason, (by.get(r.reason) ?? 0) + 1));
  if (by.size === 1) return `${head}: ${rejected[0].reason}`;
  return `${head}: ${[...by].map(([reason, k]) => `${k} ${reason}`).join(", ")}`;
}

export const originKind = (o: Origin): EvidenceKind => (o === "PUBLIC_VERIFIED" ? "VERIFIED LINK" : o === "INFERRED" ? "INFERRED" : "SYNTHETIC");
export const statusKind = (s: ClaimStatus): EvidenceKind => (s === "UNKNOWN" ? "UNKNOWN" : s);

export function EvidenceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(EVIDENCE_HELP) as EvidenceKind[]).map((k) => (
        <EvidenceTag key={k} kind={k} />
      ))}
    </div>
  );
}

export function SyntheticBadge() {
  return (
    <span className="mr-1.5">
      <EvidenceTag kind="SYNTHETIC" />
    </span>
  );
}

export function StatusBadge({ status }: { status: ClaimStatus }) {
  return <EvidenceTag kind={statusKind(status)} />;
}

export function MemoryBadge() {
  return (
    <span className="inline-block border border-accent/60 bg-accent/10 px-1.5 py-px font-mono text-[10px] tracking-wide text-accent">
      Dependency first observed: Kumamoto 2016
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">{children}</div>;
}

export function formatDate(date: string, precision?: string) {
  return precision === "approx" ? `${date} (approx)` : date;
}
