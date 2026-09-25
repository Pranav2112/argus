// Display-only trim: show one short clause of a verified quote, never the full article text.
export function shortQuote(q: string, maxWords = 15): string {
  const clause = q.trim().split(/(?<=[;:.!?])\s+/)[0];
  const words = clause.split(/\s+/);
  const cut = words.length > maxWords || clause.length < q.trim().length;
  return words.slice(0, maxWords).join(" ").replace(/[,;:.]$/, "") + (cut ? " …" : "");
}
