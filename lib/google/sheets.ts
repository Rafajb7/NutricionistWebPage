import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import type { RevisionRow } from "@/lib/google/types";

type AppUser = {
  rowNumber: number;
  name: string;
  username: string;
  password: string;
  passwordColumn: number;
};

const spreadsheetIdCache = new Map<string, string>();
const worksheetTitleCache = new Map<string, string>();

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
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

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function getSheetsClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

async function resolveSpreadsheetIdByName(name: string): Promise<string> {
  const cached = spreadsheetIdCache.get(name);
  if (cached) return cached;

  const drive = await getDriveClient();
  const query = `name='${escapeQueryValue(name)}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const res = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    pageSize: 10
  });
  const match = res.data.files?.[0];
  if (!match?.id) {
    throw new Error(`Spreadsheet "${name}" not found in Google Drive.`);
  }

  spreadsheetIdCache.set(name, match.id);
  return match.id;
}

async function getFirstWorksheetTitle(spreadsheetId: string): Promise<string> {
  const cached = worksheetTitleCache.get(spreadsheetId);
  if (cached) return cached;

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  const title = res.data.sheets?.[0]?.properties?.title;
  if (!title) {
    throw new Error(`Spreadsheet "${spreadsheetId}" has no worksheets.`);
  }
  worksheetTitleCache.set(spreadsheetId, title);
  return title;
}

async function getValuesBySheetName(
  spreadsheetName: string,
  rangeA1: string,
  worksheetName?: string,
  options?: {
    valueRenderOption?: "FORMATTED_VALUE" | "UNFORMATTED_VALUE" | "FORMULA";
    dateTimeRenderOption?: "SERIAL_NUMBER" | "FORMATTED_STRING";
  }
): Promise<string[][]> {
  const sheets = await getSheetsClient();
  const spreadsheetId = await resolveSpreadsheetIdByName(spreadsheetName);
  const tab = worksheetName ?? (await getFirstWorksheetTitle(spreadsheetId));
  const range = `'${tab}'!${rangeA1}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: options?.valueRenderOption,
    dateTimeRenderOption: options?.dateTimeRenderOption
  });
  return (res.data.values as string[][] | undefined) ?? [];
}

export async function readUsersFromSheet(): Promise<AppUser[]> {
  const env = getEnv();
  const values = await getValuesBySheetName(env.GOOGLE_USERS_SHEET_NAME, "A1:Z");
  if (!values.length) return [];

  const headers = values[0].map(normalizeHeader);
  const usernameCol = headers.findIndex((h) =>
    ["usuario", "username", "telegram", "user"].includes(h)
  );
  const passwordCol = headers.findIndex((h) =>
    ["contrasenas", "contrasena", "password"].includes(h)
  );
  const nameCol = headers.findIndex((h) => ["nombre", "name"].includes(h));

  if (usernameCol === -1 || passwordCol === -1 || nameCol === -1) {
    throw new Error(
      'Users sheet must include "Nombre", "Usuario" and "contrasenas" columns.'
    );
  }

  return values
    .slice(1)
    .map((row, index) => ({
      rowNumber: index + 2,
      name: row[nameCol]?.trim() ?? "",
      username: row[usernameCol]?.trim() ?? "",
      password: row[passwordCol]?.trim() ?? "",
      passwordColumn: passwordCol
    }))
    .filter((u) => u.username);
}

export async function readQuestionsFromSheet(): Promise<string[]> {
  const env = getEnv();
  const values = await getValuesBySheetName(env.GOOGLE_QUESTIONS_SHEET_NAME, "A1:A");
  return values
    .map((row) => row[0]?.trim())
    .filter((question): question is string => Boolean(question));
}

export async function appendRevisionRows(rows: RevisionRow[]): Promise<void> {
  if (!rows.length) return;
  const env = getEnv();
  const sheets = await getSheetsClient();
  const spreadsheetId = await resolveSpreadsheetIdByName(env.GOOGLE_REVISION_SHEET_NAME);

  await appendRevisionRowsWithClient({
    sheetsClient: sheets,
    spreadsheetId,
    worksheetName: env.GOOGLE_REVISION_WORKSHEET_NAME,
    rows
  });
}

export async function listRevisionRowsForUser(username: string): Promise<RevisionRow[]> {
  const env = getEnv();
  const values = await getValuesBySheetName(
    env.GOOGLE_REVISION_SHEET_NAME,
    "A2:E",
    env.GOOGLE_REVISION_WORKSHEET_NAME,
    {
      valueRenderOption: "FORMULA",
      dateTimeRenderOption: "FORMATTED_STRING"
    }
  );

  const normalized = username.trim();
  const usernameVariants = new Set([normalized, `@${normalized}`]);

  return values
    .map((row) => ({
      nombre: String(row[0] ?? ""),
      fecha: String(row[1] ?? ""),
      usuario: String(row[2] ?? ""),
      pregunta: String(row[3] ?? ""),
      respuesta: String(row[4] ?? "")
    }))
    .filter((row) => usernameVariants.has(row.usuario.trim()));
}

export async function updateUserPasswordCell(
  rowNumber: number,
  passwordColumn: number,
  newPasswordHash: string
): Promise<void> {
  const env = getEnv();
  const sheets = await getSheetsClient();
  const spreadsheetId = await resolveSpreadsheetIdByName(env.GOOGLE_USERS_SHEET_NAME);
  const tab = await getFirstWorksheetTitle(spreadsheetId);
  const col = indexToA1Column(passwordColumn);
  const range = `'${tab}'!${col}${rowNumber}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: {
      values: [[newPasswordHash]]
    }
  });
}

export async function appendRevisionRowsWithClient(input: {
  sheetsClient: Awaited<ReturnType<typeof getSheetsClient>>;
  spreadsheetId: string;
  worksheetName: string;
  rows: RevisionRow[];
}) {
  const range = `'${input.worksheetName}'!A:E`;
  await input.sheetsClient.spreadsheets.values.append({
    spreadsheetId: input.spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: input.rows.map((row) => [
        row.nombre,
        row.fecha,
        row.usuario,
        row.pregunta,
        row.respuesta
      ])
    }
  });
}

export type { AppUser };
