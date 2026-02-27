import { google } from "googleapis";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import { DEFAULT_EXERCISE_CATALOG } from "@/lib/routines/default-exercises";

const ROUTINE_EXERCISE_HEADERS = ["Grupo muscular", "Ejercicio", "Activo"];
const ROUTINE_LOG_HEADERS = [
  "Timestamp",
  "Nombre",
  "Usuario",
  "Fecha sesion",
  "Dia",
  "Grupo muscular",
  "Ejercicio",
  "Repeticiones",
  "Peso kg",
  "Notas"
];

function loadDotEnvFile(fileName: string) {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function getFirstWorksheetTitle(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<string> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const title = response.data.sheets?.[0]?.properties?.title?.trim();
  if (!title) {
    throw new Error(`Spreadsheet ${spreadsheetId} has no worksheet tabs.`);
  }
  return title;
}

async function resolveWorksheetTitle(input: {
  sheets: ReturnType<typeof google.sheets>;
  spreadsheetId: string;
  preferredName?: string;
}): Promise<string> {
  const response = await input.sheets.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: "sheets.properties.title"
  });

  const titles = (response.data.sheets ?? [])
    .map((item) => item.properties?.title?.trim())
    .filter((value): value is string => Boolean(value));

  if (!titles.length) {
    throw new Error(`Spreadsheet ${input.spreadsheetId} has no worksheet tabs.`);
  }

  const preferred = input.preferredName?.trim();
  if (preferred && titles.includes(preferred)) {
    return preferred;
  }

  return titles[0];
}

async function main() {
  loadDotEnvFile(".env.local");
  loadDotEnvFile(".env");

  const env = getEnv();
  if (!env.GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID) {
    throw new Error("GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID is required.");
  }
  if (!env.GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID) {
    throw new Error("GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID is required.");
  }

  const auth = getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  const sheets = google.sheets({ version: "v4", auth });

  const exercisesSpreadsheetId = env.GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID;
  const logsSpreadsheetId = env.GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID;

  const exerciseWorksheet = await resolveWorksheetTitle({
    sheets,
    spreadsheetId: exercisesSpreadsheetId,
    preferredName: env.GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME
  });

  const logsWorksheet = await resolveWorksheetTitle({
    sheets,
    spreadsheetId: logsSpreadsheetId,
    preferredName: env.GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId: exercisesSpreadsheetId,
    range: `'${exerciseWorksheet}'!A:C`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: exercisesSpreadsheetId,
    range: `'${exerciseWorksheet}'!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ROUTINE_EXERCISE_HEADERS,
        ...DEFAULT_EXERCISE_CATALOG.map((item) => [item.muscleGroup, item.exercise, "TRUE"])
      ]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: logsSpreadsheetId,
    range: `'${logsWorksheet}'!A1:J1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [ROUTINE_LOG_HEADERS]
    }
  });

  const firstWorksheetTitle = await getFirstWorksheetTitle(sheets, exercisesSpreadsheetId);
  const secondWorksheetTitle = await getFirstWorksheetTitle(sheets, logsSpreadsheetId);

  console.info("[OK] Routine sheets seeded");
  console.info(`Catalog spreadsheet: ${exercisesSpreadsheetId} (${exerciseWorksheet})`);
  console.info(`Logs spreadsheet: ${logsSpreadsheetId} (${logsWorksheet})`);
  console.info(`Catalog first tab: ${firstWorksheetTitle}`);
  console.info(`Logs first tab: ${secondWorksheetTitle}`);
}

main().catch((error) => {
  console.error("[ERROR] Failed to seed routine sheets");
  console.error(error);
  process.exit(1);
});
