import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getPasswordVersion, verifyPasswordResetToken } from "@/lib/auth/password-reset-token";
import { hashPassword } from "@/lib/auth/password";
import { readUsersFromSheet, updateUserPasswordCell } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

const resetSchema = z.object({
  token: z.string().min(20).max(3000),
  password: z.string().min(8).max(200),
  confirmPassword: z.string().min(8).max(200)
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = resetSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    if (parsed.data.password !== parsed.data.confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const tokenPayload = await verifyPasswordResetToken(parsed.data.token);
    if (!tokenPayload) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 400 });
    }

    const users = await readUsersFromSheet();
    const user = users.find(
      (item) => normalizeUsername(item.username) === normalizeUsername(tokenPayload.username)
    );
    if (!user) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 400 });
    }

    const currentVersion = getPasswordVersion(user.password);
    if (currentVersion !== tokenPayload.passwordVersion) {
      return NextResponse.json({ error: "Invalid or expired token." }, { status: 400 });
    }

    const hashed = await hashPassword(parsed.data.password);
    await updateUserPasswordCell(user.rowNumber, user.passwordColumn, hashed);

    logInfo("Password reset completed", { username: user.username });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to reset password", error);
    return NextResponse.json({ error: "Could not reset password." }, { status: 500 });
  }
}

