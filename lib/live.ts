export const NEARBY_KM = 200;

export interface LiveQuake {
  id: string;
  magnitude: number;
  place: string;
  time: string;
  lat: number;
  lon: number;
  depth_km: number;
  url: string;
  nearby: { id: string; name: string; km: number }[];
  exposedAccounts: string[];
}

export interface LiveFeed {
  live: boolean;
  fetched_at: string | null;
  error?: string;
  quakes: LiveQuake[];
}
