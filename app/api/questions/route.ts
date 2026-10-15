import { NextResponse } from "next/server";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireSession } from "@/lib/auth/require-session";
import { readQuestionsFromSheet, readUsersFromSheetCached } from "@/lib/google/sheets";
import { buildRevisionQuestions } from "@/lib/revision-questions";
import { logError } from "@/lib/logger";

const QUESTIONS_CACHE_TTL_MS = 5 * 60_000;

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const [sheetQuestions, users] = await Promise.all([
      getOrSetMemoryCache("google:revision-question-definitions", QUESTIONS_CACHE_TTL_MS, readQuestionsFromSheet),
      readUsersFromSheetCached()
    ]);
    const username = auth.session.username.trim().replace(/^@/, "").toLowerCase();
    const user = users.find(
      (item) => item.username.trim().replace(/^@/, "").toLowerCase() === username
    );
    // Only the Sheet rows are shared in cache; visibility is resolved per user.
    const questions = buildRevisionQuestions(sheetQuestions, user?.sex ?? "");
    return NextResponse.json({ questions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logError("Failed to load questions", error);
    return NextResponse.json({ error: "Could not load questions." }, { status: 500 });
  }
}
