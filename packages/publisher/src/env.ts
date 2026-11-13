export interface YouTubeEnv {
  clientId: string;
  clientSecret: string;
  /** Missing until `ys youtube auth` has been run once. */
  refreshToken: string | undefined;
  redirectUri: string;
}

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:8977/callback";

/**
 * OAuth client settings from the environment. The client id and secret come from a Google Cloud "Desktop app" OAuth
 * client; the refresh token is printed by `ys youtube auth` and pasted into `.env` by hand (the CLI never writes it).
 */
export function youtubeEnv(env: Record<string, string | undefined> = process.env): YouTubeEnv {
  const clientId = env.YT_CLIENT_ID?.trim();
  const clientSecret = env.YT_CLIENT_SECRET?.trim();
  const missing = [!clientId && "YT_CLIENT_ID", !clientSecret && "YT_CLIENT_SECRET"].filter((v): v is string => Boolean(v));
  if (missing.length) throw new Error(`Missing ${missing.join(" and ")} in .env (see docs/YOUTUBE_PUBLISHING.md)`);
  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    refreshToken: env.YT_REFRESH_TOKEN?.trim() || undefined,
    redirectUri: env.YT_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI,
  };
}
