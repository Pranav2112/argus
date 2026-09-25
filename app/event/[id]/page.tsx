import { notFound } from "next/navigation";
import Workspace from "@/components/Workspace";
import { loadBundle } from "@/lib/bundle";

export const dynamic = "force-dynamic";

export default async function EventPage({ params, searchParams }: PageProps<"/event/[id]">) {
  const { id } = await params;
  const { demo } = await searchParams;
  const bundle = loadBundle();
  if (!bundle.events.some((e) => e.id === id)) notFound();
  return <Workspace bundle={bundle} eventId={id} autoDemo={demo === "1"} />;
}
