import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { listNutritionPlanPdfsForUser } from "@/lib/google/drive";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError } from "@/lib/logger";

const NUTRITION_PLAN_CACHE_TTL_MS = 60_000;

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const cacheKey = `nutrition-plans:${auth.session.username.trim().toLowerCase()}`;
    const plans = await getOrSetMemoryCache(cacheKey, NUTRITION_PLAN_CACHE_TTL_MS, () =>
      listNutritionPlanPdfsForUser(auth.session.username)
    );
    return NextResponse.json({ plans });
  } catch (error) {
    logError("Failed to list nutrition plans", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not load nutrition plans." }, { status: 500 });
  }
}
