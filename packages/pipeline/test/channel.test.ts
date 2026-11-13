import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsAssetStore, getJson, putJson } from "@ys/storage";
import { CHANNEL_KEY, importChannelFile, loadChannelProfile, saveChannelProfile } from "../src/channel.ts";

const tempDir = () => mkdtempSync(join(tmpdir(), "ys-channel-"));

describe("channel profile store", () => {
  it("is undefined until imported; save validates and load reads it back", async () => {
    const store = new FsAssetStore(tempDir());
    expect(await loadChannelProfile(store)).toBeUndefined();
    await expect(saveChannelProfile(store, { lang: "en" })).rejects.toThrow();
    const saved = await saveChannelProfile(store, { name: " Leo ", lang: "en", persona: "warm" });
    expect(saved).toEqual({ name: "Leo", lang: "en", persona: "warm" });
    expect(await getJson(store, CHANNEL_KEY)).toEqual(saved);
    expect(await loadChannelProfile(store)).toEqual(saved);
  });

  it("imports the versioned JSON file; a broken stored copy loads as undefined", async () => {
    const dir = tempDir();
    const store = new FsAssetStore(dir);
    const file = join(dir, "channel.json");
    writeFileSync(file, JSON.stringify({ name: "Leo", lineStyle: "outline", voiceId: "v1" }));
    expect(await importChannelFile(store, file)).toEqual({ name: "Leo", lineStyle: "outline", voiceId: "v1" });
    await putJson(store, CHANNEL_KEY, { name: "" });
    expect(await loadChannelProfile(store)).toBeUndefined();
  });
});
