import { loadEvents, writeJson } from "../lib/data";
import { mergeUsgs, refreshUsgsCache } from "../lib/usgs";

async function main() {
  const cache = await refreshUsgsCache();
  const events = mergeUsgs(loadEvents(), cache);
  writeJson("events.json", events);
  for (const e of events) {
    console.log(`${e.id}: M${e.magnitude ?? "UNKNOWN"} at ${e.lat ?? "UNKNOWN"},${e.lon ?? "UNKNOWN"} ${e.occurred_at ?? ""}`);
  }
}

main();
