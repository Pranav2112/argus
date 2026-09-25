import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadAccounts, loadArticles, loadClaims, loadEdges, loadEntities } from "../lib/data";
import { computeBlastRadius, downstreamAccounts, resumptionKind } from "../lib/blastRadius";
import { EVENT_REGION, groupIds } from "../lib/groups";
import { restatus } from "../lib/status";
import { getEvents } from "../lib/usgs";
import { linkClaimsToEdges } from "../lib/link";
import { assignStatuses, quoteInText, REJECT_BANNED, verifyClaims } from "../lib/extract";
import { FORBIDDEN } from "../lib/banned";
import { shortQuote } from "../lib/quote";
import type { Claim, EventRecord } from "../lib/types";

// In-memory test fixtures only; never written to data/claims.json.
const event: EventRecord = {
  id: "kyushu-2026", title: "t", hazard: "earthquake", occurred_at: null, lat: null, lon: null,
  magnitude: 6.8, source_url: null, tier: 1, status: "CONFIRMED", region: "kyushu",
};
const claim = (id: string, subj: string, type: Claim["claim_type"], status: Claim["status"], ev = "kyushu-2026"): Claim => ({
  claim_id: id, event_id: ev, article_id: "T", subject_entity_id: subj, claim_type: type,
  statement: "Aisin supplies Toyota", evidence_quote: "x", status,
});

const entities = loadEntities();
const accounts = loadAccounts();
const run = (claims: Claim[], assumePersists = false) =>
  computeBlastRadius({ event, claims, edges: linkClaimsToEdges(loadEdges(), claims, entities), entities, accounts, assumePersists });
const tierOf = (r: ReturnType<typeof run>, id: string) => r.alerts.find((a) => a.account.id === id)!.tier;

const confirmed = run([claim("C1", "aisin-kumamoto", "production_halted", "CONFIRMED")]);
assert.equal(tierOf(confirmed, "acct-prairie"), "NO ACTION");
assert.equal(tierOf(confirmed, "acct-lakeshore"), "REVIEW NOW");
assert.equal(tierOf(confirmed, "acct-kyushu-warehousing"), "MONITOR");
assert.equal(confirmed.alerts.find((a) => a.account.id === "acct-kyushu-warehousing")!.direct, true);

const reported = run([claim("C1", "aisin-kumamoto", "production_halted", "REPORTED")]);
assert.equal(tierOf(reported, "acct-lakeshore"), "MONITOR");

const renesas = run([claim("C1", "renesas-kawajiri", "production_halted", "CONFIRMED")]);
assert.equal(tierOf(renesas, "acct-voltaic"), "REVIEW NOW");
assert.equal(tierOf(renesas, "acct-brightline"), "MONITOR");
assert.equal(tierOf(renesas, "acct-harborline"), "MONITOR");
assert.equal(tierOf(run([claim("C1", "renesas-kawajiri", "production_halted", "CONFIRMED")], true), "acct-harborline"), "REVIEW NOW");

const memory = run([
  claim("C1", "aisin-kumamoto", "production_halted", "CONFIRMED"),
  claim("C2", "aisin-kumamoto", "production_halted", "REPORTED", "kumamoto-2016"),
]);
assert.equal(memory.alerts.find((a) => a.account.id === "acct-lakeshore")!.memory, true);

assert.equal(quoteInText("Production  HALTED\nat the plant", "…said production halted at the plant on Tuesday"), true);
assert.equal(quoteInText("production was halted", "production halted"), false);

// Entity grouping: a company-level report ("aisin") attaches to the Kumamoto plant.
const grouped = run([claim("C1", "aisin", "production_halted", "CONFIRMED")]);
assert.ok(grouped.affected["aisin-kumamoto"]);
assert.equal(tierOf(grouped, "acct-lakeshore"), "REVIEW NOW");
assert.ok(grouped.alerts.find((a) => a.account.id === "acct-lakeshore")!.unknowns.some((u) => u.includes("company-level")));

// Agreement across company + plant ids from two independent sources => CONFIRMED; one source => REPORTED.
const art = (id: string, source = id) => ({ id, url: "", source_name: source, tier: 3 as const, published_at: "", event_id: "kyushu-2026", file: "" });
const raw = (subject: string) => ({ subject_entity_id: subject, claim_type: "production_halted" as const, statement: "s", evidence_quote: "q" });
const agreed = assignStatuses([
  { article: art("X1"), claim: raw("aisin") },
  { article: art("X2"), claim: raw("aisin-kumamoto") },
]);
assert.ok(agreed.every((c) => c.status === "CONFIRMED"));
assert.equal(assignStatuses([{ article: art("X1"), claim: raw("aisin") }])[0].status, "REPORTED");
const samePublisher = assignStatuses([
  { article: art("X1", "IHS"), claim: raw("aisin") },
  { article: art("X2", "IHS"), claim: raw("aisin") },
]);
assert.ok(samePublisher.every((c) => c.status === "REPORTED"));

const sq = shortQuote("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen");
assert.ok(sq.endsWith("…") && sq.split(" ").length <= 16);

// Live-feed proximity: accounts downstream of a plant, including multi-hop, never the control case.
const down = downstreamAccounts(["aisin-kumamoto"], loadEdges(), accounts);
assert.ok(down.includes("acct-lakeshore") && down.includes("acct-harborline"));
assert.ok(!down.includes("acct-prairie") && !down.includes("acct-kyushu-warehousing"));

// Banned figures are rejected at extraction, and none remain in the generated claims.
const banned = verifyClaims(art("X1"), "Toyota makes 39% of its cars in Japan. Output halted.", [
  { subject_entity_id: "toyota", claim_type: "event_fact", statement: "Toyota makes 39% of its cars in Japan.", evidence_quote: "Toyota makes 39% of its cars in Japan" },
  { subject_entity_id: "toyota", claim_type: "production_halted", statement: "Toyota halted output.", evidence_quote: "Output halted" },
], entities);
assert.equal(banned.accepted.length, 1);
assert.equal(banned.rejected[0].reason, REJECT_BANNED);
assert.ok(loadClaims().claims.every((c) => !FORBIDDEN.test(c.statement)));

assert.ok(accounts.every((a) => a.lat === null || a.lat >= 0), "no account may render in the southern hemisphere");

// A missing verified claim is never shown as a negative fact.
const cascade = confirmed.alerts.find((a) => a.account.id === "acct-cascade")!;
assert.equal(cascade.tier, "NO ACTION");
assert.ok(cascade.headline.includes("no verified disruption · UNKNOWN"));

// HARD RULE: Kyushu 2026 tiers on the real data are identical to the saved baseline (taken before Taiwan 2024 was added).
const baseline = JSON.parse(readFileSync("scripts/fixtures/kyushu-tiers.json", "utf8")) as Record<
  string,
  Record<string, { tier: string; memory: boolean; path: string[] }>
>;
const kyushu = getEvents().find((e) => e.id === "kyushu-2026")!;
for (const persist of [false, true]) {
  const r = computeBlastRadius({
    event: kyushu, claims: loadClaims().claims, edges: loadEdges(), entities, accounts, articles: loadArticles(), assumePersists: persist,
  });
  for (const [id, want] of Object.entries(baseline[`persist=${persist}`])) {
    const got = r.alerts.find((a) => a.account.id === id)!;
    assert.deepEqual({ tier: got.tier, memory: got.memory, path: got.path }, want, `Kyushu ${id} persist=${persist} changed`);
  }
  for (const a of r.alerts.filter((x) => !(x.account.id in baseline[`persist=${persist}`]))) {
    assert.equal(a.tier, "NO ACTION", `new account ${a.account.id} must not be exposed to Kyushu`);
  }
  assert.ok(r.alerts.every((a) => !a.recovery && !a.resolved), "no de-escalation applies to Kyushu 2026");
}

// Replay statuses with every source in view equal the stored statuses.
{
  const all = loadClaims().claims;
  for (const e of getEvents()) {
    const again = restatus(all, e.id, loadArticles().filter((a) => a.event_id === e.id));
    assert.deepEqual(again.map((c) => c.status), all.map((c) => c.status), `restatus drift for ${e.id}`);
  }
}

// Region map mirrors data/events.json.
for (const e of getEvents()) assert.equal(EVENT_REGION[e.id], e.region, `EVENT_REGION out of sync for ${e.id}`);

// Region-aware grouping: company-level TSMC maps to Kumamoto in Kyushu and to all Taiwan fabs in Taiwan.
assert.deepEqual(groupIds("tsmc", "kyushu"), ["tsmc-kumamoto"]);
assert.deepEqual(groupIds("tsmc", "taiwan"), ["tsmc-hsinchu", "tsmc-taichung", "tsmc-tainan"]);
assert.deepEqual(groupIds("umc", "taiwan"), ["umc-hsinchu"]);

// De-escalation rule (in-memory fixtures).
const tw: EventRecord = { ...event, id: "taiwan-2024", region: "taiwan", magnitude: null };
const twc = (id: string, subj: string, type: Claim["claim_type"], status: Claim["status"], article: string, statement: string, quote = statement): Claim => ({
  claim_id: id, event_id: "taiwan-2024", article_id: article, subject_entity_id: subj, claim_type: type, statement, evidence_quote: quote, status,
});
const twArticles = ["T1", "T2", "T3", "T4", "T5"].map((id, i) => ({
  id, url: "", source_name: id, tier: 3 as const, published_at: `2024-04-0${3 + i}`, event_id: "taiwan-2024", file: "",
}));
const twRun = (claims: Claim[]) =>
  computeBlastRadius({ event: tw, claims, edges: loadEdges(), entities, accounts, articles: twArticles });
const nw = (r: ReturnType<typeof twRun>) => r.alerts.find((a) => a.account.id === "acct-northwind")!;
const halted = twc("X1", "tsmc", "production_halted", "CONFIRMED", "T1", "TSMC evacuated some fabs.");
assert.equal(nw(twRun([halted])).tier, "REVIEW NOW");
assert.ok(twRun([halted]).alerts.filter((a) => a.account.id !== "acct-northwind").every((a) => a.tier === "NO ACTION"));

const planned = twc("X2", "tsmc", "resumption", "CONFIRMED", "T2", "TSMC expects to fully restore production.", "production is expected to fully resume");
assert.equal(resumptionKind(planned), "planned");
assert.equal(nw(twRun([halted, planned])).tier, "REVIEW NOW", "planned restarts never change status");

const partial = twc("X3", "tsmc", "resumption", "REPORTED", "T3", "TSMC said some production lines have resumed.", "some production lines have resumed");
assert.equal(resumptionKind(partial), "partial");
const capped = nw(twRun([halted, partial]));
assert.equal(capped.tier, "MONITOR");
assert.equal(capped.recovery?.status, "RECOVERING");
assert.deepEqual(capped.decisiveClaimIds, ["X3"]);

const fullReported = twc("X4", "tsmc", "resumption", "REPORTED", "T4", "TSMC said fab equipment has fully recovered.", "equipment in fabs have been fully recovered");
assert.equal(resumptionKind(fullReported), "full");
assert.equal(nw(twRun([halted, fullReported])).tier, "MONITOR", "an unconfirmed full restoration only counts as RECOVERING");

const fullConfirmed = { ...fullReported, claim_id: "X5", article_id: "T5", status: "CONFIRMED" as const };
const resolved = nw(twRun([halted, partial, fullConfirmed]));
assert.equal(resolved.tier, "NO ACTION");
assert.equal(resolved.resolved, true);
assert.equal(resolved.recovery?.claimId, "X5");

// Publication order: a recovery claim published before the disruption claim does not pre-empt it.
const early = { ...fullConfirmed, claim_id: "X6", article_id: "T1" };
const lateHalt = { ...halted, claim_id: "X7", article_id: "T5" };
assert.equal(nw(twRun([early, lateHalt])).tier, "REVIEW NOW");

// Status only moves forward: a later disruption report does not undo RECOVERED.
const retro = { ...halted, claim_id: "X8", article_id: "T5" };
assert.equal(nw(twRun([halted, { ...fullConfirmed, article_id: "T4" }, retro])).resolved, true);

// Replay statuses use only the sources published so far.
const agreeing = [
  { ...halted, claim_id: "Y1", article_id: "T1", status: "REPORTED" as const },
  { ...halted, claim_id: "Y2", article_id: "T2", status: "REPORTED" as const },
];
assert.equal(restatus(agreeing, "taiwan-2024", twArticles.slice(0, 1))[0].status, "REPORTED");
assert.ok(restatus(agreeing, "taiwan-2024", twArticles.slice(0, 2)).every((c) => c.status === "CONFIRMED"));

console.log("blast radius tests passed");
