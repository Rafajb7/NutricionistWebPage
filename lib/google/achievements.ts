import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import {
  isStrengthExercise,
  type StrengthExercise
} from "@/lib/achievements/strength-exercises";
import { getGoogleAuth } from "@/lib/google/auth";

const SPREADSHEET_ID_REGEX = /^[A-Za-z0-9-_]{20,}$/;

const MARK_HEADERS = [
  "Timestamp",
  "Nombre",
  "Usuario",
  "Ejercicio",
  "Fecha",
  "Peso kg"
];

const GOAL_HEADERS = [
  "Timestamp",
  "Nombre",
  "Usuario",
  "Ejercicio",
  "Fecha objetivo",
  "Peso objetivo kg"
];

type AchievementSheetsInfo = {
  spreadsheetId: string;
  marksWorksheetName: string;
  goalsWorksheetName: string;
};

export type StrengthMark = {
  id: string;
  timestamp: string;
  nombre: string;
  usuario: string;
  exercise: StrengthExercise;
  date: string;
  weightKg: number;
};

export type StrengthGoal = {
  id: string;
  timestamp: string;
  nombre: string;
  usuario: string;
  exercise: StrengthExercise;
  targetDate: string;
  targetWeightKg: number;
};

const spreadsheetIdCache = new Map<string, string>();
const worksheetTitlesCache = new Map<string, Set<string>>();
const achievementsSheetInitCache = new Map<string, Promise<AchievementSheetsInfo>>();

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function indexToA1Column(index: number): string {
  let result = "";
  let n = index + 1;
  while (n > 0) {
    const mod = (n - 1) % 26;
    result = String.fromCharCode(65 + mod) + result;
    n = Math.floor((n - mod) / 26);
  }
  return result;
}

function escapeQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

function isValidSpreadsheetId(value: string | undefined): value is string {
  if (!value) return false;
  return SPREADSHEET_ID_REGEX.test(value.trim());
}

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function getSheetsClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

async function resolveSpreadsheetIdByName(
  name: string,
  options?: {
    createIfMissing?: boolean;
    initialWorksheetTitles?: string[];
  }
): Promise<string> {
  const cached = spreadsheetIdCache.get(name);
  if (cached) return cached;

  const drive = await getDriveClient();
  const query = `name='${escapeQueryValue(name)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10
  });
  const match = res.data.files?.[0];
  if (match?.id) {
    spreadsheetIdCache.set(name, match.id);
    return match.id;
  }

  if (!options?.createIfMissing) {
    throw new Error(`Spreadsheet "${name}" not found in Google Drive.`);
  }

  const initialWorksheetTitles =
    options.initialWorksheetTitles
      ?.map((item) => item.trim())
      .filter((item) => item.length > 0) ?? [];
  const uniqueTitles = Array.from(new Set(initialWorksheetTitles));
  if (!uniqueTitles.length) {
    uniqueTitles.push("Marcas");
  }

  const sheets = await getSheetsClient();
  const create = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: name },
      sheets: uniqueTitles.map((title) => ({
        properties: { title }
      }))
    },
    fields: "spreadsheetId,sheets.properties.title"
  });
  const createdId = create.data.spreadsheetId;
  if (!createdId) {
    throw new Error(`Failed to create spreadsheet "${name}".`);
  }

  spreadsheetIdCache.set(name, createdId);
  worksheetTitlesCache.set(createdId, new Set(uniqueTitles));
  return createdId;
}

async function getWorksheetTitles(spreadsheetId: string): Promise<Set<string>> {
  const cached = worksheetTitlesCache.get(spreadsheetId);
  if (cached) return cached;

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });
  const titles = new Set<string>();
  for (const sheet of res.data.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    if (title) titles.add(title);
  }
  if (!titles.size) {
    throw new Error(`Spreadsheet "${spreadsheetId}" has no worksheets.`);
  }

  worksheetTitlesCache.set(spreadsheetId, titles);
  return titles;
}

async function ensureWorksheetExists(spreadsheetId: string, worksheetTitle: string): Promise<void> {
  const normalizedTitle = worksheetTitle.trim();
  if (!normalizedTitle) {
    throw new Error("Worksheet title cannot be empty.");
  }

  const titles = await getWorksheetTitles(spreadsheetId);
  if (titles.has(normalizedTitle)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: normalizedTitle }
          }
        }
      ]
    }
  });

  const refreshed = new Set(titles);
  refreshed.add(normalizedTitle);
  worksheetTitlesCache.set(spreadsheetId, refreshed);
}

async function ensureHeaderRow(input: {
  spreadsheetId: string;
  worksheetName: string;
  headers: string[];
}) {
  const sheets = await getSheetsClient();
  const endCol = indexToA1Column(input.headers.length - 1);
  const range = `'${input.worksheetName}'!A1:${endCol}1`;

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range
  });
  const firstRow = (existing.data.values?.[0] as string[] | undefined) ?? [];
  const hasData = firstRow.some((value) => String(value).trim().length > 0);
  if (hasData) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values: [input.headers]
    }
  });
}

async function ensureAchievementsSheetsReady(): Promise<AchievementSheetsInfo> {
  const env = getEnv();
  const spreadsheetIdFromEnv = env.GOOGLE_ACHIEVEMENTS_SPREADSHEET_ID?.trim();
  const spreadsheetName = env.GOOGLE_ACHIEVEMENTS_SHEET_NAME.trim();
  const marksWorksheetName = env.GOOGLE_ACHIEVEMENTS_MARKS_WORKSHEET_NAME.trim();
  const goalsWorksheetName = env.GOOGLE_ACHIEVEMENTS_GOALS_WORKSHEET_NAME.trim();

  const cacheKey = [
    spreadsheetIdFromEnv ?? "",
    spreadsheetName,
    marksWorksheetName,
    goalsWorksheetName
  ].join("::");

  let pending = achievementsSheetInitCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const spreadsheetId = isValidSpreadsheetId(spreadsheetIdFromEnv)
        ? spreadsheetIdFromEnv
        : await resolveSpreadsheetIdByName(spreadsheetName, {
            createIfMissing: true,
            initialWorksheetTitles: [marksWorksheetName, goalsWorksheetName]
          });

      await Promise.all([
        ensureWorksheetExists(spreadsheetId, marksWorksheetName),
        ensureWorksheetExists(spreadsheetId, goalsWorksheetName)
      ]);

      await Promise.all([
        ensureHeaderRow({
          spreadsheetId,
          worksheetName: marksWorksheetName,
          headers: MARK_HEADERS
        }),
        ensureHeaderRow({
          spreadsheetId,
          worksheetName: goalsWorksheetName,
          headers: GOAL_HEADERS
        })
      ]);

      return {
        spreadsheetId,
        marksWorksheetName,
        goalsWorksheetName
      };
    })();
    achievementsSheetInitCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    achievementsSheetInitCache.delete(cacheKey);
    throw error;
  }
}

export async function listStrengthMarksForUser(username: string): Promise<StrengthMark[]> {
  const sheetsInfo = await ensureAchievementsSheetsReady();
  const sheets = await getSheetsClient();
  const targetUsername = normalizeUsername(username);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsInfo.spreadsheetId,
    range: `'${sheetsInfo.marksWorksheetName}'!A2:F`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  const rows = (res.data.values as string[][] | undefined) ?? [];
  const marks: StrengthMark[] = [];

  rows.forEach((row, index) => {
    const rowUsername = normalizeUsername(String(row[2] ?? ""));
    if (!rowUsername || rowUsername !== targetUsername) return;

    const exercise = String(row[3] ?? "").trim();
    if (!isStrengthExercise(exercise)) return;

    const date = String(row[4] ?? "").trim();
    const weightKg = parseNumber(row[5]);
    if (!date || weightKg === null) return;

    marks.push({
      id: `mark-${index + 2}`,
      timestamp: String(row[0] ?? ""),
      nombre: String(row[1] ?? ""),
      usuario: rowUsername,
      exercise,
      date,
      weightKg
    });
  });

  return marks.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.timestamp.localeCompare(a.timestamp);
  });
}

export async function listStrengthGoalsForUser(username: string): Promise<StrengthGoal[]> {
  const sheetsInfo = await ensureAchievementsSheetsReady();
  const sheets = await getSheetsClient();
  const targetUsername = normalizeUsername(username);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsInfo.spreadsheetId,
    range: `'${sheetsInfo.goalsWorksheetName}'!A2:F`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });

  const rows = (res.data.values as string[][] | undefined) ?? [];
  const goals: StrengthGoal[] = [];

  rows.forEach((row, index) => {
    const rowUsername = normalizeUsername(String(row[2] ?? ""));
    if (!rowUsername || rowUsername !== targetUsername) return;

    const exercise = String(row[3] ?? "").trim();
    if (!isStrengthExercise(exercise)) return;

    const targetDate = String(row[4] ?? "").trim();
    const targetWeightKg = parseNumber(row[5]);
    if (!targetDate || targetWeightKg === null) return;

    goals.push({
      id: `goal-${index + 2}`,
      timestamp: String(row[0] ?? ""),
      nombre: String(row[1] ?? ""),
      usuario: rowUsername,
      exercise,
      targetDate,
      targetWeightKg
    });
  });

  return goals.sort((a, b) => {
    const byDate = a.targetDate.localeCompare(b.targetDate);
    if (byDate !== 0) return byDate;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

export async function appendStrengthMark(input: {
  name: string;
  username: string;
  exercise: StrengthExercise;
  date: string;
  weightKg: number;
}): Promise<void> {
  const sheetsInfo = await ensureAchievementsSheetsReady();
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetsInfo.spreadsheetId,
    range: `'${sheetsInfo.marksWorksheetName}'!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          input.name,
          input.username.trim().replace(/^@/, ""),
          input.exercise,
          input.date,
          input.weightKg
        ]
      ]
    }
  });
}

export async function upsertStrengthGoal(input: {
  name: string;
  username: string;
  exercise: StrengthExercise;
  targetDate: string;
  targetWeightKg: number;
}): Promise<void> {
  const sheetsInfo = await ensureAchievementsSheetsReady();
  const sheets = await getSheetsClient();
  const normalizedUsername = normalizeUsername(input.username);

  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetsInfo.spreadsheetId,
    range: `'${sheetsInfo.goalsWorksheetName}'!A2:F`,
    valueRenderOption: "FORMATTED_VALUE"
  });
  const rows = (read.data.values as string[][] | undefined) ?? [];

  let rowNumber: number | null = null;
  rows.forEach((row, index) => {
    if (rowNumber !== null) return;
    const rowUsername = normalizeUsername(String(row[2] ?? ""));
    const rowExercise = String(row[3] ?? "").trim();
    const rowTargetDate = String(row[4] ?? "").trim();

    if (
      rowUsername === normalizedUsername &&
      rowExercise === input.exercise &&
      rowTargetDate === input.targetDate
    ) {
      rowNumber = index + 2;
    }
  });

  const rowValues = [
    new Date().toISOString(),
    input.name,
    input.username.trim().replace(/^@/, ""),
    input.exercise,
    input.targetDate,
    input.targetWeightKg
  ];

  if (rowNumber !== null) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsInfo.spreadsheetId,
      range: `'${sheetsInfo.goalsWorksheetName}'!A${rowNumber}:F${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [rowValues]
      }
    });
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetsInfo.spreadsheetId,
    range: `'${sheetsInfo.goalsWorksheetName}'!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [rowValues]
    }
  });
}
