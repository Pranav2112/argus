import { loadBundle } from "../lib/bundle";
import { computeBlastRadius } from "../lib/blastRadius";
import { explain } from "../lib/explain";
import { brief } from "../lib/brief";
import { llmInfo, llmLabel } from "../lib/llm";

// Pre-warms data/explanations.json so the demo never needs the network.
async function main() {
  const info = llmInfo();
  console.log(`LLM: ${llmLabel()}`);
  if (info.error) console.error(`ERROR: ${info.error} Cached explanations will be used where available.`);
  const b = loadBundle();
  for (const event of b.events) {
    for (const persist of [false, true]) {
      const br = await brief(event.id, persist);
      console.log(`${event.id} brief (persist=${persist}): ${br.error ? "ERROR " + br.error : `${br.sentences.length} sentences, ${br.removed} removed${br.cached ? " (cached)" : ""}`}`);
      const r = computeBlastRadius({
        event, claims: b.claims, edges: b.edges, entities: b.entities, accounts: b.accounts, articles: b.articles, assumePersists: persist,
      });
      for (const a of r.alerts.filter((x) => x.tier !== "NO ACTION" || x.resolved)) {
        const out = await explain(event.id, a.account.id, persist);
        const label = a.resolved ? "RESOLVED" : a.tier;
        console.log(`${event.id} ${a.account.id} ${label}: ${out.error ? "ERROR " + out.error : `${out.sentences.length} sentences, ${out.removed} removed${out.cached ? " (cached)" : ""}`}`);
      }
    }
  }
}

main();
