import { loadBundle } from "../lib/bundle";
import { replaySteps, tierLabelOf } from "../lib/replay";

// Prints tiers after each source of an event, with the claim that caused every tier change.
const eventId = process.argv[2] ?? "taiwan-2024";
const b = loadBundle();
const event = b.events.find((e) => e.id === eventId);
if (!event) throw new Error(`unknown event ${eventId}`);
const watch = process.argv.slice(3);
for (const [i, step] of replaySteps({ event, ...b }).entries()) {
  const { article, result, changes } = step;
  const shown = result.alerts.filter((a) => (watch.length ? watch.includes(a.account.id) : a.tier !== "NO ACTION" || a.resolved));
  console.log(`step ${i + 1} · ${article.id} ${article.source_name} (${article.published_at})`);
  console.log(`  tiers: ${shown.map((a) => `${a.account.id}=${tierLabelOf(a)}`).join(", ") || "all NO ACTION"}`);
  const states = Object.entries(result.plantStates).map(([p, s]) => `${p}=${s.status}(${s.causeClaimId})`);
  if (states.length) console.log(`  plants: ${states.join(", ")}`);
  for (const c of changes) console.log(`  change: ${c.account.id} ${c.from} → ${c.to} · cause ${c.cause ?? "none"}`);
}
