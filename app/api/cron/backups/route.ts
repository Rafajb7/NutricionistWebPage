import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runWeeklySheetBackup } from "@/lib/google/backups";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(req: Request): boolean {
  const env = getEnv();
  const expectedSecret = env.CRON_SECRET?.trim();
  if (!expectedSecret && process.env.NODE_ENV !== "production") return true;
  if (!expectedSecret) return false;
  return req.headers.get("authorization") === `Bearer ${expectedSecret}`;
}

export async function GET(req: Request) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await runWeeklySheetBackup();
    logInfo("Weekly Google Sheets backup completed", {
      date: summary.date,
      folderId: summary.folderId,
      copied: summary.results.filter((result) => result.status === "copied").length,
      skipped: summary.results.filter((result) => result.status === "skipped").length,
      failed: summary.results.filter((result) => result.status === "failed").length
    });
    return NextResponse.json({ ok: true, backup: summary });
  } catch (error) {
    logError("Weekly Google Sheets backup failed", { error });
    return NextResponse.json({ error: "Could not create weekly backup." }, { status: 500 });
  }
}
