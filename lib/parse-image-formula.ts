const URL_REGEX = /(https?:\/\/[^\s"'();]+)/i;
const DOUBLE_QUOTE_URL_REGEX = /"((?:https?:\/\/)[^"]+)"/i;

export function extractImageUrl(value: string | undefined | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const quoted = trimmed.match(DOUBLE_QUOTE_URL_REGEX);
  if (quoted?.[1]) return toDisplayUrl(sanitizeUrl(quoted[1]));

  const direct = trimmed.match(URL_REGEX);
  if (direct?.[1]) return toDisplayUrl(sanitizeUrl(direct[1]));

  return null;
}

function sanitizeUrl(url: string): string {
  return url.replace(/[)"';]+$/, "");
}

function toDisplayUrl(url: string): string {
  const driveFileId = extractDriveFileId(url);
  if (!driveFileId) return url;
  return `/api/photos/view/${driveFileId}`;
}

function extractDriveFileId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const idFromQuery = parsed.searchParams.get("id");
    if (idFromQuery && isDriveId(idFromQuery)) {
      return idFromQuery;
    }

    const filePathMatch = parsed.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    if (filePathMatch?.[1] && isDriveId(filePathMatch[1])) {
      return filePathMatch[1];
    }

    const userContentMatch = parsed.pathname.match(/\/d\/([A-Za-z0-9_-]+)/);
    if (userContentMatch?.[1] && isDriveId(userContentMatch[1])) {
      return userContentMatch[1];
    }

    return null;
  } catch {
    return null;
  }
}

function isDriveId(value: string): boolean {
  return /^[A-Za-z0-9_-]{10,}$/.test(value);
}
