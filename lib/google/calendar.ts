import { calendar_v3, google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import {
  addDaysToDateString,
  buildCompetitionCalendarPeriods
} from "@/lib/competition-mode";

export type CompetitionCalendarEvent = {
  id: string;
  title: string;
  date: string;
  weighInDate: string;
  weighInTime: string;
  targetWeightKg: number | null;
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
  weighInDate: string;
  weighInTime: string;
  targetWeightKg?: number | null;
  description?: string;
}): string {
  const lines: string[] = [];
  lines.push(`Usuario: ${input.name.trim()} (${toDisplayUsername(input.username)})`);
  lines.push(`Fecha del pesaje: ${input.weighInDate}`);
  lines.push(`Hora del pesaje: ${input.weighInTime}`);
  if (input.targetWeightKg !== null && input.targetWeightKg !== undefined) {
    lines.push(`Peso objetivo: ${input.targetWeightKg} kg`);
  }

  const customDescription = input.description?.trim();
  if (customDescription) {
    lines.push("");
    lines.push(`Descripcion: ${customDescription}`);
  }

  return lines.join("\n");
}

const COMPETITION_EVENT_KIND = "competition";
const COMPETITION_WEEK_EVENT_KIND = "competition_week";
const PRECOMPETITION_WEEKS_EVENT_KIND = "precompetition_weeks";

function getEventKind(event: calendar_v3.Schema$Event): string {
  return event.extendedProperties?.private?.matEventKind?.trim().toLowerCase() ?? "";
}

function buildCompetitionPhaseDescription(input: {
  phaseLabel: "Competition Week" | "Precompetition Weeks";
  competitionName: string;
  competitionDate: string;
  weighInDate: string;
  targetWeightKg?: number | null;
  username: string;
  name: string;
}): string {
  const lines = [
    `${input.phaseLabel} - ${input.competitionName.trim()}`,
    `Competicion: ${input.competitionDate}`,
    `Pesaje: ${input.weighInDate}`,
    `Usuario: ${input.name.trim()} (${toDisplayUsername(input.username)})`
  ];
  if (input.targetWeightKg !== null && input.targetWeightKg !== undefined) {
    lines.push(`Peso objetivo: ${input.targetWeightKg} kg`);
  }
  return lines.join("\n");
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

function parseNumberFromText(value: string): number | null {
  const match = value.replace(",", ".").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDescriptionValue(description: string, label: string): string {
  const normalizedLabel = label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  const line = description
    .split(/\r?\n/)
    .find((item) =>
      item
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .startsWith(`${normalizedLabel}:`)
    );
  return line?.split(":").slice(1).join(":").trim() ?? "";
}

function mapEvent(event: calendar_v3.Schema$Event): CompetitionCalendarEvent | null {
  const id = event.id?.trim();
  const date = extractEventDate({
    date: event.start?.date,
    dateTime: event.start?.dateTime
  });
  if (!id || !date) return null;
  const description = event.description?.trim() || "";
  const privateProps = event.extendedProperties?.private ?? {};
  const weighInDate =
    privateProps.matWeighInDate?.trim() || extractDescriptionValue(description, "Fecha del pesaje") || date;
  const weighInTime =
    privateProps.matWeighInTime?.trim() || extractDescriptionValue(description, "Hora del pesaje") || "";
  const targetWeightRaw =
    privateProps.matTargetWeightKg?.trim() || extractDescriptionValue(description, "Peso objetivo");
  const targetWeightKg = targetWeightRaw ? parseNumberFromText(targetWeightRaw) : null;

  return {
    id,
    title: event.summary?.trim() || "Competicion",
    date,
    weighInDate,
    weighInTime,
    targetWeightKg,
    location: event.location?.trim() || "",
    description,
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
  weighInDate?: string;
  weighInTime: string;
  targetWeightKg?: number | null;
  location: string;
  description?: string;
}): Promise<CompetitionCalendarEvent> {
  const calendar = await getCalendarClient();
  const calendarId = getCalendarId();
  const normalizedUsername = normalizeUsername(input.username);
  const weighInDate = input.weighInDate?.trim() || input.date;
  const targetWeightKg =
    input.targetWeightKg !== null && input.targetWeightKg !== undefined && Number.isFinite(input.targetWeightKg)
      ? Math.max(0, Number(input.targetWeightKg))
      : null;
  const competitionEndDate = addDaysToDateString(input.date, 1);
  const periods = buildCompetitionCalendarPeriods(weighInDate);
  const createdEventIds: string[] = [];

  let createdCompetitionEvent: calendar_v3.Schema$Event | null = null;

  try {
    const created = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: input.competitionName.trim(),
        location: input.location.trim(),
        description: buildCompetitionDescription({
          username: input.username,
          name: input.name,
          weighInDate,
          weighInTime: input.weighInTime,
          targetWeightKg,
          description: input.description
        }),
        start: { date: input.date },
        end: { date: competitionEndDate },
        extendedProperties: {
          private: {
            matUsername: normalizedUsername,
            matDisplayName: input.name.trim(),
            matEventKind: COMPETITION_EVENT_KIND,
            matWeighInDate: weighInDate,
            matWeighInTime: input.weighInTime,
            matTargetWeightKg: targetWeightKg === null ? "" : String(targetWeightKg)
          }
        }
      }
    });

    createdCompetitionEvent = created.data;
    const competitionEventId = created.data.id?.trim();
    if (competitionEventId) createdEventIds.push(competitionEventId);

    const sharedPrivateProps = {
      matUsername: normalizedUsername,
      matDisplayName: input.name.trim(),
      matCompetitionDate: input.date,
      matWeighInDate: weighInDate,
      matTargetWeightKg: targetWeightKg === null ? "" : String(targetWeightKg),
      matCompetitionName: input.competitionName.trim(),
      matCompetitionEventId: competitionEventId ?? ""
    };

    const phaseEventRequests: calendar_v3.Schema$Event[] = [
      {
        summary: "Precompetition Weeks",
        location: input.location.trim(),
        description: buildCompetitionPhaseDescription({
          phaseLabel: "Precompetition Weeks",
          competitionName: input.competitionName,
          competitionDate: input.date,
          weighInDate,
          targetWeightKg,
          username: input.username,
          name: input.name
        }),
        start: { date: periods.precompetitionWeeks.startDate },
        end: { date: periods.precompetitionWeeks.endDateExclusive },
        extendedProperties: {
          private: {
            ...sharedPrivateProps,
            matEventKind: PRECOMPETITION_WEEKS_EVENT_KIND
          }
        }
      },
      {
        summary: "Competition Week",
        location: input.location.trim(),
        description: buildCompetitionPhaseDescription({
          phaseLabel: "Competition Week",
          competitionName: input.competitionName,
          competitionDate: input.date,
          weighInDate,
          targetWeightKg,
          username: input.username,
          name: input.name
        }),
        start: { date: periods.competitionWeek.startDate },
        end: { date: periods.competitionWeek.endDateExclusive },
        extendedProperties: {
          private: {
            ...sharedPrivateProps,
            matEventKind: COMPETITION_WEEK_EVENT_KIND
          }
        }
      }
    ];

    for (const requestBody of phaseEventRequests) {
      const phaseCreated = await calendar.events.insert({
        calendarId,
        requestBody
      });
      const phaseId = phaseCreated.data.id?.trim();
      if (phaseId) createdEventIds.push(phaseId);
    }
  } catch (error) {
    await Promise.all(
      createdEventIds.map((eventId) =>
        calendar.events.delete({ calendarId, eventId }).catch(() => null)
      )
    );
    throw error;
  }

  const mapped = createdCompetitionEvent ? mapEvent(createdCompetitionEvent) : null;
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
    .filter((event) => {
      const kind = getEventKind(event);
      return !kind || kind === COMPETITION_EVENT_KIND;
    })
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
    requestBody.end = { date: addDaysToDateString(cleanDate, 1) };
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
