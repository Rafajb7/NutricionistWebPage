import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { appendRevisionRows } from "@/lib/google/sheets";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { buildRevisionRows } from "@/lib/revisions";
import { DAILY_STEPS_EXERCISE } from "@/lib/achievements/strength-exercises";
import { appendStrengthMark } from "@/lib/google/achievements";
import { logError, logInfo } from "@/lib/logger";

const MAX_DAILY_STEPS_VALUE = 100_000;

const submitSchema = z.object({
  revisionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  answers: z
    .array(
      z.object({
        question: z.string().min(1).max(400),
        answer: z.string().min(1).max(3000)
      })
    )
    .min(1),
  stepsDailyEntries: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        steps: z.number().int().min(0).max(MAX_DAILY_STEPS_VALUE)
      })
    )
    .length(7)
    .optional()
});
const STEPS_AVERAGE_QUESTION = "numero de pasos";

function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeQuestion(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function parseNumericValue(value: string): number | null {
  const match = value.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function getStepsAverageFromAnswers(
  answers: Array<{ question: string; answer: string }>
): number | null {
  const stepsAnswer = answers.find((item) =>
    normalizeQuestion(item.question).startsWith(STEPS_AVERAGE_QUESTION)
  );
  if (!stepsAnswer) return null;
  const value = parseNumericValue(stepsAnswer.answer);
  if (value === null || value < 0) return null;
  return value;
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = submitSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const fecha = parsed.data.revisionDate ?? getTodayDateString();
    const normalizedUsername = auth.session.username.trim().toLowerCase();
    const stepsDailyEntries = parsed.data.stepsDailyEntries ?? [];
    if (stepsDailyEntries.length) {
      const uniqueDates = new Set(stepsDailyEntries.map((entry) => entry.date));
      if (uniqueDates.size !== stepsDailyEntries.length) {
        return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
      }
    }
    const stepsAverage = getStepsAverageFromAnswers(parsed.data.answers);
    const rows = buildRevisionRows({
      nombre: auth.session.name,
      usuario: auth.session.username,
      fecha,
      answers: parsed.data.answers.map((item) => ({
        pregunta: item.question,
        respuesta: item.answer
      }))
    });

    await appendRevisionRows(rows);
    deleteMemoryCache(`revisions:${normalizedUsername}`);

    let stepsStoredCount = 0;

    if (stepsDailyEntries.length) {
      try {
        for (const entry of stepsDailyEntries) {
          await appendStrengthMark({
            name: auth.session.name,
            username: auth.session.username,
            exercise: DAILY_STEPS_EXERCISE,
            date: entry.date,
            weightKg: entry.steps
          });
        }
        stepsStoredCount = stepsDailyEntries.length;
        deleteMemoryCache(`strength-achievements:${normalizedUsername}`);
      } catch (error) {
        logError("Failed to store weekly daily-steps entries from revision", {
          username: auth.session.username,
          date: fecha,
          entriesCount: stepsDailyEntries.length,
          error
        });
      }
    } else if (stepsAverage !== null) {
      try {
        await appendStrengthMark({
          name: auth.session.name,
          username: auth.session.username,
          exercise: DAILY_STEPS_EXERCISE,
          date: fecha,
          weightKg: Math.round(stepsAverage)
        });
        stepsStoredCount = 1;
        deleteMemoryCache(`strength-achievements:${normalizedUsername}`);
      } catch (error) {
        logError("Failed to store weekly steps average from revision", {
          username: auth.session.username,
          date: fecha,
          stepsAverage,
          error
        });
      }
    }

    logInfo("Revision answers stored", {
      username: auth.session.username,
      count: rows.length,
      stepsStored: stepsStoredCount > 0,
      stepsStoredCount
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("Failed to store revision answers", error);
    return NextResponse.json({ error: "Could not save revision." }, { status: 500 });
  }
}
