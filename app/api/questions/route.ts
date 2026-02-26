import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { readQuestionsFromSheet } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const questions = await readQuestionsFromSheet();
    return NextResponse.json({ questions });
  } catch (error) {
    logError("Failed to load questions", error);
    return NextResponse.json({ error: "Could not load questions." }, { status: 500 });
  }
}
