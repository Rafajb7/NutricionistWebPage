import { NextResponse } from "next/server";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireSession } from "@/lib/auth/require-session";
import { readQuestionsFromSheet } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

const QUESTIONS_CACHE_TTL_MS = 5 * 60_000;

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const questions = await getOrSetMemoryCache(
      "google:revision-questions",
      QUESTIONS_CACHE_TTL_MS,
      readQuestionsFromSheet
    );
    return NextResponse.json({ questions });
  } catch (error) {
    logError("Failed to load questions", error);
    return NextResponse.json({ error: "Could not load questions." }, { status: 500 });
  }
}
