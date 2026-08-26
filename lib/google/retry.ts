const RETRY_DELAYS_MS = [250, 750, 1500];

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  const record = toRecord(value);
  return record ? toRecord(record[key]) : null;
}

function getErrorStatus(error: unknown): number | null {
  const record = toRecord(error);
  const directStatus = record?.status ?? record?.code;
  if (typeof directStatus === "number") return directStatus;
  if (typeof directStatus === "string" && /^\d+$/.test(directStatus)) return Number(directStatus);

  const response = getNestedRecord(error, "response");
  const responseStatus = response?.status;
  if (typeof responseStatus === "number") return responseStatus;
  if (typeof responseStatus === "string" && /^\d+$/.test(responseStatus)) {
    return Number(responseStatus);
  }

  return null;
}

function getErrorText(error: unknown): string {
  const record = toRecord(error);
  const response = getNestedRecord(error, "response");
  const data = response?.data;
  const parts = [
    error instanceof Error ? error.message : "",
    typeof record?.message === "string" ? record.message : "",
    typeof data === "string" ? data : "",
    typeof toRecord(data)?.error === "string" ? String(toRecord(data)?.error) : ""
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
}

function isRetriableGoogleApiError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return false;
  if (status && [408, 500, 502, 503, 504].includes(status)) return true;

  const text = getErrorText(error);
  return [
    "backenderror",
    "internal error",
    "rate limit",
    "ratelimitexceeded",
    "userratelimitexceeded",
    "quota exceeded",
    "socket hang up",
    "econnreset",
    "etimedout",
    "timeout"
  ].some((pattern) => text.includes(pattern));
}

export function isGoogleRateLimitError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429) return true;

  const text = getErrorText(error);
  return ["rate limit", "ratelimitexceeded", "userratelimitexceeded", "quota exceeded"].some(
    (pattern) => text.includes(pattern)
  );
}

export function isGoogleAlreadyExistsError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status !== 400 && status !== 409) return false;

  const text = getErrorText(error);
  return text.includes("already exists") || text.includes("ya existe");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withGoogleApiRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_DELAYS_MS.length || !isRetriableGoogleApiError(error)) {
        throw error;
      }
      await delay(RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}
