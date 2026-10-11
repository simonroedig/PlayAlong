import { describe, expect, it } from "vitest";
import type { SongRecord } from "./library";
import { buildSongFile, readSongFileHeader, songFileName, songFileSection } from "./songFile";
import { decodeStems, encodeStems } from "./stemCodec";

const song: SongRecord = {
  id: "file-0123456789abcdef",
  source: { kind: "file", name: "demo.mp3" },
  title: "Demo: Song?",
  artist: "The Band",
  duration: 1,
  createdAt: 1,
  updatedAt: 2,
  status: "ready",
  hasThumbnail: true,
  frames: 4,
};

describe(".playalong song files", () => {
  it("round-trips the song record and every section", async () => {
    const stems = [Int16Array.from([1, -2, 3, -4, 5, -6, 7, -8]), Int16Array.from([9, 10, 11, 12, 13, 14, 15, 16])];
    const encoded = await encodeStems(stems, 4); // no WebCodecs in Node: stored as raw samples
    expect(encoded.info.codec).toBe("pcm16");
    const file = buildSongFile(song, {
      source: new Blob(["original audio"], { type: "audio/mpeg" }),
      thumbnail: new Blob(["jpeg"], { type: "image/jpeg" }),
      stems: encoded,
    });
    const { header, payloadStart } = await readSongFileHeader(file);
    expect(header.song).toEqual(song);
    expect(header.stems).toEqual(encoded.info);
    expect(await songFileSection(file, header, payloadStart, "source")!.text()).toBe("original audio");
    expect(songFileSection(file, header, payloadStart, "source")!.type).toBe("audio/mpeg");
    expect(await songFileSection(file, header, payloadStart, "thumbnail")!.text()).toBe("jpeg");
    const decoded = await decodeStems(header.stems!, songFileSection(file, header, payloadStart, "stems")!);
    expect(decoded.map((s) => Array.from(s))).toEqual(stems.map((s) => Array.from(s)));
  });

  it("rejects other files", async () => {
    await expect(readSongFileHeader(new Blob(["hello world, not a song"]))).rejects.toThrow("Not a PlayAlong song file");
  });

  it("names files after artist and title, safely", () => {
    expect(songFileName(song)).toBe("The Band - Demo Song.playalong");
    expect(songFileName({ title: "  ", artist: null }, " (2)")).toBe("Untitled (2).playalong");
  });
});
