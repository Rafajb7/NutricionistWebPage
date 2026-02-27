type CookieRequestLike = {
  url: string;
  headers: Headers;
};

export function shouldUseSecureCookie(req: CookieRequestLike): boolean {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return true;
  try {
    const url = new URL(req.url);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

