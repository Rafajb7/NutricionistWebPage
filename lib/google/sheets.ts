import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import type { RevisionRow } from "@/lib/google/types";
import { DEFAULT_EXERCISE_CATALOG } from "@/lib/routines/default-exercises";

type AppUser = {
  rowNumber: number;
  name: string;
  username: string;
  password: string;
  email: string;
  permission: "user" | "admin";
  passwordColumn: number;
};

type UsersSheetColumns = {
  usernameCol: number;
  passwordCol: number;
  nameCol: number;
  emailCol: number;
  permissionCol: number;
};

export type RoutineExercise = {
  muscleGroup: string;
  exercise: string;
};

export type RoutineExerciseGroup = {
  muscleGroup: string;
  exercises: string[];
};

export type RoutineEffortLevel = "alto" | "medio" | "bajo";

export type RoutineLogRow = {
  timestamp: string;
  nombre: string;
  usuario: string;
  fechaSesion: string;
  dia: string;
  grupoMuscular: string;
  ejercicio: string;
  series: number;
  repeticiones: number;
  pesoKg: number | null;
  erp: number;
  nivelFatiga: RoutineEffortLevel;
  molestiasGastrointestinales: RoutineEffortLevel;
  intraentreno: boolean;
  notas: string;
};

export type RoutineSessionTarget = {
  timestamp: string;
  sessionDate: string;
  day: string;
};

export type PeakModeType = "titan" | "diablo";

export type PeakModeDailyLogRow = {
  timestamp: string;
  fecha: string;
  nombre: string;
  usuario: string;
  modo: PeakModeType;
  pesoAyunasKg: number;
  pesoNocturnoKg: number;
  pasosDiarios: number;
  aguaLitros: number;
  frutaPiezas: number;
  verduraRaciones: number;
  cerealesIntegralesRaciones: number;
  hambreEscala: number;
  descansoEscala: number;
  horasSueno: number;
  estresEscala: number;
  molestiasDigestivasEscala: number;
  cumplimientoPlanEscala: number;
  tuvoEntreno: boolean;
  dobleSesion: boolean;
};

const spreadsheetIdCache = new Map<string, string>();
const worksheetTitleCache = new Map<string, string>();
const worksheetNamesCache = new Map<string, Set<string>>();
type RoutineSheetsInfo = {
  exercisesSpreadsheetId: string;
  logsSpreadsheetId: string;
  exercisesWorksheetName: string;
  logsWorksheetName: string;
};

const routineSheetInitCache = new Map<string, Promise<RoutineSheetsInfo>>();

type PeakModeSheetInfo = {
  spreadsheetId: string;
  worksheetName: string;
};

const peakModeSheetInitCache = new Map<string, Promise<PeakModeSheetInfo>>();

const ROUTINE_EXERCISE_HEADERS = ["Grupo muscular", "Ejercicio", "Activo"];
const ROUTINE_LOG_HEADERS = [
  "Timestamp",
  "Nombre",
  "Usuario",
  "Fecha sesion",
  "Dia",
  "Grupo muscular",
  "Ejercicio",
  "Series",
  "Repeticiones",
  "Peso kg",
  "RPE",
  "Nivel de fatiga",
  "Molestias gastrointestinales",
  "Intraentreno",
  "Notas"
];

const PEAK_MODE_LOG_HEADERS = [
  "Timestamp",
  "Fecha",
  "Nombre",
  "Usuario",
  "Modo",
  "Peso en ayunas (kg)",
  "Peso nocturno (kg)",
  "Pasos diarios",
  "Ingesta de agua (L)",
  "Piezas de fruta",
  "Raciones de verdura",
  "Raciones de cereales integrales",
  "Escala de hambre (1-5)",
  "Escala de descanso (1-5)",
  "Horas de sueno",
  "Escala de estres (0-5)",
  "Molestias digestivas (0-5)",
  "Cumplimiento del plan (1-5)",
  "Sesion de entreno",
  "Doble sesion"
];

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

function isValidSpreadsheetId(value: string | undefined): value is string {
  if (!value) return false;
  return /^[A-Za-z0-9-_]{20,}$/.test(value.trim());
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "");
}

function parseUserPermission(value: string | undefined): "user" | "admin" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "admin") return "admin";
  return "user";
}

function getUsernameVariants(username: string): Set<string> {
  const clean = normalizeUsername(username);
  if (!clean) return new Set();
  return new Set([clean, `@${clean}`]);
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "yes", "y", "on"].includes(normalized);
}

function normalizeRoutineEffortLevel(
  value: string | undefined,
  fallback: RoutineEffortLevel
): RoutineEffortLevel {
  const normalized = String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (normalized === "alto") return "alto";
  if (normalized === "medio") return "medio";
  if (normalized === "bajo") return "bajo";
  return fallback;
}

function normalizeComparableValue(value: string | undefined): string {
  return String(value ?? "").trim();
}

function isFalseLike(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["0", "false", "no", "off", "inactivo"].includes(normalized);
}

function looksLikeExerciseHeader(row: string[]): boolean {
  const first = normalizeHeader(row[0] ?? "");
  const second = normalizeHeader(row[1] ?? "");
  return (
    ["grupo muscular", "grupo", "musculo", "musculo principal"].includes(first) &&
    ["ejercicio", "exercise", "nombre"].includes(second)
  );
}

function toGroupedExercises(items: RoutineExercise[]): RoutineExerciseGroup[] {
  const grouped = new Map<string, string[]>();
  for (const item of items) {
    const list = grouped.get(item.muscleGroup) ?? [];
    if (!list.includes(item.exercise)) list.push(item.exercise);
    grouped.set(item.muscleGroup, list);
  }

  return Array.from(grouped.entries()).map(([muscleGroup, exercises]) => ({
    muscleGroup,
    exercises: [...exercises].sort((a, b) => a.localeCompare(b, "es"))
  }));
}

function parseRoutineExerciseRows(values: string[][]): RoutineExercise[] {
  if (!values.length) return [];
  const dataRows = looksLikeExerciseHeader(values[0]) ? values.slice(1) : values;

  return dataRows
    .map((row) => ({
      muscleGroup: String(row[0] ?? "").trim(),
      exercise: String(row[1] ?? "").trim(),
      active: !isFalseLike(row[2])
    }))
    .filter((row) => row.active && row.muscleGroup && row.exercise)
    .map((row) => ({
      muscleGroup: row.muscleGroup,
      exercise: row.exercise
    }));
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
    initialWorksheetTitle?: string;
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

  const sheets = await getSheetsClient();
  const initialTitle = options.initialWorksheetTitle?.trim() || "Sheet1";
  const create = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: name },
      sheets: [{ properties: { title: initialTitle } }]
    },
    fields: "spreadsheetId,sheets.properties.title"
  });
  const createdId = create.data.spreadsheetId;
  if (!createdId) {
    throw new Error(`Failed to create spreadsheet "${name}".`);
  }

  spreadsheetIdCache.set(name, createdId);
  worksheetTitleCache.set(createdId, initialTitle);
  worksheetNamesCache.set(createdId, new Set([initialTitle]));
  return createdId;
}

async function getWorksheetTitles(spreadsheetId: string): Promise<Set<string>> {
  const cached = worksheetNamesCache.get(spreadsheetId);
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

  worksheetNamesCache.set(spreadsheetId, titles);
  worksheetTitleCache.set(spreadsheetId, Array.from(titles)[0]);
  return titles;
}

async function getFirstWorksheetTitle(spreadsheetId: string): Promise<string> {
  const cached = worksheetTitleCache.get(spreadsheetId);
  if (cached) return cached;
  const titles = await getWorksheetTitles(spreadsheetId);
  const first = Array.from(titles)[0];
  worksheetTitleCache.set(spreadsheetId, first);
  return first;
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
            properties: {
              title: normalizedTitle
            }
          }
        }
      ]
    }
  });

  const refreshed = new Set(titles);
  refreshed.add(normalizedTitle);
  worksheetNamesCache.set(spreadsheetId, refreshed);
}

async function resolveWorksheetName(input: {
  spreadsheetId: string;
  preferredName?: string;
  createIfMissing?: boolean;
}): Promise<string> {
  const titles = await getWorksheetTitles(input.spreadsheetId);
  const preferred = input.preferredName?.trim();

  if (preferred && titles.has(preferred)) {
    return preferred;
  }

  if (preferred && input.createIfMissing) {
    await ensureWorksheetExists(input.spreadsheetId, preferred);
    return preferred;
  }

  const first = Array.from(titles)[0];
  if (!first) {
    throw new Error(`Spreadsheet "${input.spreadsheetId}" has no worksheets.`);
  }

  return first;
}

async function getWorksheetMetadataByTitle(input: {
  spreadsheetId: string;
  worksheetName: string;
}): Promise<{ sheetId: number; title: string }> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId: input.spreadsheetId,
    fields: "sheets.properties.sheetId,sheets.properties.title"
  });

  for (const sheet of response.data.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    const sheetId = sheet.properties?.sheetId;
    if (!title || sheetId === undefined || sheetId === null) continue;
    if (title === input.worksheetName.trim()) {
      return { sheetId, title };
    }
  }

  throw new Error(
    `Worksheet "${input.worksheetName}" not found in spreadsheet "${input.spreadsheetId}".`
  );
}

async function ensureHeaderRow(input: {
  spreadsheetId: string;
  worksheetName: string;
  headers: string[];
}): Promise<void> {
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

async function ensureRoutineExerciseSheetSeeded(input: {
  spreadsheetId: string;
  worksheetName: string;
}): Promise<void> {
  const sheets = await getSheetsClient();
  const range = `'${input.worksheetName}'!A1:C`;
  const read = await sheets.spreadsheets.values.get({
    spreadsheetId: input.spreadsheetId,
    range
  });

  const values = (read.data.values as string[][] | undefined) ?? [];
  const hasAnyValue = values.some((row) => row.some((cell) => String(cell).trim()));
  if (hasAnyValue) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range: `'${input.worksheetName}'!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ROUTINE_EXERCISE_HEADERS,
        ...DEFAULT_EXERCISE_CATALOG.map((item) => [item.muscleGroup, item.exercise, "TRUE"])
      ]
    }
  });
}

async function ensureRoutineSheetsReady(): Promise<RoutineSheetsInfo> {
  const env = getEnv();
  const exerciseIdFromEnv = env.GOOGLE_ROUTINE_EXERCISES_SPREADSHEET_ID?.trim();
  const logIdFromEnv = env.GOOGLE_ROUTINE_LOGS_SPREADSHEET_ID?.trim();

  const cacheKey = [
    exerciseIdFromEnv ?? "",
    logIdFromEnv ?? "",
    env.GOOGLE_ROUTINE_SHEET_NAME,
    env.GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME,
    env.GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME
  ].join("::");

  let pending = routineSheetInitCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const directExerciseId = isValidSpreadsheetId(exerciseIdFromEnv) ? exerciseIdFromEnv : null;
      const directLogId = isValidSpreadsheetId(logIdFromEnv) ? logIdFromEnv : null;
      const hasDirectExerciseId = directExerciseId !== null;
      const hasDirectLogId = directLogId !== null;

      const exercisesSpreadsheetId = hasDirectExerciseId
        ? directExerciseId
        : await resolveSpreadsheetIdByName(env.GOOGLE_ROUTINE_SHEET_NAME, {
            createIfMissing: true,
            initialWorksheetTitle: env.GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME
          });

      const logsSpreadsheetId = hasDirectLogId ? directLogId : exercisesSpreadsheetId;

      const exercisesWorksheetName = await resolveWorksheetName({
        spreadsheetId: exercisesSpreadsheetId,
        preferredName: env.GOOGLE_ROUTINE_EXERCISES_WORKSHEET_NAME,
        createIfMissing: !hasDirectExerciseId
      });

      const logsWorksheetName = await resolveWorksheetName({
        spreadsheetId: logsSpreadsheetId,
        preferredName: env.GOOGLE_ROUTINE_LOGS_WORKSHEET_NAME,
        createIfMissing: !hasDirectLogId && logsSpreadsheetId === exercisesSpreadsheetId
      });

      await Promise.all([
        ensureRoutineExerciseSheetSeeded({
          spreadsheetId: exercisesSpreadsheetId,
          worksheetName: exercisesWorksheetName
        }),
        ensureHeaderRow({
          spreadsheetId: logsSpreadsheetId,
          worksheetName: logsWorksheetName,
          headers: ROUTINE_LOG_HEADERS
        })
      ]);

      return {
        exercisesSpreadsheetId,
        logsSpreadsheetId,
        exercisesWorksheetName,
        logsWorksheetName
      };
    })();
    routineSheetInitCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    routineSheetInitCache.delete(cacheKey);
    throw error;
  }
}

async function ensurePeakModeSheetReady(): Promise<PeakModeSheetInfo> {
  const env = getEnv();
  const directSheetId = env.GOOGLE_PEAK_MODE_SPREADSHEET_ID?.trim();
  const hasDirectId = isValidSpreadsheetId(directSheetId);

  const cacheKey = [
    hasDirectId ? directSheetId : "",
    env.GOOGLE_PEAK_MODE_SHEET_NAME,
    env.GOOGLE_PEAK_MODE_WORKSHEET_NAME
  ].join("::");

  let pending = peakModeSheetInitCache.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      const spreadsheetId = hasDirectId
        ? (directSheetId as string)
        : await resolveSpreadsheetIdByName(env.GOOGLE_PEAK_MODE_SHEET_NAME, {
            createIfMissing: true,
            initialWorksheetTitle: env.GOOGLE_PEAK_MODE_WORKSHEET_NAME
          });

      const worksheetName = await resolveWorksheetName({
        spreadsheetId,
        preferredName: env.GOOGLE_PEAK_MODE_WORKSHEET_NAME,
        createIfMissing: !hasDirectId
      });

      await ensureHeaderRow({
        spreadsheetId,
        worksheetName,
        headers: PEAK_MODE_LOG_HEADERS
      });

      return { spreadsheetId, worksheetName };
    })();

    peakModeSheetInitCache.set(cacheKey, pending);
  }

  try {
    return await pending;
  } catch (error) {
    peakModeSheetInitCache.delete(cacheKey);
    throw error;
  }
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
  const emailCol = headers.findIndex((h) => ["email", "correo", "mail"].includes(h));
  const permissionCol = headers.findIndex((h) =>
    ["permisos", "permiso", "permissions", "permission", "rol", "role"].includes(h)
  );

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
      email: emailCol >= 0 ? row[emailCol]?.trim() ?? "" : "",
      permission: parseUserPermission(permissionCol >= 0 ? row[permissionCol] : undefined),
      passwordColumn: passwordCol
    }))
    .filter((u) => u.username);
}

async function getUsersSheetContext(): Promise<{
  spreadsheetId: string;
  worksheetName: string;
  columns: UsersSheetColumns;
}> {
  const env = getEnv();
  const spreadsheetId = await resolveSpreadsheetIdByName(env.GOOGLE_USERS_SHEET_NAME);
  const worksheetName = await getFirstWorksheetTitle(spreadsheetId);
  const values = await getValuesBySheetName(env.GOOGLE_USERS_SHEET_NAME, "A1:Z1", worksheetName);
  const headers = (values[0] ?? []).map(normalizeHeader);

  const usernameCol = headers.findIndex((h) =>
    ["usuario", "username", "telegram", "user"].includes(h)
  );
  const passwordCol = headers.findIndex((h) =>
    ["contrasenas", "contrasena", "password"].includes(h)
  );
  const nameCol = headers.findIndex((h) => ["nombre", "name"].includes(h));
  const emailCol = headers.findIndex((h) => ["email", "correo", "mail"].includes(h));
  const permissionCol = headers.findIndex((h) =>
    ["permisos", "permiso", "permissions", "permission", "rol", "role"].includes(h)
  );

  if (usernameCol === -1 || passwordCol === -1 || nameCol === -1) {
    throw new Error(
      'Users sheet must include "Nombre", "Usuario" and "contrasenas" columns.'
    );
  }

  return {
    spreadsheetId,
    worksheetName,
    columns: {
      usernameCol,
      passwordCol,
      nameCol,
      emailCol,
      permissionCol
    }
  };
}

export async function createUserInSheet(input: {
  name: string;
  username: string;
  passwordHash: string;
  email?: string;
  permission: "user" | "admin";
}): Promise<void> {
  const context = await getUsersSheetContext();
  const sheets = await getSheetsClient();
  const maxCol = Math.max(
    context.columns.usernameCol,
    context.columns.passwordCol,
    context.columns.nameCol,
    context.columns.emailCol,
    context.columns.permissionCol
  );
  const row = Array.from({ length: maxCol + 1 }, () => "");
  row[context.columns.nameCol] = input.name.trim();
  row[context.columns.usernameCol] = normalizeUsername(input.username);
  row[context.columns.passwordCol] = input.passwordHash.trim();
  if (context.columns.emailCol >= 0) {
    row[context.columns.emailCol] = (input.email ?? "").trim();
  }
  if (context.columns.permissionCol >= 0) {
    row[context.columns.permissionCol] = input.permission;
  }

  const endCol = indexToA1Column(maxCol);
  await sheets.spreadsheets.values.append({
    spreadsheetId: context.spreadsheetId,
    range: `'${context.worksheetName}'!A:${endCol}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [row]
    }
  });
}

export async function deleteUserFromSheetByUsername(username: string): Promise<boolean> {
  const cleanUsername = normalizeUsername(username).toLowerCase();
  if (!cleanUsername) return false;

  const users = await readUsersFromSheet();
  const targetUser = users.find(
    (user) => normalizeUsername(user.username).toLowerCase() === cleanUsername
  );
  if (!targetUser) return false;

  const context = await getUsersSheetContext();
  const worksheetMeta = await getWorksheetMetadataByTitle({
    spreadsheetId: context.spreadsheetId,
    worksheetName: context.worksheetName
  });
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: context.spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: worksheetMeta.sheetId,
              dimension: "ROWS",
              startIndex: targetUser.rowNumber - 1,
              endIndex: targetUser.rowNumber
            }
          }
        }
      ]
    }
  });

  return true;
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

  const usernameVariants = getUsernameVariants(username);

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

type RevisionSheetRow = RevisionRow & {
  rowNumber: number;
};

async function listRevisionSheetRowsForUser(username: string): Promise<RevisionSheetRow[]> {
  const env = getEnv();
  const sheets = await getSheetsClient();
  const spreadsheetId = await resolveSpreadsheetIdByName(env.GOOGLE_REVISION_SHEET_NAME);
  const usernameVariants = getUsernameVariants(username);

  const values = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${env.GOOGLE_REVISION_WORKSHEET_NAME}'!A2:E`,
    valueRenderOption: "FORMULA",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];

  return rows
    .map((row, index) => ({
      rowNumber: index + 2,
      nombre: String(row[0] ?? ""),
      fecha: String(row[1] ?? ""),
      usuario: String(row[2] ?? ""),
      pregunta: String(row[3] ?? ""),
      respuesta: String(row[4] ?? "")
    }))
    .filter((row) => usernameVariants.has(row.usuario.trim()));
}

export async function deleteRevisionRowsByDateForUser(input: {
  username: string;
  date: string;
}): Promise<number> {
  const env = getEnv();
  const spreadsheetId = await resolveSpreadsheetIdByName(env.GOOGLE_REVISION_SHEET_NAME);
  const allRows = await listRevisionSheetRowsForUser(input.username);
  const rowsToDelete = allRows.filter(
    (row) => normalizeComparableValue(row.fecha) === normalizeComparableValue(input.date)
  );
  if (!rowsToDelete.length) return 0;

  const worksheetMeta = await getWorksheetMetadataByTitle({
    spreadsheetId,
    worksheetName: env.GOOGLE_REVISION_WORKSHEET_NAME
  });

  const sheets = await getSheetsClient();
  const sortedRows = [...rowsToDelete].sort((a, b) => b.rowNumber - a.rowNumber);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: sortedRows.map((row) => ({
        deleteDimension: {
          range: {
            sheetId: worksheetMeta.sheetId,
            dimension: "ROWS",
            startIndex: row.rowNumber - 1,
            endIndex: row.rowNumber
          }
        }
      }))
    }
  });

  return rowsToDelete.length;
}

export async function readRoutineExerciseCatalog(): Promise<RoutineExerciseGroup[]> {
  const routineSheets = await ensureRoutineSheetsReady();
  const sheets = await getSheetsClient();

  const values = await sheets.spreadsheets.values.get({
    spreadsheetId: routineSheets.exercisesSpreadsheetId,
    range: `'${routineSheets.exercisesWorksheetName}'!A1:C`,
    valueRenderOption: "FORMATTED_VALUE"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];

  const parsed = parseRoutineExerciseRows(rows);
  if (parsed.length) return toGroupedExercises(parsed);
  return toGroupedExercises(DEFAULT_EXERCISE_CATALOG);
}

export async function appendRoutineLogs(rows: RoutineLogRow[]): Promise<void> {
  if (!rows.length) return;
  const routineSheets = await ensureRoutineSheetsReady();
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.append({
    spreadsheetId: routineSheets.logsSpreadsheetId,
    range: `'${routineSheets.logsWorksheetName}'!A:O`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: rows.map((row) => [
        row.timestamp,
        row.nombre,
        row.usuario,
        row.fechaSesion,
        row.dia,
        row.grupoMuscular,
        row.ejercicio,
        row.series,
        row.repeticiones,
        row.pesoKg === null ? "" : row.pesoKg,
        row.erp,
        row.nivelFatiga,
        row.molestiasGastrointestinales,
        row.intraentreno ? "SI" : "NO",
        row.notas
      ])
    }
  });
}

type RoutineLogSheetRow = RoutineLogRow & {
  rowNumber: number;
};

async function listRoutineLogSheetRowsForUser(username: string): Promise<RoutineLogSheetRow[]> {
  const routineSheets = await ensureRoutineSheetsReady();
  const sheets = await getSheetsClient();
  const usernameVariants = getUsernameVariants(username);

  const values = await sheets.spreadsheets.values.get({
    spreadsheetId: routineSheets.logsSpreadsheetId,
    range: `'${routineSheets.logsWorksheetName}'!A2:O`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];

  const parsed: RoutineLogSheetRow[] = [];
  rows.forEach((row, index) => {
    const usuario = String(row[2] ?? "").trim();
    if (!usernameVariants.has(usuario)) return;

    const isExtendedLayout = row.length >= 14;
    const seriesIndex = isExtendedLayout ? 7 : -1;
    const repsIndex = isExtendedLayout ? 8 : 7;
    const weightIndex = isExtendedLayout ? 9 : 8;
    const erpIndex = isExtendedLayout ? 10 : -1;
    const nivelFatigaIndex = isExtendedLayout ? 11 : -1;
    const molestiasIndex = isExtendedLayout ? 12 : -1;
    const intraentrenoIndex = isExtendedLayout ? 13 : -1;
    const notesIndex = isExtendedLayout ? 14 : 9;

    const series = seriesIndex >= 0 ? parseNumber(row[seriesIndex]) : 1;
    const repeticiones = parseNumber(row[repsIndex]);
    if (repeticiones === null) return;

    const parsedSeries = series === null || series <= 0 ? 1 : Math.trunc(series);
    const parsedErp = erpIndex >= 0 ? parseNumber(row[erpIndex]) : 7;
    const erp = parsedErp === null ? 7 : Math.max(1, Math.min(10, Math.trunc(parsedErp)));

    parsed.push({
      rowNumber: index + 2,
      timestamp: String(row[0] ?? ""),
      nombre: String(row[1] ?? ""),
      usuario,
      fechaSesion: String(row[3] ?? ""),
      dia: String(row[4] ?? ""),
      grupoMuscular: String(row[5] ?? ""),
      ejercicio: String(row[6] ?? ""),
      series: parsedSeries,
      repeticiones,
      pesoKg: parseNumber(row[weightIndex]),
      erp,
      nivelFatiga: normalizeRoutineEffortLevel(
        nivelFatigaIndex >= 0 ? row[nivelFatigaIndex] : undefined,
        "medio"
      ),
      molestiasGastrointestinales: normalizeRoutineEffortLevel(
        molestiasIndex >= 0 ? row[molestiasIndex] : undefined,
        "bajo"
      ),
      intraentreno: intraentrenoIndex >= 0 ? parseBoolean(row[intraentrenoIndex]) : false,
      notas: String(row[notesIndex] ?? "")
    });
  });

  return parsed.sort((a, b) => {
    const byDate = b.fechaSesion.localeCompare(a.fechaSesion);
    if (byDate !== 0) return byDate;
    return b.timestamp.localeCompare(a.timestamp);
  });
}

function matchesRoutineTarget(row: RoutineLogSheetRow, target: RoutineSessionTarget): boolean {
  return (
    normalizeComparableValue(row.timestamp) === normalizeComparableValue(target.timestamp) &&
    normalizeComparableValue(row.fechaSesion) === normalizeComparableValue(target.sessionDate) &&
    normalizeComparableValue(row.dia) === normalizeComparableValue(target.day)
  );
}

export async function listRoutineLogsForUser(username: string): Promise<RoutineLogRow[]> {
  const parsed = await listRoutineLogSheetRowsForUser(username);

  return parsed.map((row) => ({
    timestamp: row.timestamp,
    nombre: row.nombre,
    usuario: row.usuario,
    fechaSesion: row.fechaSesion,
    dia: row.dia,
    grupoMuscular: row.grupoMuscular,
    ejercicio: row.ejercicio,
    series: row.series,
    repeticiones: row.repeticiones,
    pesoKg: row.pesoKg,
    erp: row.erp,
    nivelFatiga: row.nivelFatiga,
    molestiasGastrointestinales: row.molestiasGastrointestinales,
    intraentreno: row.intraentreno,
    notas: row.notas
  }));
}

export async function deleteRoutineSessionForUser(input: {
  username: string;
  target: RoutineSessionTarget;
}): Promise<number> {
  const routineSheets = await ensureRoutineSheetsReady();
  const allRows = await listRoutineLogSheetRowsForUser(input.username);
  const rowsToDelete = allRows.filter((row) => matchesRoutineTarget(row, input.target));
  if (!rowsToDelete.length) return 0;

  const worksheetMeta = await getWorksheetMetadataByTitle({
    spreadsheetId: routineSheets.logsSpreadsheetId,
    worksheetName: routineSheets.logsWorksheetName
  });

  const sheets = await getSheetsClient();
  const sortedRows = [...rowsToDelete].sort((a, b) => b.rowNumber - a.rowNumber);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: routineSheets.logsSpreadsheetId,
    requestBody: {
      requests: sortedRows.map((row) => ({
        deleteDimension: {
          range: {
            sheetId: worksheetMeta.sheetId,
            dimension: "ROWS",
            startIndex: row.rowNumber - 1,
            endIndex: row.rowNumber
          }
        }
      }))
    }
  });

  return rowsToDelete.length;
}

export async function replaceRoutineSessionForUser(input: {
  username: string;
  name: string;
  target: RoutineSessionTarget;
  nextSessionDate: string;
  nextDayLabel: string;
  entries: Array<{
    muscleGroup: string;
    exercise: string;
    series: number;
    reps: number;
    weightKg: number | null;
    erp: number;
    fatigueLevel: RoutineEffortLevel;
    digestiveDiscomfortLevel: RoutineEffortLevel;
    usedIntraWorkout: boolean;
    notes?: string;
  }>;
}): Promise<number> {
  const deletedCount = await deleteRoutineSessionForUser({
    username: input.username,
    target: input.target
  });
  if (!deletedCount) return 0;

  const timestamp = normalizeComparableValue(input.target.timestamp) || new Date().toISOString();
  const rows: RoutineLogRow[] = input.entries.map((entry) => ({
    timestamp,
    nombre: input.name,
    usuario: input.username,
    fechaSesion: input.nextSessionDate,
    dia: input.nextDayLabel,
    grupoMuscular: entry.muscleGroup,
    ejercicio: entry.exercise,
    series: entry.series,
    repeticiones: entry.reps,
    pesoKg: entry.weightKg ?? null,
    erp: entry.erp,
    nivelFatiga: entry.fatigueLevel,
    molestiasGastrointestinales: entry.digestiveDiscomfortLevel,
    intraentreno: entry.usedIntraWorkout,
    notas: entry.notes?.trim() ?? ""
  }));

  await appendRoutineLogs(rows);
  return rows.length;
}

type PeakModeDailySheetRow = PeakModeDailyLogRow & {
  rowNumber: number;
};

function toPeakModeLogValues(row: PeakModeDailyLogRow): Array<string | number> {
  return [
    row.timestamp,
    row.fecha,
    row.nombre,
    row.usuario,
    row.modo,
    row.pesoAyunasKg,
    row.pesoNocturnoKg,
    row.pasosDiarios,
    row.aguaLitros,
    row.frutaPiezas,
    row.verduraRaciones,
    row.cerealesIntegralesRaciones,
    row.hambreEscala,
    row.descansoEscala,
    row.horasSueno,
    row.estresEscala,
    row.molestiasDigestivasEscala,
    row.cumplimientoPlanEscala,
    row.tuvoEntreno ? "SI" : "NO",
    row.dobleSesion ? "SI" : "NO"
  ];
}

async function listPeakModeDailySheetRowsForUser(username: string): Promise<PeakModeDailySheetRow[]> {
  const peakSheet = await ensurePeakModeSheetReady();
  const sheets = await getSheetsClient();
  const usernameVariants = getUsernameVariants(username);

  const values = await sheets.spreadsheets.values.get({
    spreadsheetId: peakSheet.spreadsheetId,
    range: `'${peakSheet.worksheetName}'!A2:T`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  const rows = (values.data.values as string[][] | undefined) ?? [];

  const parsed: PeakModeDailySheetRow[] = [];
  rows.forEach((row, index) => {
    const usuario = String(row[3] ?? "").trim();
    if (!usernameVariants.has(usuario)) return;

    const modo = String(row[4] ?? "").trim().toLowerCase();
    if (modo !== "titan" && modo !== "diablo") return;

    const fecha = String(row[1] ?? "").trim();
    if (!fecha) return;

    const pesoAyunasKg = parseNumber(row[5]);
    const pesoNocturnoKg = parseNumber(row[6]);
    const pasosDiarios = parseNumber(row[7]);
    const aguaLitros = parseNumber(row[8]);
    const frutaPiezas = parseNumber(row[9]);
    const verduraRaciones = parseNumber(row[10]);
    const cerealesIntegralesRaciones = parseNumber(row[11]);
    const hambreEscala = parseNumber(row[12]);
    const descansoEscala = parseNumber(row[13]);
    const horasSueno = parseNumber(row[14]);
    const estresEscala = parseNumber(row[15]);
    const molestiasDigestivasEscala = parseNumber(row[16]);
    const cumplimientoPlanEscala = parseNumber(row[17]);

    if (
      pesoAyunasKg === null ||
      pesoNocturnoKg === null ||
      pasosDiarios === null ||
      aguaLitros === null ||
      frutaPiezas === null ||
      verduraRaciones === null ||
      cerealesIntegralesRaciones === null ||
      hambreEscala === null ||
      descansoEscala === null ||
      horasSueno === null ||
      estresEscala === null ||
      molestiasDigestivasEscala === null ||
      cumplimientoPlanEscala === null
    ) {
      return;
    }

    parsed.push({
      rowNumber: index + 2,
      timestamp: String(row[0] ?? "").trim(),
      fecha,
      nombre: String(row[2] ?? "").trim(),
      usuario,
      modo,
      pesoAyunasKg,
      pesoNocturnoKg,
      pasosDiarios,
      aguaLitros,
      frutaPiezas,
      verduraRaciones,
      cerealesIntegralesRaciones,
      hambreEscala,
      descansoEscala,
      horasSueno,
      estresEscala,
      molestiasDigestivasEscala,
      cumplimientoPlanEscala,
      tuvoEntreno: parseBoolean(row[18]),
      dobleSesion: parseBoolean(row[19])
    });
  });

  return parsed.sort((a, b) => {
    const byDate = a.fecha.localeCompare(b.fecha);
    if (byDate !== 0) return byDate;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

export async function listPeakModeDailyLogsForUser(username: string): Promise<PeakModeDailyLogRow[]> {
  const rows = await listPeakModeDailySheetRowsForUser(username);
  return rows.map(({ rowNumber: _rowNumber, ...row }) => row);
}

export async function upsertPeakModeDailyLogForUser(input: {
  username: string;
  row: PeakModeDailyLogRow;
}): Promise<void> {
  const peakSheet = await ensurePeakModeSheetReady();
  const sheets = await getSheetsClient();

  const existingRows = await listPeakModeDailySheetRowsForUser(input.username);
  const normalizedDate = normalizeComparableValue(input.row.fecha);
  const target = existingRows
    .filter((row) => normalizeComparableValue(row.fecha) === normalizedDate)
    .sort((a, b) => b.rowNumber - a.rowNumber)[0];

  if (target) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: peakSheet.spreadsheetId,
      range: `'${peakSheet.worksheetName}'!A${target.rowNumber}:T${target.rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [toPeakModeLogValues(input.row)]
      }
    });
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: peakSheet.spreadsheetId,
    range: `'${peakSheet.worksheetName}'!A:T`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [toPeakModeLogValues(input.row)]
    }
  });
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
