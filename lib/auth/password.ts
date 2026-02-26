import bcrypt from "bcryptjs";

const BCRYPT_PREFIXES = ["$2a$", "$2b$", "$2y$"];

export function isBcryptHash(value: string): boolean {
  return BCRYPT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(options: {
  candidate: string;
  stored: string;
  allowPlaintextFallback: boolean;
}): Promise<boolean> {
  const { candidate, stored, allowPlaintextFallback } = options;

  if (isBcryptHash(stored)) {
    return bcrypt.compare(candidate, stored);
  }

  if (!allowPlaintextFallback) {
    return false;
  }

  return candidate === stored;
}
