import fs from "node:fs";
import path from "node:path";
import type { Account, Article, ClaimsFile, Edge, Entity, EventRecord } from "./types";

export const DATA_DIR = path.join(process.cwd(), "data");

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2) + "\n");
}

// Serverless hosts (e.g. Vercel) have a read-only filesystem; runtime cache writes must not fail the request.
export function tryWriteJson(file: string, data: unknown): boolean {
  try {
    writeJson(file, data);
    return true;
  } catch {
    return false;
  }
}

export const loadArticles = () => readJson<Article[]>("articles.json", []);
export const loadEvents = () => readJson<EventRecord[]>("events.json", []);
export const loadEntities = () => readJson<Entity[]>("entities.json", []);
export const loadAccounts = () => readJson<Account[]>("accounts.json", []);
export const loadEdges = () => readJson<Edge[]>("edges.json", []);
export const loadClaims = () =>
  readJson<ClaimsFile>("claims.json", { generated_at: "", claims: [], rejected: [] });

export function loadArticleText(article: Article): string {
  try {
    return fs.readFileSync(path.join(DATA_DIR, "articles", article.file), "utf8");
  } catch {
    return "";
  }
}
