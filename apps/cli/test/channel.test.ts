import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadChannelProfile } from "@ys/pipeline/light";
import { FsAssetStore } from "@ys/storage";
import { channelCommand } from "../src/channel.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ys-cli-channel-"));
  const store = new FsAssetStore(join(dir, "store"));
  const lines: string[] = [];
  return { dir, store, lines, deps: { store, print: (l: string) => lines.push(l) } };
}

describe("channel command", () => {
  it("show: says when nothing is imported, then prints the profile", async () => {
    const { deps, lines, dir, store } = setup();
    await channelCommand(deps, undefined, undefined);
    expect(lines[0]).toContain("No channel profile imported");
    const file = join(dir, "c.json");
    writeFileSync(file, JSON.stringify({ name: "Leo", lang: "en", extra: true }));
    await channelCommand(deps, "import", file);
    expect(lines[1]).toBe(`Channel profile "Leo" imported from ${file}`);
    expect(await loadChannelProfile(store)).toEqual({ name: "Leo", lang: "en" });
    await channelCommand(deps, "show", undefined);
    expect(JSON.parse(lines[2]!)).toEqual({ name: "Leo", lang: "en" });
  });

  it("import: invalid file and unknown sub-command fail", async () => {
    const { deps, dir } = setup();
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ lang: "en" }));
    await expect(channelCommand(deps, "import", file)).rejects.toThrow();
    await expect(channelCommand(deps, "import", join(dir, "missing.json"))).rejects.toThrow();
    await expect(channelCommand(deps, "nope", undefined)).rejects.toThrow("Unknown channel command");
  });
});
