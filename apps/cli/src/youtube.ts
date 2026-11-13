import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import type { EpisodePipeline, EpisodeState, PublishRecord } from "@ys/pipeline";
import { exchangeCode, refreshAccessToken, setThumbnail, uploadVideo, youtubeAuthUrl, youtubeEnv, type FetchFn, type PrivacyStatus } from "@ys/publisher";

export interface YouTubeDeps {
  print: (line: string) => void;
  env?: Record<string, string | undefined>;
  fetch?: FetchFn;
  /** Called with the real callback URL once the loopback server listens (tests use a random port). */
  onListening?: (callbackUrl: string) => void;
}

/**
 * `ys youtube auth`: prints the consent URL, waits for Google's redirect on the loopback address, exchanges the code and
 * prints the refresh token. The token is never written to .env by the CLI: the user pastes it.
 */
export async function youtubeAuthCommand(deps: YouTubeDeps): Promise<void> {
  const env = youtubeEnv(deps.env);
  const redirect = new URL(env.redirectUri);
  const code = await new Promise<string>((resolveCode, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", redirect.origin);
      if (url.pathname !== redirect.pathname) {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const got = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end(got ? "Signed in. You can close this tab and return to the terminal." : `Sign-in failed: ${err ?? "no code"}`);
      server.close();
      if (got) resolveCode(got);
      else reject(new Error(`Google returned no code${err ? ` (${err})` : ""}`));
    });
    server.on("error", reject);
    server.listen(Number(redirect.port) || 80, redirect.hostname, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : redirect.port;
      const callback = `${redirect.protocol}//${redirect.hostname}:${port}${redirect.pathname}`;
      deps.print(`Open this URL in the browser signed in to the channel's Google account:\n${youtubeAuthUrl({ clientId: env.clientId, redirectUri: callback })}\n\nWaiting for Google to redirect to ${callback} ...`);
      deps.onListening?.(callback);
    });
  });
  const tokens = await exchangeCode({ clientId: env.clientId, clientSecret: env.clientSecret, code, redirectUri: env.redirectUri, fetch: deps.fetch });
  if (!tokens.refreshToken) throw new Error("Google returned no refresh token; remove the app's access at myaccount.google.com/permissions and run `ys youtube auth` again.");
  deps.print(`\nAdd this line to .env (keep it secret):\nYT_REFRESH_TOKEN=${tokens.refreshToken}`);
}

export interface PublishOptions {
  short?: boolean;
  /** Which Short (1-based) when `short` is set. */
  n?: number;
  privacy?: string;
}

export interface PublishTarget {
  kind: "main" | "short";
  index?: number;
  path: string;
  title: string;
  description: string;
  tags: string[];
  thumbnail?: string;
}

const PRIVACY: readonly PrivacyStatus[] = ["private", "unlisted", "public"];

export function parsePrivacy(v: string | undefined): PrivacyStatus {
  if (v === undefined) return "private";
  if ((PRIVACY as readonly string[]).includes(v)) return v as PrivacyStatus;
  throw new Error(`--privacy must be one of ${PRIVACY.join("|")}`);
}

/** What gets uploaded: the main video with the package texts and thumbnail, or Short n with its own title and #Shorts. */
export function publishTarget(state: EpisodeState, workDir: string, o: PublishOptions): PublishTarget {
  const pkg = state.package;
  const description = pkg?.description ?? "";
  const tags = pkg?.tags ?? [];
  if (o.short) {
    const list = state.shorts?.length ? state.shorts : state.short ? [state.short] : [];
    const n = o.n ?? 1;
    const short = list[n - 1];
    if (!short) throw new Error(list.length ? `Short ${n} does not exist (the episode has ${list.length})` : "The episode has no Short yet (run the short stage first)");
    return { kind: "short", index: n, path: short.path, title: short.title, description: `${description}\n\n#Shorts`.trim(), tags };
  }
  if (!state.render) throw new Error("The episode has no rendered video yet");
  const jpg = state.render.thumbnail ?? join(resolve(workDir, state.id), `${state.id}.jpg`);
  return { kind: "main", path: state.render.path, title: pkg?.title ?? state.input.topic, description, tags, ...(existsSync(jpg) ? { thumbnail: jpg } : {}) };
}

export interface PublishDeps extends YouTubeDeps {
  pipeline: Pick<EpisodePipeline, "load" | "save">;
  workDir: string;
}

/** `ys episode publish <id> [--short [--n 2]] [--privacy private|unlisted|public]`. */
export async function publishCommand(deps: PublishDeps, id: string | undefined, o: PublishOptions): Promise<PublishRecord> {
  if (!id) throw new Error("episode id required");
  const privacy = parsePrivacy(o.privacy);
  const env = youtubeEnv(deps.env);
  if (!env.refreshToken) throw new Error("YT_REFRESH_TOKEN is missing: run `pnpm ys youtube auth` and paste the token into .env");
  const state = await deps.pipeline.load(id);
  const target = publishTarget(state, deps.workDir, o);
  if (!existsSync(target.path)) throw new Error(`Video file not found: ${target.path}`);
  const { accessToken } = await refreshAccessToken({ clientId: env.clientId, clientSecret: env.clientSecret, refreshToken: env.refreshToken, fetch: deps.fetch });
  deps.print(`Uploading ${target.kind === "main" ? "main video" : `Short ${target.index}`} as ${privacy}: ${target.title}`);
  const up = await uploadVideo({ accessToken, filePath: target.path, title: target.title, description: target.description, tags: target.tags, privacyStatus: privacy, language: state.input.lang, fetch: deps.fetch });
  const record: PublishRecord = { videoId: up.videoId, url: up.url, privacy, at: new Date().toISOString(), ...(target.index ? { index: target.index } : {}) };
  if (target.thumbnail) {
    try {
      await setThumbnail({ accessToken, videoId: up.videoId, filePath: target.thumbnail, fetch: deps.fetch });
    } catch (e) {
      record.thumbnailError = e instanceof Error ? e.message : String(e);
      deps.print(`Thumbnail not set (video uploaded): ${record.thumbnailError}`);
    }
  }
  const fresh = await deps.pipeline.load(id);
  fresh.publish ??= {};
  if (target.kind === "main") fresh.publish.main = record;
  else fresh.publish.shorts = [...(fresh.publish.shorts ?? []).filter((r) => r.index !== record.index), record].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  await deps.pipeline.save(fresh);
  deps.print(`Uploaded: ${record.url} (${privacy}${privacy !== "private" ? "; an unverified OAuth app keeps it private until you change it in YouTube Studio" : ""})`);
  return record;
}
