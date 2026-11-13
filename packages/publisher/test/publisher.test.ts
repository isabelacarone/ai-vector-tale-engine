import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  apiError,
  DEFAULT_REDIRECT_URI,
  exchangeCode,
  QUOTA_MESSAGE,
  refreshAccessToken,
  setThumbnail,
  uploadVideo,
  videoSnippet,
  YOUTUBE_LIMITS,
  YOUTUBE_SCOPES,
  youtubeAuthUrl,
  youtubeEnv,
  YouTubeApiError,
  type FetchFn,
} from "../src/index.ts";

type Call = { url: string; init: RequestInit };

/** A fetch that records calls and answers from a queue. */
function fakeFetch(answers: Response[]): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  }) as FetchFn;
  return { fetch, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const tmpFile = (name: string, bytes: number) => {
  const dir = mkdtempSync(join(tmpdir(), "ys-pub-"));
  const file = join(dir, name);
  writeFileSync(file, new Uint8Array(bytes).fill(7));
  return file;
};

describe("environment", () => {
  it("reads the OAuth client, optional refresh token and redirect URI; names what is missing", () => {
    expect(youtubeEnv({ YT_CLIENT_ID: " id ", YT_CLIENT_SECRET: "s", YT_REFRESH_TOKEN: "", YT_REDIRECT_URI: " " })).toEqual({
      clientId: "id",
      clientSecret: "s",
      refreshToken: undefined,
      redirectUri: DEFAULT_REDIRECT_URI,
    });
    expect(youtubeEnv({ YT_CLIENT_ID: "id", YT_CLIENT_SECRET: "s", YT_REFRESH_TOKEN: "r", YT_REDIRECT_URI: "http://127.0.0.1:9000/cb" }).redirectUri).toBe("http://127.0.0.1:9000/cb");
    expect(() => youtubeEnv({})).toThrow("Missing YT_CLIENT_ID and YT_CLIENT_SECRET");
    expect(() => youtubeEnv({ YT_CLIENT_ID: "id" })).toThrow("Missing YT_CLIENT_SECRET");
  });
});

describe("oauth", () => {
  it("consent URL asks for offline access with both scopes", () => {
    const url = new URL(youtubeAuthUrl({ clientId: "c", redirectUri: "http://127.0.0.1:1/cb" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPES.join(" "));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(new URL(youtubeAuthUrl({ clientId: "c", redirectUri: "x", scopes: ["a"] })).searchParams.get("scope")).toBe("a");
  });

  it("code exchange and refresh post form bodies and map the token response", async () => {
    const { fetch, calls } = fakeFetch([json({ access_token: "A", refresh_token: "R", expires_in: 100 }), json({ access_token: "B" })]);
    expect(await exchangeCode({ clientId: "c", clientSecret: "s", code: "k", redirectUri: "u", fetch })).toEqual({ accessToken: "A", refreshToken: "R", expiresIn: 100 });
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]!.init.body)).toBe("client_id=c&client_secret=s&code=k&redirect_uri=u&grant_type=authorization_code");
    expect(await refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "R", fetch })).toEqual({ accessToken: "B", refreshToken: undefined, expiresIn: 3600 });
    expect(String(calls[1]!.init.body)).toContain("grant_type=refresh_token");
  });

  it("token errors carry the status and Google's description; a missing access_token is an error", async () => {
    const { fetch } = fakeFetch([json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400), json({})]);
    const err = await refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "R", fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(YouTubeApiError);
    expect((err as YouTubeApiError).status).toBe(400);
    expect((err as Error).message).toBe("OAuth token refresh failed (HTTP 400): Token has been expired or revoked.");
    await expect(refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "R", fetch })).rejects.toThrow("returned no access_token");
  });
});

describe("api errors", () => {
  it("quota exhaustion gets a plain explanation; other errors keep the reason and message; non-JSON bodies are quoted", async () => {
    const quota = await apiError(json({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403), "Upload");
    expect(quota.message).toBe(QUOTA_MESSAGE);
    expect(quota.reason).toBe("quotaExceeded");
    const daily = await apiError(json({ error: { message: "x", errors: [{ reason: "dailyLimitExceeded" }] } }, 403), "Upload");
    expect(daily.message).toBe(QUOTA_MESSAGE);
    const other = await apiError(json({ error: { message: "The request metadata specifies an invalid video title.", errors: [{ reason: "invalidTitle" }] } }, 400), "Upload session");
    expect(other.message).toBe("Upload session failed (HTTP 400): The request metadata specifies an invalid video title.");
    expect(other.reason).toBe("invalidTitle");
    const text = await apiError(new Response("<html>gateway</html>", { status: 502 }), "Upload");
    expect(text.message).toBe("Upload failed (HTTP 502): <html>gateway</html>");
    const empty = await apiError(new Response("", { status: 500 }), "Upload");
    expect(empty.message).toBe("Upload failed (HTTP 500)");
    const stringError = await apiError(json({ error: "bad" }, 401), "Upload");
    expect(stringError.message).toBe("Upload failed (HTTP 401): bad");
  });
});

describe("upload", () => {
  it("snippet is cut to YouTube's limits", () => {
    const s = videoSnippet({ title: ` ${"t".repeat(120)} `, description: "d".repeat(6000), tags: [" a ", "", "b".repeat(498), "c", "d"], language: "en" });
    expect(s.title).toHaveLength(YOUTUBE_LIMITS.title);
    expect(s.description).toHaveLength(YOUTUBE_LIMITS.description);
    // 1 + 498 + 1 = 500 fits; the next tag would pass the total and is dropped.
    expect(s.tags).toEqual(["a", "b".repeat(498), "c"]);
    expect(s).toMatchObject({ categoryId: "27", defaultLanguage: "en", defaultAudioLanguage: "en" });
    expect(videoSnippet({ title: "  ", description: "", categoryId: "24" })).toEqual({ title: "Untitled", description: "", tags: [], categoryId: "24" });
  });

  it("resumable upload: metadata POST, bytes PUT to the Location, returns the id and URL", async () => {
    const file = tmpFile("v.mp4", 12);
    const { fetch, calls } = fakeFetch([new Response(null, { status: 200, headers: { location: "https://upload.example/session" } }), json({ id: "vid1" })]);
    const out = await uploadVideo({ accessToken: "A", filePath: file, title: "T", description: "D", tags: ["x"], privacyStatus: "private", fetch });
    expect(out).toEqual({ videoId: "vid1", url: "https://www.youtube.com/watch?v=vid1" });
    expect(calls[0]!.url).toContain("uploadType=resumable&part=snippet,status");
    expect((calls[0]!.init.headers as Record<string, string>)["X-Upload-Content-Length"]).toBe("12");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ snippet: { title: "T", description: "D", tags: ["x"], categoryId: "27" }, status: { privacyStatus: "private", selfDeclaredMadeForKids: false } });
    expect(calls[1]!.url).toBe("https://upload.example/session");
    expect(calls[1]!.init.method).toBe("PUT");
    expect((calls[1]!.init.body as Uint8Array).byteLength).toBe(12);
  });

  it("upload failures: session error, missing Location, PUT error, missing id", async () => {
    const file = tmpFile("v.mp4", 3);
    const base = { accessToken: "A", filePath: file, title: "T", description: "D", privacyStatus: "unlisted" as const };
    await expect(uploadVideo({ ...base, fetch: fakeFetch([json({ error: { message: "nope" } }, 403)]).fetch })).rejects.toThrow("Upload session failed (HTTP 403): nope");
    await expect(uploadVideo({ ...base, fetch: fakeFetch([new Response(null, { status: 200 })]).fetch })).rejects.toThrow("no Location header");
    await expect(uploadVideo({ ...base, fetch: fakeFetch([new Response(null, { status: 200, headers: { location: "u" } }), json({ error: { message: "big" } }, 413)]).fetch })).rejects.toThrow("Video upload failed (HTTP 413): big");
    await expect(uploadVideo({ ...base, fetch: fakeFetch([new Response(null, { status: 200, headers: { location: "u" } }), json({})]).fetch })).rejects.toThrow("no video id");
  });

  it("thumbnail: posts the image bytes with the right type; errors are typed", async () => {
    const jpg = tmpFile("t.jpg", 5);
    const png = tmpFile("t.PNG", 4);
    const { fetch, calls } = fakeFetch([json({}), json({}), json({ error: { message: "phone not verified", errors: [{ reason: "forbidden" }] } }, 403)]);
    await setThumbnail({ accessToken: "A", videoId: "v 1", filePath: jpg, fetch });
    await setThumbnail({ accessToken: "A", videoId: "v2", filePath: png, fetch });
    expect(calls[0]!.url).toBe("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=v%201");
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
    expect((calls[1]!.init.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
    await expect(setThumbnail({ accessToken: "A", videoId: "v3", filePath: jpg, fetch })).rejects.toThrow("Thumbnail upload failed (HTTP 403): phone not verified");
  });
});
