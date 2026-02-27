import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { shouldUseSecureCookie } from "@/lib/auth/cookie";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { readUsersFromSheet, updateUserPasswordCell } from "@/lib/google/sheets";
import { getEnv } from "@/lib/env";
import { logError, logInfo } from "@/lib/logger";

const changePasswordSchema = z.object({
  password: z.string().min(8).max(200),
  confirmPassword: z.string().min(8).max(200)
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  const auth = await requireSession({ allowPasswordChangePending: true });
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = changePasswordSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    if (parsed.data.password !== parsed.data.confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const users = await readUsersFromSheet();
    const user = users.find(
      (item) => normalizeUsername(item.username) === normalizeUsername(auth.session.username)
    );
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const hashed = await hashPassword(parsed.data.password);
    await updateUserPasswordCell(user.rowNumber, user.passwordColumn, hashed);

    const refreshedToken = await createSessionToken({
      username: user.username.trim().replace(/^@/, ""),
      name: user.name,
      mustChangePassword: false
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: refreshedToken,
      httpOnly: true,
      secure: shouldUseSecureCookie(req),
      sameSite: "lax",
      path: "/",
      maxAge: getEnv().SESSION_TTL_HOURS * 60 * 60
    });

    logInfo("Password changed on first login", { username: user.username });
    return response;
  } catch (error) {
    logError("Failed to change password", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not change password." }, { status: 500 });
  }
}

