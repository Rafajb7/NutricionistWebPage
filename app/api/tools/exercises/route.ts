import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { readRoutineExerciseCatalog } from "@/lib/google/sheets";
import { getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError } from "@/lib/logger";
import { EXERCISE_CATALOG_SOURCES } from "@/lib/routines/default-exercises";

const EXERCISE_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const groups = await getOrSetMemoryCache(
      "routine-exercises:catalog",
      EXERCISE_CATALOG_CACHE_TTL_MS,
      () => readRoutineExerciseCatalog()
    );
    const totalExercises = groups.reduce((acc, group) => acc + group.exercises.length, 0);

    return NextResponse.json({
      groups,
      totalExercises,
      sources: EXERCISE_CATALOG_SOURCES
    });
  } catch (error) {
    logError("Failed to load routine exercise catalog", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load exercise catalog." }, { status: 500 });
  }
}
