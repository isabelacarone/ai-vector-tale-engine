import { readFile, stat } from "node:fs/promises";
import { apiError, YouTubeApiError } from "./errors.ts";
import type { FetchFn } from "./oauth.ts";

export type PrivacyStatus = "private" | "unlisted" | "public";

const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const THUMBNAIL_URL = "https://www.googleapis.com/upload/youtube/v3/thumbnails/set";

/** YouTube limits: title 100 characters, description 5000, tags 500 characters in total. */
export const YOUTUBE_LIMITS = { title: 100, description: 5000, tagsTotal: 500 } as const;

export interface UploadVideoInput {
  accessToken: string;
  filePath: string;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus: PrivacyStatus;
  /** Always false for this channel; YouTube requires the declaration on every upload. */
  madeForKids?: boolean;
  /** YouTube category id; 27 is Education, 24 Entertainment. Default 27. */
  categoryId?: string;
  /** Default language of the title and description (BCP-47). */
  language?: string;
  fetch?: FetchFn;
}

export interface UploadedVideo {
  videoId: string;
  url: string;
}

/** Cuts the metadata to YouTube's limits so an over-long package never fails the upload. */
export function videoSnippet(o: Pick<UploadVideoInput, "title" | "description" | "tags" | "categoryId" | "language">) {
  const tags: string[] = [];
  let total = 0;
  for (const raw of o.tags ?? []) {
    const tag = raw.trim();
    if (!tag) continue;
    if (total + tag.length > YOUTUBE_LIMITS.tagsTotal) break;
    tags.push(tag);
    total += tag.length;
  }
  return {
    title: o.title.trim().slice(0, YOUTUBE_LIMITS.title) || "Untitled",
    description: o.description.trim().slice(0, YOUTUBE_LIMITS.description),
    tags,
    categoryId: o.categoryId ?? "27",
    ...(o.language ? { defaultLanguage: o.language, defaultAudioLanguage: o.language } : {}),
  };
}

/**
 * Resumable upload in two requests: the metadata POST returns a session URL in `Location`, the video bytes go there in
 * one PUT. Google accepts a single-request body for files of this size; chunking is only needed for flaky links.
 */
export async function uploadVideo(o: UploadVideoInput): Promise<UploadedVideo> {
  const fetchFn = o.fetch ?? globalThis.fetch;
  const { size } = await stat(o.filePath);
  const init = await fetchFn(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${o.accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      snippet: videoSnippet(o),
      status: { privacyStatus: o.privacyStatus, selfDeclaredMadeForKids: o.madeForKids ?? false },
    }),
  });
  if (!init.ok) throw await apiError(init, "Upload session");
  const location = init.headers.get("location");
  if (!location) throw new YouTubeApiError(init.status, "Upload session returned no Location header");
  const bytes = await readFile(o.filePath);
  const put = await fetchFn(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw await apiError(put, "Video upload");
  const body = (await put.json()) as { id?: string };
  if (!body.id) throw new YouTubeApiError(put.status, "Video upload returned no video id");
  return { videoId: body.id, url: `https://www.youtube.com/watch?v=${body.id}` };
}

/** Custom thumbnail (JPEG/PNG, at most 2 MB); needs a verified phone number on the channel. */
export async function setThumbnail(o: { accessToken: string; videoId: string; filePath: string; fetch?: FetchFn }): Promise<void> {
  const fetchFn = o.fetch ?? globalThis.fetch;
  const bytes = await readFile(o.filePath);
  const res = await fetchFn(`${THUMBNAIL_URL}?videoId=${encodeURIComponent(o.videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${o.accessToken}`, "Content-Type": o.filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg" },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw await apiError(res, "Thumbnail upload");
}
