import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  recordAppEventLog,
  recordRevisionIssueLog,
  upsertRevisionRows
} from "@/lib/google/sheets";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { buildRevisionRows } from "@/lib/revisions";
import { DAILY_STEPS_EXERCISE } from "@/lib/achievements/strength-exercises";
import { appendStrengthMark } from "@/lib/google/achievements";
import { logError, logInfo } from "@/lib/logger";
import {
  isRevisionMeasurementQuestion,
  normalizeRevisionMeasurementAnswer
} from "@/lib/revision-measurements";

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  let revisionDateForLog = getTodayDateString();
  try {
    const json = await req.json();
    const parsed = submitSchema.safeParse(json);
    if (!parsed.success) {
      await recordRevisionIssueLog({
        username: auth.session.username,
        message: "Payload invalido al guardar los campos de una revision."
      });
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const fecha = parsed.data.revisionDate ?? getTodayDateString();
    revisionDateForLog = fecha;
    const normalizedUsername = auth.session.username.trim().toLowerCase();
    const stepsDailyEntries = parsed.data.stepsDailyEntries ?? [];
    if (stepsDailyEntries.length) {
      const uniqueDates = new Set(stepsDailyEntries.map((entry) => entry.date));
      if (uniqueDates.size !== stepsDailyEntries.length) {
        await recordRevisionIssueLog({
          username: auth.session.username,
          message: `Fechas de pasos duplicadas al guardar la revision del ${fecha}.`
        });
        return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
      }
    }
    const stepsAverage = getStepsAverageFromAnswers(parsed.data.answers);
    const normalizedAnswers = parsed.data.answers.map((item) => {
      if (!isRevisionMeasurementQuestion(item.question)) {
        return item;
      }

      const normalizedAnswer = normalizeRevisionMeasurementAnswer(item.answer);
      return {
        question: item.question,
        answer: normalizedAnswer
      };
    });

    const hasInvalidMeasurementAnswer = normalizedAnswers.some(
      (item) => isRevisionMeasurementQuestion(item.question) && !item.answer
    );
    if (hasInvalidMeasurementAnswer) {
      await recordRevisionIssueLog({
        username: auth.session.username,
        message: `Valor numerico invalido en medidas corporales al guardar la revision del ${fecha}.`
      });
      return NextResponse.json(
        { error: "Invalid measurement value in revision." },
        { status: 400 }
      );
    }

    const rows = buildRevisionRows({
      nombre: auth.session.name,
      usuario: auth.session.username,
      fecha,
      answers: normalizedAnswers.map((item) => ({
        pregunta: item.question,
        respuesta: item.answer
      }))
    });

    await upsertRevisionRows(rows);
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
        await recordRevisionIssueLog({
          username: auth.session.username,
          message:
            `La revision del ${fecha} se guardo, pero fallo el registro diario de pasos ` +
            `(${stepsDailyEntries.length} dias): ${getErrorMessage(error)}`
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
        await recordRevisionIssueLog({
          username: auth.session.username,
          message:
            `La revision del ${fecha} se guardo, pero fallo el historico de pasos ` +
            `con media ${Math.round(stepsAverage)}: ${getErrorMessage(error)}`
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
    await recordAppEventLog({
      level: "error",
      category: "revision-submit-server-error",
      path: "/api/revisions/submit",
      username: auth.session.username,
      message: getErrorMessage(error),
      context: {
        revisionDate: revisionDateForLog
      }
    });
    await recordRevisionIssueLog({
      username: auth.session.username,
      message:
        `Error al guardar los campos de la revision del ${revisionDateForLog}: ` +
        getErrorMessage(error)
    });
    return NextResponse.json({ error: "Could not save revision." }, { status: 500 });
  }
}
