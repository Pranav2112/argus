import { explain } from "@/lib/explain";

export async function POST(req: Request) {
  try {
    const { event_id, account_id, assume_persists, expected_tier } = await req.json();
    return Response.json(
      await explain(String(event_id), String(account_id), !!assume_persists, expected_tier ? String(expected_tier) : undefined),
    );
  } catch (err) {
    return Response.json(
      { sentences: [], actions: [], removed: 0, cached: false, generated_at: "", error: (err as Error).message },
      { status: 200 },
    );
  }
}
