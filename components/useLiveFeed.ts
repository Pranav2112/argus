"use client";

import { useEffect, useState } from "react";
import type { LiveFeed } from "@/lib/live";

const POLL_MS = 60_000;

export function useLiveFeed() {
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/live/usgs", { cache: "no-store" })
        .then((r) => r.json() as Promise<LiveFeed>)
        .then((f) => alive && setFeed(f))
        .catch((e) => alive && setFeed((prev) => (prev ? { ...prev, live: false, error: String(e) } : { live: false, fetched_at: null, error: String(e), quakes: [] })));
    load();
    const poll = setInterval(load, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  const ageSec = feed?.fetched_at && now ? Math.max(0, Math.round((now - Date.parse(feed.fetched_at)) / 1000)) : null;
  return { feed, ageSec, now };
}

export function ago(iso: string, now: number | null): string {
  if (!now) return iso.slice(0, 16).replace("T", " ");
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
