import { SongView } from "@/components/SongView";

export const metadata = { title: "Play along" };

export default async function SongPage({ params }: PageProps<"/song/[id]">) {
  const { id } = await params;
  return <SongView id={decodeURIComponent(id)} />;
}
