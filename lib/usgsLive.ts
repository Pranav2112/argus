import { loadAccounts, loadEdges, loadEntities, readJson, writeJson } from "./data";
import { downstreamAccounts } from "./blastRadius";
import { NEARBY_KM, type LiveFeed, type LiveQuake } from "./live";

export const LIVE_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const CACHE = "usgs_live_cache.json";

type Feature = {
  id: string;
  properties: { mag: number; place: string; time: number; url: string };
  geometry: { coordinates: [number, number, number] };
};

function km(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function enrich(features: Feature[]): LiveQuake[] {
  const facilities = loadEntities().filter((e) => e.type === "facility" && e.lat !== null && e.lon !== null);
  const edges = loadEdges();
  const accounts = loadAccounts();
  return features
    .map((f) => {
      const [lon, lat, depth] = f.geometry.coordinates;
      const nearby = facilities
        .map((e) => ({ id: e.id, name: e.short_name ?? e.name, km: Math.round(km(lat, lon, e.lat!, e.lon!)) }))
        .filter((n) => n.km <= NEARBY_KM)
        .sort((a, b) => a.km - b.km);
      return {
        id: f.id,
        magnitude: f.properties.mag,
        place: f.properties.place,
        time: new Date(f.properties.time).toISOString(),
        lat,
        lon,
        depth_km: depth,
        url: f.properties.url,
        nearby,
        exposedAccounts: downstreamAccounts(nearby.map((n) => n.id), edges, accounts),
      };
    })
    .sort((a, b) => b.time.localeCompare(a.time));
}

export async function getLiveFeed(): Promise<LiveFeed> {
  try {
    const res = await fetch(LIVE_FEED_URL, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
    const data = (await res.json()) as { features?: Feature[] };
    const feed: LiveFeed = { live: true, fetched_at: new Date().toISOString(), quakes: enrich(data.features ?? []) };
    try {
      writeJson(CACHE, { fetched_at: feed.fetched_at, features: data.features ?? [] });
    } catch {}
    return feed;
  } catch (err) {
    const cached = readJson<{ fetched_at: string | null; features: Feature[] }>(CACHE, { fetched_at: null, features: [] });
    return { live: false, fetched_at: cached.fetched_at, error: (err as Error).message, quakes: enrich(cached.features) };
  }
}
