import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { hashPassword, isBcryptHash } from "@/lib/auth/password";
import { readUsersFromSheet, updateUserPasswordCell } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-admin-token");
    const expected = getEnv().ADMIN_MIGRATION_TOKEN;
    if (!expected || token !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const users = await readUsersFromSheet();
    let migrated = 0;

    for (const user of users) {
      if (!user.password || isBcryptHash(user.password)) continue;
      const hash = await hashPassword(user.password);
      await updateUserPasswordCell(user.rowNumber, user.passwordColumn, hash);
      migrated += 1;
    }

    logInfo("Password migration completed", { migrated });
    return NextResponse.json({ ok: true, migrated });
  } catch (error) {
    logError("Password migration failed", error);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
