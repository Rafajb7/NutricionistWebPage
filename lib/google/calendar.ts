import { calendar_v3, google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";

export type CompetitionCalendarEvent = {
  id: string;
  title: string;
  date: string;
  location: string;
  description: string;
  createdAt: string;
};

export type AdminCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  createdAt: string;
  username: string | null;
  displayName: string | null;
};

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function toDisplayUsername(value: string): string {
  const normalized = normalizeUsername(value);
  return normalized ? `@${normalized}` : "@usuario";
}

function buildCompetitionDescription(input: {
  username: string;
  name: string;
  weighInTime: string;
  description?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Usuario: ${input.name.trim()} (${toDisplayUsername(input.username)})`);
  lines.push(`Hora del pesaje: ${input.weighInTime}`);

  const customDescription = input.description?.trim();
  if (customDescription) {
    lines.push("");
    lines.push(`Descripcion: ${customDescription}`);
  }

  return lines.join("\n");
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid competition date.");
  }
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function extractEventDate(input: { date?: string | null; dateTime?: string | null }): string {
  if (input.date) return input.date;
  if (!input.dateTime) return "";
  return input.dateTime.slice(0, 10);
}

function getCalendarId(): string {
  const env = getEnv();
  const calendarId =
    env.GOOGLE_COMPETITIONS_CALENDAR_ID?.trim() || env.SMTP_FROM?.trim() || env.SMTP_USER?.trim();
  if (!calendarId) {
    throw new Error("Competition calendar ID is missing.");
  }
  return calendarId;
}

function mapEvent(event: calendar_v3.Schema$Event): CompetitionCalendarEvent | null {
  const id = event.id?.trim();
  const date = extractEventDate({
    date: event.start?.date,
    dateTime: event.start?.dateTime
  });
  if (!id || !date) return null;

  return {
    id,
    title: event.summary?.trim() || "Competicion",
    date,
    location: event.location?.trim() || "",
    description: event.description?.trim() || "",
    createdAt: event.created?.trim() || ""
  };
}

function mapAdminCalendarEvent(event: calendar_v3.Schema$Event): AdminCalendarEvent | null {
  const id = event.id?.trim();
  if (!id) return null;

  const start = event.start?.dateTime?.trim() || event.start?.date?.trim() || "";
  const end = event.end?.dateTime?.trim() || event.end?.date?.trim() || "";
  if (!start) return null;

  const username = event.extendedProperties?.private?.matUsername?.trim() || null;
  const displayName = event.extendedProperties?.private?.matDisplayName?.trim() || null;

  return {
    id,
    title: event.summary?.trim() || "Evento",
    start,
    end,
    allDay: Boolean(event.start?.date && !event.start?.dateTime),
    location: event.location?.trim() || "",
    description: event.description?.trim() || "",
    createdAt: event.created?.trim() || "",
    username,
    displayName
  };
}

async function getCalendarClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/calendar"]);
  return google.calendar({ version: "v3", auth });
}

export function getCalendarEmbedUrl(): string {
  const calendarId = getCalendarId();
  return `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(calendarId)}&ctz=Europe%2FMadrid`;
}

export async function createCompetitionEvent(input: {
  username: string;
  name: string;
  date: string;
  competitionName: string;
  weighInTime: string;
  location: string;
  description?: string;
}): Promise<CompetitionCalendarEvent> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();
  const normalizedUsername = normalizeUsername(input.username);
  const endDate = addDays(input.date, 1);

  const created = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.competitionName.trim(),
      location: input.location.trim(),
      description: buildCompetitionDescription({
        username: input.username,
        name: input.name,
        weighInTime: input.weighInTime,
        description: input.description
      }),
      start: { date: input.date },
      end: { date: endDate },
      extendedProperties: {
        private: {
          matUsername: normalizedUsername,
          matDisplayName: input.name.trim()
        }
      }
    }
  });

  const mapped = mapEvent(created.data);
  if (!mapped) {
    throw new Error("Could not parse created competition event.");
  }
  return mapped;
}

export async function listCompetitionEventsForUser(
  username: string,
  options?: {
    includePast?: boolean;
  }
): Promise<CompetitionCalendarEvent[]> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();
  const normalizedUsername = normalizeUsername(username);
  const request: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    singleEvents: true,
    showDeleted: false,
    orderBy: "startTime",
    maxResults: 200,
    privateExtendedProperty: [`matUsername=${normalizedUsername}`]
  };

  if (!options?.includePast) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    request.timeMin = now.toISOString();
  }

  const res = await calendar.events.list(request);

  return (res.data.items ?? [])
    .map((event) => mapEvent(event))
    .filter((event): event is CompetitionCalendarEvent => Boolean(event))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function listCalendarEventsForAdmin(input?: {
  from?: string;
  to?: string;
}): Promise<AdminCalendarEvent[]> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();

  const fromDate = input?.from?.trim();
  const toDate = input?.to?.trim();

  const defaultFrom = new Date();
  defaultFrom.setDate(1);
  defaultFrom.setHours(0, 0, 0, 0);

  const defaultTo = new Date(defaultFrom);
  defaultTo.setMonth(defaultTo.getMonth() + 6);

  const request: calendar_v3.Params$Resource$Events$List = {
    calendarId,
    singleEvents: true,
    showDeleted: false,
    orderBy: "startTime",
    maxResults: 500,
    timeMin: fromDate ? `${fromDate}T00:00:00.000Z` : defaultFrom.toISOString(),
    timeMax: toDate ? `${toDate}T23:59:59.999Z` : defaultTo.toISOString()
  };

  const res = await calendar.events.list(request);
  return (res.data.items ?? [])
    .map((item) => mapAdminCalendarEvent(item))
    .filter((item): item is AdminCalendarEvent => Boolean(item));
}

export async function createCalendarEventForAdmin(input: {
  title: string;
  date: string;
  time?: string;
  location?: string;
  description?: string;
  username?: string;
  displayName?: string;
}): Promise<AdminCalendarEvent> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();

  const cleanTitle = input.title.trim();
  const cleanDate = input.date.trim();
  const cleanTime = input.time?.trim() || "";
  const cleanLocation = input.location?.trim() || "";
  const cleanDescription = input.description?.trim() || "";
  const cleanUsername = input.username?.trim() ? normalizeUsername(input.username) : "";
  const cleanDisplayName = input.displayName?.trim() || "";

  const descriptionLines: string[] = [];
  if (cleanDescription) descriptionLines.push(cleanDescription);
  if (cleanUsername) {
    descriptionLines.push("");
    descriptionLines.push(
      `Usuario: ${cleanDisplayName || cleanUsername} (${toDisplayUsername(cleanUsername)})`
    );
  }

  const requestBody: calendar_v3.Schema$Event = {
    summary: cleanTitle,
    location: cleanLocation || undefined,
    description: descriptionLines.join("\n") || undefined
  };

  if (cleanTime) {
    const startDateTime = `${cleanDate}T${cleanTime}:00`;
    const endDateObj = new Date(`${cleanDate}T${cleanTime}:00`);
    endDateObj.setHours(endDateObj.getHours() + 1);
    const hh = String(endDateObj.getHours()).padStart(2, "0");
    const mm = String(endDateObj.getMinutes()).padStart(2, "0");
    const endDateTime = `${cleanDate}T${hh}:${mm}:00`;

    requestBody.start = {
      dateTime: startDateTime,
      timeZone: "Europe/Madrid"
    };
    requestBody.end = {
      dateTime: endDateTime,
      timeZone: "Europe/Madrid"
    };
  } else {
    requestBody.start = { date: cleanDate };
    requestBody.end = { date: addDays(cleanDate, 1) };
  }

  if (cleanUsername) {
    requestBody.extendedProperties = {
      private: {
        matUsername: cleanUsername,
        matDisplayName: cleanDisplayName || cleanUsername
      }
    };
  }

  const created = await calendar.events.insert({
    calendarId,
    requestBody
  });

  const mapped = mapAdminCalendarEvent(created.data);
  if (!mapped) {
    throw new Error("Could not parse created admin calendar event.");
  }
  return mapped;
}
