import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  appendRoutineLogs,
  deleteRoutineSessionForUser,
  listRoutineLogsForUser,
  replaceRoutineSessionForUser
} from "@/lib/google/sheets";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { logError, logInfo } from "@/lib/logger";

const routineEntrySchema = z.object({
  muscleGroup: z.string().min(1).max(120),
  exercise: z.string().min(1).max(240),
  reps: z.coerce.number().int().min(1).max(300),
  weightKg: z.coerce.number().min(0).max(1500).nullable().optional(),
  notes: z.string().max(500).optional()
});

const routineDaySchema = z.object({
  label: z.string().min(1).max(120),
  entries: z.array(routineEntrySchema).min(1)
});

const createRoutineLogSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.array(routineDaySchema).min(1)
});

const routineSessionTargetSchema = z.object({
  timestamp: z.string().min(1).max(80),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day: z.string().min(1).max(120)
});

const updateRoutineLogSchema = z.object({
  target: routineSessionTargetSchema,
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayLabel: z.string().min(1).max(120),
  entries: z.array(routineEntrySchema).min(1)
});

const deleteRoutineLogSchema = z.object({
  target: routineSessionTargetSchema
});

const ROUTINE_LOG_CACHE_TTL_MS = 45_000;

function getRoutineLogsCacheKey(username: string): string {
  return `routine-logs:${username.trim().toLowerCase()}`;
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const cacheKey = getRoutineLogsCacheKey(auth.session.username);
    const logs = await getOrSetMemoryCache(cacheKey, ROUTINE_LOG_CACHE_TTL_MS, () =>
      listRoutineLogsForUser(auth.session.username)
    );
    return NextResponse.json({ logs });
  } catch (error) {
    logError("Failed to read routine logs", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load routine history." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = createRoutineLogSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const rows = parsed.data.days.flatMap((day) =>
      day.entries.map((entry) => ({
        timestamp,
        nombre: auth.session.name,
        usuario: auth.session.username,
        fechaSesion: parsed.data.sessionDate,
        dia: day.label.trim(),
        grupoMuscular: entry.muscleGroup.trim(),
        ejercicio: entry.exercise.trim(),
        repeticiones: entry.reps,
        pesoKg: entry.weightKg ?? null,
        notas: entry.notes?.trim() ?? ""
      }))
    );

    await appendRoutineLogs(rows);
    deleteMemoryCache(getRoutineLogsCacheKey(auth.session.username));
    logInfo("Routine session stored", {
      username: auth.session.username,
      date: parsed.data.sessionDate,
      count: rows.length
    });

    return NextResponse.json({ ok: true, count: rows.length });
  } catch (error) {
    logError("Failed to store routine session", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not save routine log." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = updateRoutineLogSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const updatedCount = await replaceRoutineSessionForUser({
      username: auth.session.username,
      name: auth.session.name,
      target: parsed.data.target,
      nextSessionDate: parsed.data.sessionDate,
      nextDayLabel: parsed.data.dayLabel.trim(),
      entries: parsed.data.entries.map((entry) => ({
        muscleGroup: entry.muscleGroup.trim(),
        exercise: entry.exercise.trim(),
        reps: entry.reps,
        weightKg: entry.weightKg ?? null,
        notes: entry.notes?.trim() ?? ""
      }))
    });

    if (!updatedCount) {
      return NextResponse.json({ error: "Routine session not found." }, { status: 404 });
    }

    deleteMemoryCache(getRoutineLogsCacheKey(auth.session.username));
    logInfo("Routine session updated", {
      username: auth.session.username,
      target: parsed.data.target,
      count: updatedCount
    });

    return NextResponse.json({ ok: true, count: updatedCount });
  } catch (error) {
    logError("Failed to update routine session", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not update routine log." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = deleteRoutineLogSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const deletedCount = await deleteRoutineSessionForUser({
      username: auth.session.username,
      target: parsed.data.target
    });

    if (!deletedCount) {
      return NextResponse.json({ error: "Routine session not found." }, { status: 404 });
    }

    deleteMemoryCache(getRoutineLogsCacheKey(auth.session.username));
    logInfo("Routine session deleted", {
      username: auth.session.username,
      target: parsed.data.target,
      count: deletedCount
    });

    return NextResponse.json({ ok: true, count: deletedCount });
  } catch (error) {
    logError("Failed to delete routine session", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not delete routine log." }, { status: 500 });
  }
}
