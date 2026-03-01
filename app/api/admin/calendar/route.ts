import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  createCalendarEventForAdmin,
  getCalendarEmbedUrl,
  listCalendarEventsForAdmin
} from "@/lib/google/calendar";
import { logError, logInfo } from "@/lib/logger";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

const querySchema = z.object({
  from: z.string().regex(dateRegex).optional(),
  to: z.string().regex(dateRegex).optional()
});

const createEventSchema = z.object({
  title: z.string().min(2).max(180),
  date: z.string().regex(dateRegex),
  time: z.string().regex(timeRegex).optional(),
  location: z.string().max(180).optional(),
  description: z.string().max(1000).optional(),
  username: z.string().max(80).optional(),
  displayName: z.string().max(120).optional()
});

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsedQuery = querySchema.safeParse({
      from: req.nextUrl.searchParams.get("from") ?? undefined,
      to: req.nextUrl.searchParams.get("to") ?? undefined
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid query." }, { status: 400 });
    }

    const events = await listCalendarEventsForAdmin({
      from: parsedQuery.data.from,
      to: parsedQuery.data.to
    });
    return NextResponse.json({
      embedUrl: getCalendarEmbedUrl(),
      events
    });
  } catch (error) {
    logError("Failed to list admin calendar events", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load calendar events." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const json = await req.json();
    const parsed = createEventSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const created = await createCalendarEventForAdmin({
      title: parsed.data.title,
      date: parsed.data.date,
      time: parsed.data.time,
      location: parsed.data.location,
      description: parsed.data.description,
      username: parsed.data.username,
      displayName: parsed.data.displayName
    });

    logInfo("Admin created calendar event", {
      adminUsername: auth.session.username,
      title: parsed.data.title,
      date: parsed.data.date,
      username: parsed.data.username ?? null
    });

    return NextResponse.json({ ok: true, event: created });
  } catch (error) {
    logError("Failed to create admin calendar event", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create calendar event." }, { status: 500 });
  }
}

