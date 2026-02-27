import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { deleteMemoryCache, getOrSetMemoryCache } from "@/lib/cache/memory-cache";
import { requireSession } from "@/lib/auth/require-session";
import {
  createCompetitionEvent,
  listCompetitionEventsForUser
} from "@/lib/google/calendar";
import { logError, logInfo } from "@/lib/logger";

const competitionSchema = z.object({
  competitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  competitionName: z.string().min(2).max(180),
  weighInTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  location: z.string().min(2).max(180),
  description: z.string().max(1000).optional()
});

const COMPETITIONS_CACHE_TTL_MS = 45_000;

function getCompetitionsCacheKey(username: string): string {
  return `competitions:${username.trim().toLowerCase()}`;
}

function mapGoogleCalendarError(error: unknown): string {
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
  const message =
    maybe.response?.data?.error?.message ?? maybe.message ?? "";
  const apiStatus = maybe.response?.data?.error?.status;
  const reason =
    maybe.response?.data?.error?.errors?.[0]?.reason ?? maybe.errors?.[0]?.reason;

  const isCalendarApiDisabled =
    apiStatus === "PERMISSION_DENIED" &&
    (reason === "accessNotConfigured" ||
      message.includes("calendar-json.googleapis.com") ||
      message.includes("has not been used in project"));

  if (isCalendarApiDisabled) {
    return "La Google Calendar API está deshabilitada en tu proyecto de Google Cloud. Actívala y espera unos minutos.";
  }

  if (status === 403 || status === 404) {
    return "No hay acceso al calendario. Comparte el calendario de Gmail con la service account como editor.";
  }

  return "No se pudo conectar con Google Calendar.";
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const cacheKey = getCompetitionsCacheKey(auth.session.username);
    const events = await getOrSetMemoryCache(cacheKey, COMPETITIONS_CACHE_TTL_MS, () =>
      listCompetitionEventsForUser(auth.session.username)
    );
    return NextResponse.json({ events });
  } catch (error) {
    logError("Failed to list competitions", {
      username: auth.session.username,
      error
    });
    return NextResponse.json(
      { events: [], warning: mapGoogleCalendarError(error) },
      { status: 200 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = competitionSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const event = await createCompetitionEvent({
      username: auth.session.username,
      name: auth.session.name,
      date: parsed.data.competitionDate,
      competitionName: parsed.data.competitionName,
      weighInTime: parsed.data.weighInTime,
      location: parsed.data.location,
      description: parsed.data.description
    });

    deleteMemoryCache(getCompetitionsCacheKey(auth.session.username));
    logInfo("Competition created", {
      username: auth.session.username,
      date: parsed.data.competitionDate,
      name: parsed.data.competitionName
    });

    return NextResponse.json({ ok: true, event });
  } catch (error) {
    logError("Failed to create competition", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: mapGoogleCalendarError(error) }, { status: 500 });
  }
}
