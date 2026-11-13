import { apiError } from "./errors.ts";

export type FetchFn = typeof globalThis.fetch;

/** Upload needs `youtube.upload`; setting a thumbnail needs `youtube.force-ssl`. */
export const YOUTUBE_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Consent URL: offline access with a forced prompt so Google returns a refresh token even on repeat sign-ins. */
export function youtubeAuthUrl(o: { clientId: string; redirectUri: string; scopes?: readonly string[] }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: (o.scopes ?? YOUTUBE_SCOPES).join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${q}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | undefined;
  /** Seconds until the access token expires (usually 3600). */
  expiresIn: number;
}

interface TokenBody {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

async function tokenRequest(fetchFn: FetchFn, form: Record<string, string>, what: string): Promise<TokenResponse> {
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) throw await apiError(res, what);
  const body = (await res.json()) as TokenBody;
  if (!body.access_token) throw new Error(`${what} returned no access_token`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresIn: body.expires_in ?? 3600 };
}

/** Authorization code (from the loopback redirect) → access + refresh token. */
export function exchangeCode(o: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetch?: FetchFn }): Promise<TokenResponse> {
  return tokenRequest(
    o.fetch ?? globalThis.fetch,
    { client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri, grant_type: "authorization_code" },
    "OAuth code exchange",
  );
}

/** Refresh token → short-lived access token (the refresh token itself is not rotated by Google). */
export function refreshAccessToken(o: { clientId: string; clientSecret: string; refreshToken: string; fetch?: FetchFn }): Promise<TokenResponse> {
  return tokenRequest(
    o.fetch ?? globalThis.fetch,
    { client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken, grant_type: "refresh_token" },
    "OAuth token refresh",
  );
}
