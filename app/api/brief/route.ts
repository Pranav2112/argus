import { brief } from "@/lib/brief";

export async function POST(req: Request) {
  try {
    const { event_id, assume_persists, expected_signature } = await req.json();
    return Response.json(
      await brief(String(event_id), !!assume_persists, typeof expected_signature === "string" ? expected_signature : undefined),
    );
  } catch (err) {
    return Response.json({ sentences: [], removed: 0, cached: false, generated_at: "", error: (err as Error).message });
  }
}
