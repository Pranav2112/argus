// A company and its plants in the event region are treated as one group; claims attach to the plant nodes.
// A company-level claim ("tsmc") attaches to every grouped plant of that company in the event's region.
export const PLANTS: Record<string, Record<string, string[]>> = {
  kyushu: {
    aisin: ["aisin-kumamoto"],
    renesas: ["renesas-kawajiri"],
    toyota: ["toyota-kyushu-miyata"],
    nissan: ["nissan-kyushu"],
    tsmc: ["tsmc-kumamoto"],
    sony: ["sony-kumamoto"],
    "tokyo-electron": ["tel-kyushu"],
    honda: ["honda-kumamoto"],
    fcc: ["fcc-uki"],
    daihatsu: ["daihatsu-kyushu"],
  },
  taiwan: {
    tsmc: ["tsmc-hsinchu", "tsmc-taichung", "tsmc-tainan"],
    umc: ["umc-hsinchu"],
  },
};

// Kept in sync with data/events.json (asserted in scripts/test-blast.ts).
export const EVENT_REGION: Record<string, string> = {
  "kyushu-2026": "kyushu",
  "kumamoto-2016": "kyushu",
  "taiwan-2024": "taiwan",
};

export const regionOf = (eventId: string) => EVENT_REGION[eventId] ?? "";

export function groupIds(entityId: string | null, region: string): string[] {
  if (!entityId) return [];
  return PLANTS[region]?.[entityId] ?? [entityId];
}

export function isCompanyLevel(entityId: string | null, region?: string): boolean {
  if (!entityId) return false;
  return region ? entityId in (PLANTS[region] ?? {}) : Object.values(PLANTS).some((r) => entityId in r);
}
