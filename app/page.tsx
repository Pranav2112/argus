import Command from "@/components/Command";
import { loadBundle } from "@/lib/bundle";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Command bundle={loadBundle()} />;
}
