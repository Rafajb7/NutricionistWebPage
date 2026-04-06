import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  listDailyTrackerEntriesForUser,
  upsertDailyTrackerEntry,
  type DailyTrackerMetric
} from "@/lib/google/achievements";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";

const TRACKER_METRICS = ["steps", "weight"] as const;
const trackerMetricSchema = z.enum(TRACKER_METRICS);
const MAX_STEPS_VALUE = 100_000;
const MIN_WEIGHT_VALUE = 20;
const MAX_WEIGHT_VALUE = 300;
const DAILY_TRACKER_CACHE_TTL_MS = 45_000;

const createEntrySchema = z.object({
  metric: trackerMetricSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.coerce.number()
});

function getDailyTrackerCacheKey(username: string): string {
  return `daily-tracker:${username.trim().toLowerCase()}`;
}

function validateTrackerValue(metric: DailyTrackerMetric, value: number): string | null {
  if (!Number.isFinite(value)) {
    return "Introduce un valor valido.";
  }

  if (metric === "steps") {
    if (!Number.isInteger(value) || value < 0 || value > MAX_STEPS_VALUE) {
      return "Los pasos deben estar entre 0 y 100000 y ser un numero entero.";
    }
    return null;
  }

  if (value < MIN_WEIGHT_VALUE || value > MAX_WEIGHT_VALUE) {
    return `El peso debe estar entre ${MIN_WEIGHT_VALUE} y ${MAX_WEIGHT_VALUE} kg.`;
  }

  return null;
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const cacheKey = getDailyTrackerCacheKey(auth.session.username);
    const entries = await getOrSetMemoryCache(
      cacheKey,
      DAILY_TRACKER_CACHE_TTL_MS,
      async () => listDailyTrackerEntriesForUser(auth.session.username)
    );

    return NextResponse.json({
      metrics: TRACKER_METRICS,
      entries
    });
  } catch (error) {
    logError("Failed to load daily tracker entries", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load tracker entries." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = createEntrySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const validationError = validateTrackerValue(parsed.data.metric, parsed.data.value);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    await upsertDailyTrackerEntry({
      name: auth.session.name,
      username: auth.session.username,
      metric: parsed.data.metric,
      date: parsed.data.date,
      value: parsed.data.value
    });

    deleteMemoryCache(getDailyTrackerCacheKey(auth.session.username));
    logInfo("Daily tracker entry upserted", {
      username: auth.session.username,
      metric: parsed.data.metric,
      date: parsed.data.date,
      value: parsed.data.value
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to upsert daily tracker entry", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not save tracker entry." }, { status: 500 });
  }
}
