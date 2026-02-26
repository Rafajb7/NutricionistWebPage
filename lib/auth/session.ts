import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/jwt";

export { SESSION_COOKIE_NAME } from "@/lib/auth/jwt";
export type { SessionPayload, SessionUser } from "@/lib/auth/jwt";
export { createSessionToken, verifySessionToken } from "@/lib/auth/jwt";

export async function getSessionFromCookies() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;
  return verifySessionToken(session);
}
