import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

export const SESSION_COOKIE_NAME = "mat_session";

export type SessionUser = {
  username: string;
  name: string;
  mustChangePassword?: boolean;
};

export type SessionPayload = SessionUser & {
  iat?: number;
  exp?: number;
};

function getJwtSecret(): Uint8Array {
  const env = getEnv();
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  const env = getEnv();
  const expiresInSeconds = env.SESSION_TTL_HOURS * 60 * 60;

  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    if (
      typeof payload.username !== "string" ||
      typeof payload.name !== "string" ||
      (payload.mustChangePassword !== undefined &&
        typeof payload.mustChangePassword !== "boolean")
    ) {
      return null;
    }
    return {
      username: payload.username,
      name: payload.name,
      mustChangePassword: payload.mustChangePassword as boolean | undefined,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}
