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

async function getCalendarClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/calendar"]);
  return google.calendar({ version: "v3", auth });
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
  username: string
): Promise<CompetitionCalendarEvent[]> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();
  const normalizedUsername = normalizeUsername(username);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const res = await calendar.events.list({
    calendarId,
    timeMin: now.toISOString(),
    singleEvents: true,
    showDeleted: false,
    orderBy: "startTime",
    maxResults: 200,
    privateExtendedProperty: [`matUsername=${normalizedUsername}`]
  });

  return (res.data.items ?? [])
    .map((event) => mapEvent(event))
    .filter((event): event is CompetitionCalendarEvent => Boolean(event))
    .sort((a, b) => a.date.localeCompare(b.date));
}
