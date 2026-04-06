import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import { getActiveCompetitionMode } from "@/lib/competition-mode";
import { getEnv } from "@/lib/env";
import { listCompetitionEventsForUser } from "@/lib/google/calendar";
import {
  listPeakModeDailyLogsForUser,
  upsertPeakModeDailyLogForUser
} from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function requiredNumberSchema(options: { min: number; max: number; integer?: boolean }) {
  const base = options.integer
    ? z.number().int().min(options.min).max(options.max)
    : z.number().min(options.min).max(options.max);

  return z.preprocess((value) => {
    if (value === null || value === undefined) return Number.NaN;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const normalized = value.trim().replace(",", ".");
      if (!normalized) return Number.NaN;
      return Number(normalized);
    }
    return Number.NaN;
  }, base);
}

const payloadSchema = z
  .object({
    date: z.string().regex(DATE_ONLY_REGEX).optional(),
    pesoAyunasKg: requiredNumberSchema({ min: 20, max: 250 }),
    pesoNocturnoKg: requiredNumberSchema({ min: 20, max: 300 }),
    pasosDiarios: requiredNumberSchema({ min: 0, max: 100000, integer: true }),
    aguaLitros: requiredNumberSchema({ min: 0, max: 20 }),
    frutaPiezas: requiredNumberSchema({ min: 0, max: 20 }),
    verduraRaciones: requiredNumberSchema({ min: 0, max: 20 }),
    cerealesIntegralesRaciones: requiredNumberSchema({ min: 0, max: 20 }),
    hambreEscala: requiredNumberSchema({ min: 1, max: 5, integer: true }),
    descansoEscala: requiredNumberSchema({ min: 1, max: 5, integer: true }),
    horasSueno: requiredNumberSchema({ min: 0, max: 24 }),
    estresEscala: requiredNumberSchema({ min: 0, max: 5, integer: true }),
    molestiasDigestivasEscala: requiredNumberSchema({ min: 0, max: 5, integer: true }),
    cumplimientoPlanEscala: requiredNumberSchema({ min: 1, max: 5, integer: true }),
    tuvoEntreno: z.boolean(),
    dobleSesion: z.boolean()
  })
  .refine((value) => value.tuvoEntreno || !value.dobleSesion, {
    message: "No puede haber doble sesion sin entreno.",
    path: ["dobleSesion"]
  });

function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPeakModeAccessibleRange(activeMode: Awaited<ReturnType<typeof getActiveCompetitionMode>> | null, today: string) {
  if (!activeMode) return null;

  const maxDate = activeMode.endsOn.localeCompare(today) < 0 ? activeMode.endsOn : today;
  if (activeMode.startsOn.localeCompare(maxDate) > 0) return null;

  return {
    minDate: activeMode.startsOn,
    maxDate
  };
}

function clampDateWithinRange(date: string, range: { minDate: string; maxDate: string }): string {
  if (date.localeCompare(range.minDate) < 0) return range.minDate;
  if (date.localeCompare(range.maxDate) > 0) return range.maxDate;
  return date;
}

function resolveSelectedPeakDate(input: {
  requestedDate?: string | null;
  activeMode: Awaited<ReturnType<typeof getActiveCompetitionMode>> | null;
  today: string;
}): string {
  const range = getPeakModeAccessibleRange(input.activeMode, input.today);
  if (!range) return input.today;

  const requestedDate = input.requestedDate?.trim();
  if (!requestedDate || !DATE_ONLY_REGEX.test(requestedDate)) {
    return range.maxDate;
  }

  return clampDateWithinRange(requestedDate, range);
}

function isPeakDateAccessible(input: {
  date: string;
  activeMode: Awaited<ReturnType<typeof getActiveCompetitionMode>> | null;
  today: string;
}): boolean {
  if (!DATE_ONLY_REGEX.test(input.date)) return false;
  const range = getPeakModeAccessibleRange(input.activeMode, input.today);
  if (!range) return false;

  return (
    input.date.localeCompare(range.minDate) >= 0 &&
    input.date.localeCompare(range.maxDate) <= 0
  );
}

function mapGoogleSheetsError(error: unknown): string {
  const maybe = error as {
    code?: number;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
    response?: {
      status?: number;
      data?: {
        error?: {
          status?: string;
          message?: string;
          errors?: Array<{ reason?: string; message?: string }>;
        };
      };
    };
  };

  const status = maybe.code ?? maybe.status ?? maybe.response?.status;
  const message = maybe.response?.data?.error?.message ?? maybe.message ?? "";
  const apiStatus = maybe.response?.data?.error?.status;
  const reason =
    maybe.response?.data?.error?.errors?.[0]?.reason ?? maybe.errors?.[0]?.reason;

  const isSheetsApiDisabled =
    apiStatus === "PERMISSION_DENIED" &&
    (reason === "accessNotConfigured" ||
      message.includes("sheets.googleapis.com") ||
      message.includes("has not been used in project"));

  if (isSheetsApiDisabled) {
    return "La Google Sheets API esta deshabilitada en tu proyecto de Google Cloud.";
  }

  if (status === 403 || status === 404) {
    const env = getEnv();
    const sheetName = env.GOOGLE_PEAK_MODE_SHEET_NAME || "PRECOMPETICIONES";
    return `No hay acceso a la hoja ${sheetName}. Compartela con la service account como editor.`;
  }

  return "No se pudo conectar con Google Sheets.";
}

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const competitions = await listCompetitionEventsForUser(auth.session.username);

    let logs = await Promise.resolve([] as Awaited<ReturnType<typeof listPeakModeDailyLogsForUser>>);
    let warning = "";

    try {
      logs = await listPeakModeDailyLogsForUser(auth.session.username);
    } catch (error) {
      warning = mapGoogleSheetsError(error);
      logError("Failed to load peak mode logs from sheets", {
        username: auth.session.username,
        error
      });
    }

    const activeMode = getActiveCompetitionMode(competitions);
    const today = formatDateOnly(new Date());
    const selectedDate = resolveSelectedPeakDate({
      requestedDate: req.nextUrl.searchParams.get("date"),
      activeMode,
      today
    });
    const todayLog =
      logs
        .filter((row) => row.fecha === today)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null;
    const selectedLog =
      logs
        .filter((row) => row.fecha === selectedDate)
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0] ?? null;

    return NextResponse.json({
      mode: activeMode?.mode ?? "none",
      activeWindow: activeMode,
      today,
      todayLog,
      todaySubmitted: Boolean(todayLog),
      selectedDate,
      selectedLog,
      selectedSubmitted: Boolean(selectedLog),
      logs,
      warning
    });
  } catch (error) {
    logError("Failed to load peak mode daily logs", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load daily peak mode logs." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const [json, competitions] = await Promise.all([
      req.json(),
      listCompetitionEventsForUser(auth.session.username)
    ]);

    const activeMode = getActiveCompetitionMode(competitions);
    if (!activeMode) {
      return NextResponse.json(
        { error: "El formulario diario solo esta disponible en modo titan o diablo." },
        { status: 409 }
      );
    }

    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const today = formatDateOnly(new Date());
    const targetDate = parsed.data.date ?? today;
    if (!isPeakDateAccessible({ date: targetDate, activeMode, today })) {
      return NextResponse.json(
        { error: "Solo puedes editar fechas dentro del periodo activo y hasta el dia de hoy." },
        { status: 409 }
      );
    }
    const username = auth.session.username.trim().replace(/^@/, "");
    const { date: _date, ...formData } = parsed.data;

    await upsertPeakModeDailyLogForUser({
      username,
      row: {
        timestamp: new Date().toISOString(),
        fecha: targetDate,
        nombre: auth.session.name,
        usuario: username,
        modo: activeMode.mode,
        ...formData
      }
    });

    logInfo("Peak mode daily log upserted", {
      username,
      mode: activeMode.mode,
      date: targetDate
    });

    return NextResponse.json({
      ok: true,
      date: targetDate,
      mode: activeMode.mode
    });
  } catch (error) {
    logError("Failed to save peak mode daily log", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: mapGoogleSheetsError(error) }, { status: 500 });
  }
}
