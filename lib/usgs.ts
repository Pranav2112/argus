import { loadEvents, readJson, writeJson } from "./data";
import type { EventRecord } from "./types";

const QUERIES: Record<string, string> = {
  "kyushu-2026":
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2026-07-27&endtime=2026-07-30&minmagnitude=6&minlatitude=30&maxlatitude=35&minlongitude=128&maxlongitude=133",
  "kumamoto-2016":
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2016-04-14&endtime=2016-04-17&minmagnitude=6&minlatitude=30&maxlatitude=35&minlongitude=128&maxlongitude=133",
  "taiwan-2024":
    "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2024-04-02&endtime=2024-04-04&minmagnitude=7&minlatitude=22&maxlatitude=26&minlongitude=119&maxlongitude=123",
};

export interface UsgsQuake {
  usgs_id: string;
  place: string;
  magnitude: number;
  time: string;
  lat: number;
  lon: number;
  depth_km: number;
  url: string;
  fetched_at: string;
}

type Cache = Record<string, UsgsQuake>;

async function fetchLargest(url: string): Promise<UsgsQuake | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const data = await res.json();
  const feats = (data.features ?? []) as {
    id: string;
    properties: { mag: number; place: string; time: number; url: string };
    geometry: { coordinates: [number, number, number] };
  }[];
  if (!feats.length) return null;
  const f = feats.reduce((a, b) => (b.properties.mag > a.properties.mag ? b : a));
  const [lon, lat, depth] = f.geometry.coordinates;
  return {
    usgs_id: f.id,
    place: f.properties.place,
    magnitude: f.properties.mag,
    time: new Date(f.properties.time).toISOString(),
    lat,
    lon,
    depth_km: depth,
    url: f.properties.url,
    fetched_at: new Date().toISOString(),
  };
}

export async function refreshUsgsCache(): Promise<Cache> {
  const cache = readJson<Cache>("usgs_cache.json", {});
  for (const [id, url] of Object.entries(QUERIES)) {
    try {
      const q = await fetchLargest(url);
      if (q) cache[id] = q;
    } catch (err) {
      console.error(`USGS fetch failed for ${id}, using cache:`, (err as Error).message);
    }
  }
  writeJson("usgs_cache.json", cache);
  return cache;
}

export function loadUsgsCache(): Cache {
  return readJson<Cache>("usgs_cache.json", {});
}

export function mergeUsgs(events: EventRecord[], cache: Cache): EventRecord[] {
  return events.map((e) => {
    const q = cache[e.id];
    if (!q) return e;
    return {
      ...e,
      occurred_at: q.time,
      lat: q.lat,
      lon: q.lon,
      magnitude: q.magnitude,
      source_url: q.url,
      tier: 1,
      status: "CONFIRMED",
    };
  });
}

export function getEvents(): EventRecord[] {
  return mergeUsgs(loadEvents(), loadUsgsCache());
}
