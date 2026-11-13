/**
 * YouTube Data API error: HTTP status plus the API's own `error.message` and first `reason` code, so callers can tell a
 * quota exhaustion (403 quotaExceeded) from an expired token (401) or a rejected upload (400).
 */
export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string | undefined;

  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.status = status;
    this.reason = reason;
  }
}

interface GoogleErrorBody {
  error?: { message?: string; errors?: { reason?: string; message?: string }[]; status?: string } | string;
  error_description?: string;
}

export const QUOTA_MESSAGE =
  "YouTube Data API daily quota exceeded: a project has 10,000 units per day and one upload costs 1,600 (about six uploads). The quota resets at midnight Pacific time.";

/** Builds the typed error from a failed response; the body is read as JSON when possible, otherwise as text. */
export async function apiError(res: Response, what: string): Promise<YouTubeApiError> {
  const text = await res.text().catch(() => "");
  let body: GoogleErrorBody = {};
  try {
    body = JSON.parse(text) as GoogleErrorBody;
  } catch {
    body = {};
  }
  const err = body.error;
  const reason = typeof err === "object" ? err?.errors?.[0]?.reason : undefined;
  const detail =
    (typeof err === "object" ? err?.message : undefined) ?? body.error_description ?? (typeof err === "string" ? err : undefined) ?? text.slice(0, 300);
  if (res.status === 403 && (reason === "quotaExceeded" || reason === "dailyLimitExceeded")) return new YouTubeApiError(res.status, QUOTA_MESSAGE, reason);
  return new YouTubeApiError(res.status, `${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`, reason);
}
