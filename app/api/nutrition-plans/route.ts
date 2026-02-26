import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listNutritionPlanPdfsForUser } from "@/lib/google/drive";
import { logError } from "@/lib/logger";

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const plans = await listNutritionPlanPdfsForUser(auth.session.username);
    return NextResponse.json({ plans });
  } catch (error) {
    logError("Failed to list nutrition plans", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not load nutrition plans." }, { status: 500 });
  }
}
