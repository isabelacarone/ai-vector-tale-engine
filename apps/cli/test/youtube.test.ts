import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EpisodeState } from "@ys/pipeline";
import type { FetchFn } from "@ys/publisher";
import { parsePrivacy, publishCommand, publishTarget, youtubeAuthCommand } from "../src/youtube.ts";

const ENV = { YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "sec", YT_REFRESH_TOKEN: "rt" };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

function fakeFetch(answers: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected fetch ${String(url)}`);
    return next;
  }) as FetchFn;
  return { fetch, calls };
}

function episode(dir: string, extra: Partial<EpisodeState> = {}): EpisodeState {
  const mp4 = join(dir, "e1.mp4");
  writeFileSync(mp4, new Uint8Array(4));
  return {
    id: "e1",
    createdAt: "t",
    input: { topic: "Topic", lang: "en", targetSec: 90, tier: "economy", aiClipRatio: 0, budgetUsd: 5 },
    done: {},
    stats: {},
    activity: [],
    approvals: {},
    render: { path: mp4, at: "t" },
    package: { title: "Pack title", thumbnailText: "K", description: "Desc\n\n0:00 A", tags: ["a", "b"], at: "t" },
    ...extra,
  } as unknown as EpisodeState;
}

function fakePipeline(state: EpisodeState) {
  const saved: EpisodeState[] = [];
  let current = state;
  return {
    saved,
    pipeline: {
      load: async () => structuredClone(current),
      save: async (s: EpisodeState) => {
        current = s;
        saved.push(s);
      },
    },
  };
}

describe("publish target", () => {
  it("main video takes the package texts and the thumbnail next to the video when it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const s = episode(dir);
    expect(publishTarget(s, dir, {})).toEqual({ kind: "main", path: s.render!.path, title: "Pack title", description: "Desc\n\n0:00 A", tags: ["a", "b"] });
    writeFileSync(join(dir, "e1", "..", "e1.jpg"), new Uint8Array(1));
    const dir2 = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const s2 = episode(dir2, { render: { path: join(dir2, "e1.mp4"), at: "t", thumbnail: join(dir2, "e1.mp4") } });
    expect(publishTarget(s2, dir2, {}).thumbnail).toBe(join(dir2, "e1.mp4"));
    // Without a package: the topic is the title.
    expect(publishTarget(episode(dir, { package: undefined }), dir, {})).toMatchObject({ title: "Topic", description: "", tags: [] });
    expect(() => publishTarget(episode(dir, { render: undefined }), dir, {})).toThrow("no rendered video");
  });

  it("Short n takes its own title and #Shorts; legacy single short; missing Short errors", () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const one = { path: "/s1.mp4", title: "First", scenes: ["s1"], sec: 30, at: "t", index: 1 };
    const two = { ...one, path: "/s2.mp4", title: "Second", index: 2 };
    const s = episode(dir, { short: one, shorts: [one, two] });
    expect(publishTarget(s, dir, { short: true })).toEqual({ kind: "short", index: 1, path: "/s1.mp4", title: "First", description: "Desc\n\n0:00 A\n\n#Shorts", tags: ["a", "b"] });
    expect(publishTarget(s, dir, { short: true, n: 2 })).toMatchObject({ index: 2, title: "Second" });
    expect(publishTarget(episode(dir, { short: one }), dir, { short: true })).toMatchObject({ title: "First" });
    expect(() => publishTarget(s, dir, { short: true, n: 3 })).toThrow("Short 3 does not exist (the episode has 2)");
    expect(() => publishTarget(episode(dir), dir, { short: true })).toThrow("no Short yet");
    expect(publishTarget(episode(dir, { package: undefined, short: one }), dir, { short: true }).description).toBe("#Shorts");
  });

  it("privacy flag", () => {
    expect([parsePrivacy(undefined), parsePrivacy("unlisted"), parsePrivacy("public")]).toEqual(["private", "unlisted", "public"]);
    expect(() => parsePrivacy("secret")).toThrow("--privacy must be one of");
  });
});

describe("publish command", () => {
  it("refreshes the token, uploads, sets the thumbnail and records the result in the state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const jpg = join(dir, "e1.jpg");
    writeFileSync(jpg, new Uint8Array(2));
    const s = episode(dir, { render: { path: join(dir, "e1.mp4"), at: "t", thumbnail: jpg } });
    const { pipeline, saved } = fakePipeline(s);
    const { fetch, calls } = fakeFetch([json({ access_token: "AT" }), new Response(null, { status: 200, headers: { location: "https://up/1" } }), json({ id: "vid" }), json({})]);
    const lines: string[] = [];
    const rec = await publishCommand({ pipeline, workDir: dir, print: (l) => lines.push(l), env: ENV, fetch }, "e1", {});
    expect(rec).toMatchObject({ videoId: "vid", url: "https://www.youtube.com/watch?v=vid", privacy: "private" });
    expect(saved[0]!.publish!.main).toEqual(rec);
    expect(calls.map((c) => c.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      "https://up/1",
      "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=vid",
    ]);
    expect(JSON.parse(String(calls[1]!.init.body)).snippet).toMatchObject({ title: "Pack title", defaultLanguage: "en" });
    expect(lines[0]).toBe("Uploading main video as private: Pack title");
    expect(lines.at(-1)).toBe("Uploaded: https://www.youtube.com/watch?v=vid (private)");
  });

  it("a failed thumbnail is recorded, not fatal; Shorts are kept by index; unlisted warns about the unverified app", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const jpg = join(dir, "e1.jpg");
    writeFileSync(jpg, new Uint8Array(2));
    const one = { path: join(dir, "e1.mp4"), title: "First", scenes: ["s1"], sec: 30, at: "t", index: 1 };
    const two = { ...one, title: "Second", index: 2 };
    const s = episode(dir, { render: { path: join(dir, "e1.mp4"), at: "t", thumbnail: jpg }, shorts: [one, two], publish: { shorts: [{ videoId: "old", url: "u", privacy: "private", at: "t", index: 2 }] } });
    const { pipeline, saved } = fakePipeline(s);
    const lines: string[] = [];
    const main = fakeFetch([json({ access_token: "AT" }), new Response(null, { status: 200, headers: { location: "https://up/1" } }), json({ id: "v1" }), json({ error: { message: "no phone" } }, 403)]);
    const rec = await publishCommand({ pipeline, workDir: dir, print: (l) => lines.push(l), env: ENV, fetch: main.fetch }, "e1", { privacy: "unlisted" });
    expect(rec.thumbnailError).toBe("Thumbnail upload failed (HTTP 403): no phone");
    expect(lines.at(-1)).toContain("unverified OAuth app keeps it private");
    const short = fakeFetch([json({ access_token: "AT" }), new Response(null, { status: 200, headers: { location: "https://up/2" } }), json({ id: "v2" })]);
    const rec2 = await publishCommand({ pipeline, workDir: dir, print: (l) => lines.push(l), env: ENV, fetch: short.fetch }, "e1", { short: true, n: 2 });
    expect(rec2.index).toBe(2);
    expect(short.calls).toHaveLength(3);
    expect(saved.at(-1)!.publish).toEqual({ main: rec, shorts: [rec2] });
    const short1 = fakeFetch([json({ access_token: "AT" }), new Response(null, { status: 200, headers: { location: "https://up/3" } }), json({ id: "v3" })]);
    const rec3 = await publishCommand({ pipeline, workDir: dir, print: (l) => lines.push(l), env: ENV, fetch: short1.fetch }, "e1", { short: true });
    expect(saved.at(-1)!.publish!.shorts!.map((r) => r.index)).toEqual([1, 2]);
    expect(rec3.index).toBe(1);
  });

  it("refuses without id, refresh token or video file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ys-yt-"));
    const s = episode(dir);
    const { pipeline } = fakePipeline(s);
    const deps = { pipeline, workDir: dir, print: () => {}, env: ENV, fetch: fakeFetch([]).fetch };
    await expect(publishCommand(deps, undefined, {})).rejects.toThrow("episode id required");
    await expect(publishCommand({ ...deps, env: { YT_CLIENT_ID: "c", YT_CLIENT_SECRET: "s" } }, "e1", {})).rejects.toThrow("YT_REFRESH_TOKEN is missing");
    const gone = fakePipeline(episode(dir, { render: { path: join(dir, "missing.mp4"), at: "t" } }));
    await expect(publishCommand({ ...deps, pipeline: gone.pipeline }, "e1", {})).rejects.toThrow("Video file not found");
    await expect(publishCommand(deps, "e1", { privacy: "x" })).rejects.toThrow("--privacy");
  });
});

describe("youtube auth", () => {
  const env = { YT_CLIENT_ID: "cid", YT_CLIENT_SECRET: "sec", YT_REDIRECT_URI: "http://127.0.0.1:0/callback" };

  it("prints the consent URL, receives the code on the loopback server and prints the refresh token", async () => {
    const { fetch, calls } = fakeFetch([json({ access_token: "A", refresh_token: "REFRESH" })]);
    const lines: string[] = [];
    await youtubeAuthCommand({
      print: (l) => lines.push(l),
      env,
      fetch,
      onListening: (cb) => {
        void globalThis.fetch(`${cb.replace("/callback", "/other")}`).then((r) => r.arrayBuffer());
        void globalThis.fetch(`${cb}?code=the-code&scope=x`).then((r) => r.text());
      },
    });
    expect(lines[0]).toContain("https://accounts.google.com/o/oauth2/v2/auth?client_id=cid");
    expect(String(calls[0]!.init.body)).toContain("code=the-code");
    expect(lines.at(-1)).toBe("\nAdd this line to .env (keep it secret):\nYT_REFRESH_TOKEN=REFRESH");
  });

  it("a denied consent or a missing refresh token is an error", async () => {
    await expect(
      youtubeAuthCommand({ print: () => {}, env, fetch: fakeFetch([]).fetch, onListening: (cb) => void globalThis.fetch(`${cb}?error=access_denied`).then((r) => r.text()) }),
    ).rejects.toThrow("Google returned no code (access_denied)");
    await expect(
      youtubeAuthCommand({ print: () => {}, env, fetch: fakeFetch([json({ access_token: "A" })]).fetch, onListening: (cb) => void globalThis.fetch(`${cb}?code=k`).then((r) => r.text()) }),
    ).rejects.toThrow("no refresh token");
  });
});
