import { redirect } from "next/navigation";
import { SongView } from "@/components/SongView";
import { SHOWCASE } from "@/lib/features";

export const metadata = { title: "Play along" };

export default async function SongPage({ params }: PageProps<"/song/[id]">) {
  // The public showcase has no player: songs open in your own copy.
  if (SHOWCASE) redirect("/#get");
  const { id } = await params;
  return <SongView id={decodeURIComponent(id)} />;
}
