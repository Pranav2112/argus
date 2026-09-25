import { getLiveFeed } from "@/lib/usgsLive";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getLiveFeed());
}
