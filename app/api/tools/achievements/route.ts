import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { STRENGTH_EXERCISES } from "@/lib/achievements/strength-exercises";
import {
  appendStrengthMark,
  listStrengthGoalsForUser,
  listStrengthMarksForUser,
  upsertStrengthGoal
} from "@/lib/google/achievements";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";

const strengthExerciseSchema = z.enum(STRENGTH_EXERCISES);

const createMarkSchema = z.object({
  exercise: strengthExerciseSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.coerce.number().min(1).max(800)
});

const upsertGoalSchema = z.object({
  exercise: strengthExerciseSchema,
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetWeightKg: z.coerce.number().min(1).max(800)
});

const ACHIEVEMENTS_CACHE_TTL_MS = 45_000;

function getAchievementsCacheKey(username: string): string {
  return `strength-achievements:${username.trim().toLowerCase()}`;
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const cacheKey = getAchievementsCacheKey(auth.session.username);
    const data = await getOrSetMemoryCache(
      cacheKey,
      ACHIEVEMENTS_CACHE_TTL_MS,
      async () => {
        const [marks, goals] = await Promise.all([
          listStrengthMarksForUser(auth.session.username),
          listStrengthGoalsForUser(auth.session.username)
        ]);
        return { marks, goals };
      }
    );

    return NextResponse.json({
      exercises: STRENGTH_EXERCISES,
      marks: data.marks,
      goals: data.goals
    });
  } catch (error) {
    logError("Failed to load strength achievements", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load achievements." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = createMarkSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    await appendStrengthMark({
      name: auth.session.name,
      username: auth.session.username,
      exercise: parsed.data.exercise,
      date: parsed.data.date,
      weightKg: parsed.data.weightKg
    });

    deleteMemoryCache(getAchievementsCacheKey(auth.session.username));
    logInfo("Strength max mark stored", {
      username: auth.session.username,
      exercise: parsed.data.exercise,
      date: parsed.data.date,
      weightKg: parsed.data.weightKg
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to store strength max mark", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not save mark." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = upsertGoalSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    await upsertStrengthGoal({
      name: auth.session.name,
      username: auth.session.username,
      exercise: parsed.data.exercise,
      targetDate: parsed.data.targetDate,
      targetWeightKg: parsed.data.targetWeightKg
    });

    deleteMemoryCache(getAchievementsCacheKey(auth.session.username));
    logInfo("Strength goal upserted", {
      username: auth.session.username,
      exercise: parsed.data.exercise,
      targetDate: parsed.data.targetDate,
      targetWeightKg: parsed.data.targetWeightKg
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to upsert strength goal", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
  }
}
