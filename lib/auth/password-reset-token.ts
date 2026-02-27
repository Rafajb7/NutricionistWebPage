import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";

type PasswordResetTokenPayload = {
  username: string;
  passwordVersion: string;
  iat?: number;
  exp?: number;
};

function getResetSecret(): Uint8Array {
  const env = getEnv();
  return new TextEncoder().encode(`${env.SESSION_SECRET}:password-reset`);
}

export function getPasswordVersion(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export async function createPasswordResetToken(input: {
  username: string;
  passwordVersion: string;
}): Promise<string> {
  const env = getEnv();
  const expiresInSeconds = env.PASSWORD_RESET_TTL_MINUTES * 60;

  return new SignJWT({
    username: input.username,
    passwordVersion: input.passwordVersion
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .sign(getResetSecret());
}

export async function verifyPasswordResetToken(
  token: string
): Promise<PasswordResetTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getResetSecret());
    if (
      typeof payload.username !== "string" ||
      typeof payload.passwordVersion !== "string"
    ) {
      return null;
    }

    return {
      username: payload.username,
      passwordVersion: payload.passwordVersion,
      iat: payload.iat,
      exp: payload.exp
    };
  } catch {
    return null;
  }
}

