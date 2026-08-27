import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import {
  isGoogleAlreadyExistsError,
  isGoogleRateLimitError,
  withGoogleApiRetry
} from "@/lib/google/retry";
import { DEFAULT_NUTRITION_FOODS } from "@/lib/nutrition/default-foods";
import {
  ALLERGY_RESTRICTION_OPTIONS,
  DIET_RESTRICTION_OPTIONS,
  INTOLERANCE_RESTRICTION_OPTIONS,
  inferRestrictionTagsForFood,
  parseRestrictionTags,
  serializeRestrictionTags
} from "@/lib/nutrition/restrictions";
import type {
  AthletePrivateNote,
  NutritionAthleteRestriction,
  NutritionAthleteRestrictionKey,
  NutritionAthleteRestrictionType,
  NutritionChangeRequest,
  NutritionChangeRequestStatus,
  NutritionFood,
  NutritionMealCompletion,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionPlanFull,
  NutritionPlanMeal,
  NutritionPlanStatus,
  NutritionPlanSummary,
  NutritionPlanVersion
} from "@/lib/nutrition/types";

type NutritionSheetsInfo = {
  spreadsheetId: string;
  foodsWorksheet: string;
  plansWorksheet: string;
  mealsWorksheet: string;
  planFoodsWorksheet: string;
  versionsWorksheet: string;
  athleteRestrictionsWorksheet: string;
  athletePrivateNotesWorksheet: string;
  mealCompletionsWorksheet: string;
  changeRequestsWorksheet: string;
};

type StoredNutritionPlanVersion = NutritionPlanVersion & {
  snapshotJson: string;
};

type NutritionDataset = {
  foods: NutritionFood[];
  plans: NutritionPlanSummary[];
  meals: NutritionPlanMeal[];
  entries: NutritionPlanFoodEntry[];
  versions: StoredNutritionPlanVersion[];
  restrictions: NutritionAthleteRestriction[];
};

const NUTRITION_DATASET_CACHE_TTL_MS = 2 * 60_000;
const CHANGE_REQUEST_CACHE_TTL_MS = 2 * 60_000;

let nutritionDatasetCache: { expiresAt: number; value: NutritionDataset } | null = null;
let nutritionDatasetReadPromise: Promise<NutritionDataset> | null = null;
let nutritionDatasetCacheVersion = 0;
let changeRequestsCache: { expiresAt: number; value: NutritionChangeRequest[] } | null = null;
let changeRequestsReadPromise: Promise<NutritionChangeRequest[]> | null = null;
let changeRequestsCacheVersion = 0;

const WORKSHEETS = {
  foods: "Foods",
  plans: "Plans",
  meals: "Meals",
  planFoods: "PlanFoods",
  versions: "PlanVersions",
  athleteRestrictions: "AthleteRestrictions",
  athletePrivateNotes: "AthletePrivateNotes",
  mealCompletions: "MealCompletions",
  changeRequests: "ChangeRequests"
} as const;

const NUTRITION_DATASET_WORKSHEETS = new Set<string>([
  WORKSHEETS.foods,
  WORKSHEETS.plans,
  WORKSHEETS.meals,
  WORKSHEETS.planFoods,
  WORKSHEETS.versions,
  WORKSHEETS.athleteRestrictions
]);

function cacheNutritionDataset(dataset: NutritionDataset): void {
  nutritionDatasetCache = {
    expiresAt: Date.now() + NUTRITION_DATASET_CACHE_TTL_MS,
    value: dataset
  };
}

function invalidateNutritionDatasetCache(): void {
  nutritionDatasetCache = null;
  nutritionDatasetReadPromise = null;
  nutritionDatasetCacheVersion += 1;
}

function cacheChangeRequests(requests: NutritionChangeRequest[]): void {
  changeRequestsCache = {
    expiresAt: Date.now() + CHANGE_REQUEST_CACHE_TTL_MS,
    value: requests
  };
}

function invalidateChangeRequestsCache(): void {
  changeRequestsCache = null;
  changeRequestsReadPromise = null;
  changeRequestsCacheVersion += 1;
}

function invalidateWorksheetCaches(worksheetName: string): void {
  if (NUTRITION_DATASET_WORKSHEETS.has(worksheetName)) {
    invalidateNutritionDatasetCache();
  }
  if (worksheetName === WORKSHEETS.changeRequests) {
    invalidateChangeRequestsCache();
  }
}

const FOOD_HEADERS = [
  "Id",
  "Nombre",
  "Categoria",
  "Unidad referencia",
  "Proteinas g 100g",
  "Carbohidratos g 100g",
  "Grasas g 100g",
  "Sodio mg 100g",
  "Agua g 100g",
  "Activo",
  "Creado",
  "Actualizado",
  "Etiquetas restricciones"
];

const PLAN_HEADERS = [
  "Id",
  "Usuario atleta",
  "Nombre atleta",
  "Nombre plan",
  "Estado",
  "Objetivo proteinas g",
  "Objetivo carbohidratos g",
  "Objetivo grasas g",
  "Notas",
  "Creado",
  "Actualizado",
  "Publicado",
  "Drive file id publicado",
  "Version"
];

const MEAL_HEADERS = [
  "Id",
  "Plan id",
  "Nombre",
  "Orden",
  "Notas",
  "Incluida",
  "Creado",
  "Actualizado"
];

const PLAN_FOOD_HEADERS = [
  "Id",
  "Plan id",
  "Meal id",
  "Food id catalogo",
  "Nombre alimento",
  "Cantidad g",
  "Proteinas 100g snapshot",
  "Carbohidratos 100g snapshot",
  "Grasas 100g snapshot",
  "Sodio 100g snapshot",
  "Agua 100g snapshot",
  "Orden",
  "Texto personalizado",
  "Creado",
  "Actualizado",
  "Alternativas json"
];

const VERSION_HEADERS = [
  "Id",
  "Plan id",
  "Usuario atleta",
  "Version",
  "Publicado",
  "Drive file id",
  "Nombre archivo",
  "Snapshot json"
];

const ATHLETE_RESTRICTION_HEADERS = [
  "Id",
  "Usuario atleta",
  "Tipo",
  "Clave",
  "Food id",
  "Etiqueta",
  "Notas",
  "Creado",
  "Actualizado"
];

const ATHLETE_PRIVATE_NOTE_HEADERS = ["Usuario atleta", "Notas privadas", "Actualizado"];

const MEAL_COMPLETION_HEADERS = [
  "Id",
  "Usuario atleta",
  "Fecha",
  "Plan id",
  "Meal id",
  "Completada",
  "Actualizado"
];

const CHANGE_REQUEST_HEADERS = [
  "Id",
  "Usuario atleta",
  "Nombre atleta",
  "Plan id",
  "Nombre plan",
  "Meal id",
  "Nombre comida",
  "Entry id",
  "Food id original",
  "Alimento original",
  "Cantidad original g",
  "Food id solicitado",
  "Alimento solicitado",
  "Cantidad solicitada g",
  "Estado",
  "Notas atleta",
  "Notas admin",
  "Creado",
  "Actualizado",
  "Resuelto",
  "Resuelto por"
];

let nutritionSheetsPromise: Promise<NutritionSheetsInfo> | null = null;
const worksheetNamesCache = new Map<string, Set<string>>();

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function normalizeTextKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function escapeDriveQuery(value: string): string {
  return value.replace(/'/g, "\\'");
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

function isValidSpreadsheetId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9-_]{20,}$/.test(value.trim()));
}

function parseNumber(value: unknown): number {
  const normalized = String(value ?? "").replace(",", ".").trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: unknown): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseBoolean(value: unknown, fallback = true): boolean {
  const normalized = normalizeTextKey(String(value ?? ""));
  if (!normalized) return fallback;
  if (["si", "yes", "true", "1", "activo", "active"].includes(normalized)) return true;
  if (["no", "false", "0", "inactivo", "inactive"].includes(normalized)) return false;
  return fallback;
}

function isIsoDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseStatus(value: unknown): NutritionPlanStatus {
  const normalized = normalizeTextKey(String(value ?? ""));
  if (normalized === "published" || normalized === "publicado") return "published";
  if (normalized === "review" || normalized === "en revision") return "review";
  return "draft";
}

function parseChangeRequestStatus(value: unknown): NutritionChangeRequestStatus {
  const normalized = normalizeTextKey(String(value ?? ""));
  if (normalized === "approved" || normalized === "aprobada" || normalized === "aprobado") {
    return "approved";
  }
  if (normalized === "denied" || normalized === "rechazada" || normalized === "rechazado") {
    return "denied";
  }
  return "pending";
}

function toSheetBoolean(value: boolean): string {
  return value ? "SI" : "NO";
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampQuantityG(value: number): number {
  return clampInteger(value, 1, 10000);
}

function sanitizeName(value: string, fallback: string): string {
  const clean = value.trim();
  return clean || fallback;
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function sanitizeAlternative(
  alternative: NutritionPlanFoodAlternative,
  entryId: string,
  index: number,
  now: string
): NutritionPlanFoodAlternative {
  return {
    id: alternative.id || randomUUID(),
    entryId,
    foodId: alternative.foodId,
    foodName: sanitizeName(alternative.foodName, "Alternativa").slice(0, 160),
    quantityG: clampQuantityG(alternative.quantityG),
    proteinPer100g: clampNumber(alternative.proteinPer100g, 0, 200),
    carbsPer100g: clampNumber(alternative.carbsPer100g, 0, 200),
    fatPer100g: clampNumber(alternative.fatPer100g, 0, 200),
    sodiumPer100g: clampNumber(alternative.sodiumPer100g, 0, 100000),
    waterPer100g: clampNumber(alternative.waterPer100g, 0, 100),
    position: index + 1,
    customText: alternative.customText.trim().slice(0, 240),
    createdAt: alternative.createdAt || now,
    updatedAt: now
  };
}

function getAthleteRestrictionOption(
  type: NutritionAthleteRestrictionType,
  key: NutritionAthleteRestrictionKey
) {
  if (type === "allergy") return ALLERGY_RESTRICTION_OPTIONS.find((option) => option.key === key);
  if (type === "intolerance") return INTOLERANCE_RESTRICTION_OPTIONS.find((option) => option.key === key);
  if (type === "diet") return DIET_RESTRICTION_OPTIONS.find((option) => option.key === key);
  return null;
}

function parseRestrictionType(value: unknown): NutritionAthleteRestrictionType {
  const normalized = normalizeTextKey(String(value ?? ""));
  if (normalized === "allergy" || normalized === "alergia") return "allergy";
  if (normalized === "dislike" || normalized === "no le gusta" || normalized === "rechazo") return "dislike";
  if (normalized === "diet" || normalized === "dieta" || normalized === "preferencia") return "diet";
  return "intolerance";
}

async function getDriveClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive"]);
  return google.drive({ version: "v3", auth });
}

async function getSheetsClient() {
  const auth = getGoogleAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  return google.sheets({ version: "v4", auth });
}

async function findSpreadsheetInFolder(name: string, folderId: string): Promise<string | null> {
  const drive = await getDriveClient();
  const query = [
    `name='${escapeDriveQuery(name)}'`,
    "mimeType='application/vnd.google-apps.spreadsheet'",
    `'${escapeDriveQuery(folderId)}' in parents`,
    "trashed=false"
  ].join(" and ");

  const response = await withGoogleApiRetry(() =>
    drive.files.list({
      q: query,
      fields: "files(id,name,modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: 10,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true
    })
  );

  return response.data.files?.[0]?.id ?? null;
}

async function createSpreadsheetInFolder(input: {
  name: string;
  folderId: string;
  initialWorksheetTitle: string;
}): Promise<string> {
  const sheets = await getSheetsClient();
  const created = await withGoogleApiRetry(() =>
    sheets.spreadsheets.create({
      requestBody: {
        properties: { title: input.name },
        sheets: [{ properties: { title: input.initialWorksheetTitle } }]
      },
      fields: "spreadsheetId"
    })
  );

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error(`Could not create spreadsheet "${input.name}".`);

  const drive = await getDriveClient();
  const current = await withGoogleApiRetry(() =>
    drive.files.get({
      fileId: spreadsheetId,
      fields: "parents",
      supportsAllDrives: true
    })
  );
  const currentParents = (current.data.parents ?? []).join(",");
  await withGoogleApiRetry(() =>
    drive.files.update({
      fileId: spreadsheetId,
      addParents: input.folderId,
      removeParents: currentParents || undefined,
      fields: "id,parents",
      supportsAllDrives: true
    })
  );

  return spreadsheetId;
}

async function getWorksheetTitles(spreadsheetId: string): Promise<Set<string>> {
  const cached = worksheetNamesCache.get(spreadsheetId);
  if (cached) return cached;

  const sheets = await getSheetsClient();
  const response = await withGoogleApiRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title"
    })
  );

  const titles = new Set(
    (response.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title?.trim() ?? "")
      .filter(Boolean)
  );
  worksheetNamesCache.set(spreadsheetId, titles);
  return titles;
}

async function getWorksheetMetadataByTitle(input: {
  spreadsheetId: string;
  worksheetName: string;
}): Promise<{ sheetId: number; title: string }> {
  const sheets = await getSheetsClient();
  const response = await withGoogleApiRetry(() =>
    sheets.spreadsheets.get({
      spreadsheetId: input.spreadsheetId,
      fields: "sheets.properties.sheetId,sheets.properties.title"
    })
  );

  for (const sheet of response.data.sheets ?? []) {
    const title = sheet.properties?.title?.trim();
    const sheetId = sheet.properties?.sheetId;
    if (!title || sheetId === undefined || sheetId === null) continue;
    if (title === input.worksheetName.trim()) return { sheetId, title };
  }

  throw new Error(`Worksheet "${input.worksheetName}" not found.`);
}

async function ensureWorksheet(spreadsheetId: string, title: string): Promise<void> {
  const titles = await getWorksheetTitles(spreadsheetId);
  if (titles.has(title)) return;

  const sheets = await getSheetsClient();
  try {
    await withGoogleApiRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title } } }]
        }
      })
    );
  } catch (error) {
    if (!isGoogleAlreadyExistsError(error)) throw error;
  }

  const refreshed = new Set(titles);
  refreshed.add(title);
  worksheetNamesCache.set(spreadsheetId, refreshed);
}

async function ensureHeaderRows(input: {
  spreadsheetId: string;
  worksheets: Array<{ worksheetName: string; headers: string[] }>;
}): Promise<void> {
  if (!input.worksheets.length) return;

  const sheets = await getSheetsClient();
  const ranges = input.worksheets.map(({ worksheetName, headers }) => {
    const endCol = indexToA1Column(headers.length - 1);
    return `'${worksheetName}'!A1:${endCol}1`;
  });

  const existing = await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId: input.spreadsheetId,
      ranges
    })
  );

  const valueRanges = existing.data.valueRanges ?? [];
  const updates = input.worksheets.flatMap((worksheet, index) => {
    const firstRow = (valueRanges[index]?.values?.[0] as string[] | undefined) ?? [];
    const hasCurrentHeaders = worksheet.headers.every(
      (header, headerIndex) => String(firstRow[headerIndex] ?? "").trim() === header
    );
    if (hasCurrentHeaders) return [];

    const endCol = indexToA1Column(worksheet.headers.length - 1);
    return [
      {
        range: `'${worksheet.worksheetName}'!A1:${endCol}1`,
        values: [worksheet.headers]
      }
    ];
  });

  if (!updates.length) return;

  await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: input.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates
      }
    })
  );
}

async function resolveNutritionSpreadsheetId(): Promise<string> {
  const env = getEnv();
  if (isValidSpreadsheetId(env.GOOGLE_NUTRITION_MANAGEMENT_SPREADSHEET_ID)) {
    return env.GOOGLE_NUTRITION_MANAGEMENT_SPREADSHEET_ID.trim();
  }

  const name = env.GOOGLE_NUTRITION_MANAGEMENT_SHEET_NAME.trim() || "Gestion nutricional";
  const rootFolderId = env.GOOGLE_NUTRITION_PLANS_ROOT_FOLDER_ID;
  const existing = await findSpreadsheetInFolder(name, rootFolderId);
  if (existing) return existing;

  return createSpreadsheetInFolder({
    name,
    folderId: rootFolderId,
    initialWorksheetTitle: WORKSHEETS.foods
  });
}

async function ensureNutritionSheetsReady(): Promise<NutritionSheetsInfo> {
  if (nutritionSheetsPromise) return nutritionSheetsPromise;

  nutritionSheetsPromise = (async () => {
    const spreadsheetId = await resolveNutritionSpreadsheetId();
    await ensureWorksheet(spreadsheetId, WORKSHEETS.foods);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.plans);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.meals);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.planFoods);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.versions);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.athleteRestrictions);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.athletePrivateNotes);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.mealCompletions);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.changeRequests);

    await ensureHeaderRows({
      spreadsheetId,
      worksheets: [
        { worksheetName: WORKSHEETS.foods, headers: FOOD_HEADERS },
        { worksheetName: WORKSHEETS.plans, headers: PLAN_HEADERS },
        { worksheetName: WORKSHEETS.meals, headers: MEAL_HEADERS },
        { worksheetName: WORKSHEETS.planFoods, headers: PLAN_FOOD_HEADERS },
        { worksheetName: WORKSHEETS.versions, headers: VERSION_HEADERS },
        { worksheetName: WORKSHEETS.athleteRestrictions, headers: ATHLETE_RESTRICTION_HEADERS },
        { worksheetName: WORKSHEETS.athletePrivateNotes, headers: ATHLETE_PRIVATE_NOTE_HEADERS },
        { worksheetName: WORKSHEETS.mealCompletions, headers: MEAL_COMPLETION_HEADERS },
        { worksheetName: WORKSHEETS.changeRequests, headers: CHANGE_REQUEST_HEADERS }
      ]
    });

    return {
      spreadsheetId,
      foodsWorksheet: WORKSHEETS.foods,
      plansWorksheet: WORKSHEETS.plans,
      mealsWorksheet: WORKSHEETS.meals,
      planFoodsWorksheet: WORKSHEETS.planFoods,
      versionsWorksheet: WORKSHEETS.versions,
      athleteRestrictionsWorksheet: WORKSHEETS.athleteRestrictions,
      athletePrivateNotesWorksheet: WORKSHEETS.athletePrivateNotes,
      mealCompletionsWorksheet: WORKSHEETS.mealCompletions,
      changeRequestsWorksheet: WORKSHEETS.changeRequests
    };
  })();

  try {
    return await nutritionSheetsPromise;
  } catch (error) {
    nutritionSheetsPromise = null;
    throw error;
  }
}

async function readWorksheetRows(worksheetName: string, headers: string[]): Promise<string[][]> {
  const info = await ensureNutritionSheetsReady();
  const sheets = await getSheetsClient();
  const endCol = indexToA1Column(headers.length - 1);
  const response = await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: info.spreadsheetId,
      range: `'${worksheetName}'!A2:${endCol}`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING"
    })
  );
  return (response.data.values as string[][] | undefined) ?? [];
}

async function readWorksheetRowsBatch(
  worksheets: Array<{ worksheetName: string; headers: string[] }>
): Promise<string[][][]> {
  if (!worksheets.length) return [];

  const info = await ensureNutritionSheetsReady();
  const sheets = await getSheetsClient();
  const ranges = worksheets.map(({ worksheetName, headers }) => {
    const endCol = indexToA1Column(headers.length - 1);
    return `'${worksheetName}'!A2:${endCol}`;
  });

  const response = await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.batchGet({
      spreadsheetId: info.spreadsheetId,
      ranges,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING"
    })
  );
  const valueRanges = response.data.valueRanges ?? [];
  return worksheets.map((_, index) => (valueRanges[index]?.values as string[][] | undefined) ?? []);
}

async function readWorksheetRowsWithNumbers(
  worksheetName: string,
  headers: string[]
): Promise<Array<{ rowNumber: number; row: string[] }>> {
  const rows = await readWorksheetRows(worksheetName, headers);
  return rows.map((row, index) => ({ rowNumber: index + 2, row }));
}

async function appendWorksheetRows(
  worksheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>
): Promise<void> {
  if (!rows.length) return;
  const info = await ensureNutritionSheetsReady();
  const sheets = await getSheetsClient();
  const endCol = indexToA1Column(headers.length - 1);
  await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: info.spreadsheetId,
      range: `'${worksheetName}'!A:${endCol}`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: rows }
    })
  );
  invalidateWorksheetCaches(worksheetName);
}

async function updateWorksheetRowById(
  worksheetName: string,
  headers: string[],
  id: string,
  rowValues: Array<string | number>
): Promise<boolean> {
  const rows = await readWorksheetRowsWithNumbers(worksheetName, headers);
  const target = rows.find((item) => String(item.row[0] ?? "").trim() === id);
  if (!target) return false;

  const info = await ensureNutritionSheetsReady();
  const sheets = await getSheetsClient();
  const endCol = indexToA1Column(headers.length - 1);
  await withGoogleApiRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: info.spreadsheetId,
      range: `'${worksheetName}'!A${target.rowNumber}:${endCol}${target.rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [rowValues] }
    })
  );
  invalidateWorksheetCaches(worksheetName);
  return true;
}

async function deleteWorksheetRowsWhere(
  worksheetName: string,
  headers: string[],
  predicate: (row: string[]) => boolean
): Promise<number> {
  const rows = await readWorksheetRowsWithNumbers(worksheetName, headers);
  const rowsToDelete = rows.filter((item) => predicate(item.row));
  if (!rowsToDelete.length) return 0;

  const info = await ensureNutritionSheetsReady();
  const worksheetMeta = await getWorksheetMetadataByTitle({
    spreadsheetId: info.spreadsheetId,
    worksheetName
  });
  const sheets = await getSheetsClient();
  const sortedRows = rowsToDelete.sort((a, b) => b.rowNumber - a.rowNumber);
  await withGoogleApiRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: info.spreadsheetId,
      requestBody: {
        requests: sortedRows.map((item) => ({
          deleteDimension: {
            range: {
              sheetId: worksheetMeta.sheetId,
              dimension: "ROWS",
              startIndex: item.rowNumber - 1,
              endIndex: item.rowNumber
            }
          }
        }))
      }
    })
  );

  invalidateWorksheetCaches(worksheetName);
  return rowsToDelete.length;
}

function parseFood(row: string[]): NutritionFood | null {
  const id = String(row[0] ?? "").trim();
  const name = String(row[1] ?? "").trim();
  if (!id || !name) return null;
  const category = String(row[2] ?? "").trim();
  const hasStoredRestrictionTags = row.length > 12;
  const storedRestrictionTags = parseRestrictionTags(row[12]);

  return {
    id,
    name,
    category,
    referenceUnit: "100g",
    proteinPer100g: parseNumber(row[4]),
    carbsPer100g: parseNumber(row[5]),
    fatPer100g: parseNumber(row[6]),
    sodiumPer100g: parseNumber(row[7]),
    waterPer100g: parseNumber(row[8]),
    restrictionTags: hasStoredRestrictionTags
      ? storedRestrictionTags
      : inferRestrictionTagsForFood({ name, category }),
    active: parseBoolean(row[9], true),
    createdAt: String(row[10] ?? "").trim(),
    updatedAt: String(row[11] ?? "").trim()
  };
}

function parsePlan(row: string[]): NutritionPlanSummary | null {
  const id = String(row[0] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[1] ?? ""));
  const name = String(row[3] ?? "").trim();
  if (!id || !athleteUsername || !name) return null;

  return {
    id,
    athleteUsername,
    athleteName: String(row[2] ?? "").trim(),
    name,
    status: parseStatus(row[4]),
    targetProteinG: parseNumber(row[5]),
    targetCarbsG: parseNumber(row[6]),
    targetFatG: parseNumber(row[7]),
    notes: String(row[8] ?? "").trim(),
    createdAt: String(row[9] ?? "").trim(),
    updatedAt: String(row[10] ?? "").trim(),
    publishedAt: String(row[11] ?? "").trim(),
    publishedFileId: String(row[12] ?? "").trim(),
    versionNumber: parseInteger(row[13])
  };
}

function parseMeal(row: string[]): NutritionPlanMeal | null {
  const id = String(row[0] ?? "").trim();
  const planId = String(row[1] ?? "").trim();
  const name = String(row[2] ?? "").trim();
  if (!id || !planId || !name) return null;

  return {
    id,
    planId,
    name,
    position: parseInteger(row[3]),
    notes: String(row[4] ?? "").trim(),
    included: parseBoolean(row[5], true),
    createdAt: String(row[6] ?? "").trim(),
    updatedAt: String(row[7] ?? "").trim()
  };
}

function parseEntryAlternatives(value: unknown, entryId: string): NutritionPlanFoodAlternative[] {
  const raw = String(value ?? "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index): NutritionPlanFoodAlternative | null => {
        if (!item || typeof item !== "object") return null;
        const record = item as Partial<Record<keyof NutritionPlanFoodAlternative, unknown>>;
        const foodName = String(record.foodName ?? "").trim();
        if (!foodName) return null;
        const createdAt = String(record.createdAt ?? "").trim();
        const updatedAt = String(record.updatedAt ?? "").trim();

        return {
          id: String(record.id ?? "").trim() || randomUUID(),
          entryId,
          foodId: String(record.foodId ?? "").trim(),
          foodName: foodName.slice(0, 160),
          quantityG: clampQuantityG(parseNumber(record.quantityG)),
          proteinPer100g: clampNumber(parseNumber(record.proteinPer100g), 0, 200),
          carbsPer100g: clampNumber(parseNumber(record.carbsPer100g), 0, 200),
          fatPer100g: clampNumber(parseNumber(record.fatPer100g), 0, 200),
          sodiumPer100g: clampNumber(parseNumber(record.sodiumPer100g), 0, 100000),
          waterPer100g: clampNumber(parseNumber(record.waterPer100g), 0, 100),
          position: Math.max(1, parseInteger(record.position) || index + 1),
          customText: String(record.customText ?? "").trim().slice(0, 240),
          createdAt,
          updatedAt
        };
      })
      .filter((item): item is NutritionPlanFoodAlternative => Boolean(item))
      .sort((a, b) => a.position - b.position);
  } catch {
    return [];
  }
}

function parseEntry(row: string[]): NutritionPlanFoodEntry | null {
  const id = String(row[0] ?? "").trim();
  const planId = String(row[1] ?? "").trim();
  const mealId = String(row[2] ?? "").trim();
  const foodName = String(row[4] ?? "").trim();
  if (!id || !planId || !mealId || !foodName) return null;

  return {
    id,
    planId,
    mealId,
    foodId: String(row[3] ?? "").trim(),
    foodName,
    quantityG: clampQuantityG(parseNumber(row[5])),
    proteinPer100g: parseNumber(row[6]),
    carbsPer100g: parseNumber(row[7]),
    fatPer100g: parseNumber(row[8]),
    sodiumPer100g: parseNumber(row[9]),
    waterPer100g: parseNumber(row[10]),
    position: parseInteger(row[11]),
    customText: String(row[12] ?? "").trim(),
    createdAt: String(row[13] ?? "").trim(),
    updatedAt: String(row[14] ?? "").trim(),
    alternatives: parseEntryAlternatives(row[15], id)
  };
}

function parseVersion(row: string[]): StoredNutritionPlanVersion | null {
  const id = String(row[0] ?? "").trim();
  const planId = String(row[1] ?? "").trim();
  const driveFileId = String(row[5] ?? "").trim();
  if (!id || !planId || !driveFileId) return null;

  return {
    id,
    planId,
    athleteUsername: normalizeUsername(String(row[2] ?? "")),
    versionNumber: parseInteger(row[3]),
    publishedAt: String(row[4] ?? "").trim(),
    driveFileId,
    fileName: String(row[6] ?? "").trim(),
    snapshotJson: String(row[7] ?? "").trim()
  };
}

function parseAthleteRestriction(row: string[]): NutritionAthleteRestriction | null {
  const id = String(row[0] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[1] ?? ""));
  const type = parseRestrictionType(row[2]);
  const key = String(row[3] ?? "").trim() as NutritionAthleteRestrictionKey;
  const foodId = String(row[4] ?? "").trim();
  const label = String(row[5] ?? "").trim();
  if (!id || !athleteUsername || !key || !label) return null;

  return {
    id,
    athleteUsername,
    type,
    key,
    foodId,
    label,
    notes: String(row[6] ?? "").trim(),
    createdAt: String(row[7] ?? "").trim(),
    updatedAt: String(row[8] ?? "").trim()
  };
}

function parseAthletePrivateNote(row: string[]): AthletePrivateNote | null {
  const athleteUsername = normalizeUsername(String(row[0] ?? ""));
  if (!athleteUsername) return null;

  return {
    athleteUsername,
    notes: String(row[1] ?? "").trim(),
    updatedAt: String(row[2] ?? "").trim()
  };
}

function parseMealCompletion(row: string[]): NutritionMealCompletion | null {
  const id = String(row[0] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[1] ?? ""));
  const date = String(row[2] ?? "").trim();
  const planId = String(row[3] ?? "").trim();
  const mealId = String(row[4] ?? "").trim();
  if (!id || !athleteUsername || !isIsoDateOnly(date) || !planId || !mealId) return null;

  return {
    id,
    athleteUsername,
    date,
    planId,
    mealId,
    completed: parseBoolean(row[5], false),
    updatedAt: String(row[6] ?? "").trim()
  };
}

function parseChangeRequest(row: string[]): NutritionChangeRequest | null {
  const id = String(row[0] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[1] ?? ""));
  const planId = String(row[3] ?? "").trim();
  const mealId = String(row[5] ?? "").trim();
  const entryId = String(row[7] ?? "").trim();
  const requestedFoodId = String(row[11] ?? "").trim();
  const requestedFoodName = String(row[12] ?? "").trim();
  if (!id || !athleteUsername || !planId || !mealId || !entryId || !requestedFoodId || !requestedFoodName) {
    return null;
  }

  return {
    id,
    athleteUsername,
    athleteName: String(row[2] ?? "").trim(),
    planId,
    planName: String(row[4] ?? "").trim(),
    mealId,
    mealName: String(row[6] ?? "").trim(),
    entryId,
    originalFoodId: String(row[8] ?? "").trim(),
    originalFoodName: String(row[9] ?? "").trim(),
    originalQuantityG: clampQuantityG(parseNumber(row[10])),
    requestedFoodId,
    requestedFoodName,
    requestedQuantityG: clampQuantityG(parseNumber(row[13])),
    status: parseChangeRequestStatus(row[14]),
    athleteNotes: String(row[15] ?? "").trim(),
    adminNotes: String(row[16] ?? "").trim(),
    createdAt: String(row[17] ?? "").trim(),
    updatedAt: String(row[18] ?? "").trim(),
    resolvedAt: String(row[19] ?? "").trim(),
    resolvedBy: String(row[20] ?? "").trim()
  };
}

function serializeFood(food: NutritionFood): Array<string | number> {
  return [
    food.id,
    food.name,
    food.category,
    food.referenceUnit,
    food.proteinPer100g,
    food.carbsPer100g,
    food.fatPer100g,
    food.sodiumPer100g,
    food.waterPer100g,
    toSheetBoolean(food.active),
    food.createdAt,
    food.updatedAt,
    serializeRestrictionTags(food.restrictionTags ?? [])
  ];
}

function buildMissingDefaultFoods(existingFoods: NutritionFood[]): NutritionFood[] {
  const existingIds = new Set(existingFoods.map((food) => food.id));
  const existingNames = new Set(existingFoods.map((food) => normalizeTextKey(food.name)));
  const now = new Date().toISOString();

  return DEFAULT_NUTRITION_FOODS.filter(
    (food) => !existingIds.has(food.id) && !existingNames.has(normalizeTextKey(food.name))
  ).map((food) => ({
    ...food,
    referenceUnit: "100g",
    restrictionTags: inferRestrictionTagsForFood(food),
    active: true,
    createdAt: now,
    updatedAt: now
  }));
}

async function ensureDefaultFoods(dataset: NutritionDataset): Promise<NutritionDataset> {
  const missingFoods = buildMissingDefaultFoods(dataset.foods);
  if (!missingFoods.length) return dataset;

  const foods = [...dataset.foods, ...missingFoods];
  await appendWorksheetRows(WORKSHEETS.foods, FOOD_HEADERS, missingFoods.map(serializeFood));
  const nextDataset = { ...dataset, foods };
  cacheNutritionDataset(nextDataset);
  return nextDataset;
}

function serializePlan(plan: NutritionPlanSummary): Array<string | number> {
  return [
    plan.id,
    normalizeUsername(plan.athleteUsername),
    plan.athleteName,
    plan.name,
    plan.status,
    plan.targetProteinG,
    plan.targetCarbsG,
    plan.targetFatG,
    plan.notes,
    plan.createdAt,
    plan.updatedAt,
    plan.publishedAt,
    plan.publishedFileId,
    plan.versionNumber
  ];
}

function serializeMeal(meal: NutritionPlanMeal): Array<string | number> {
  return [
    meal.id,
    meal.planId,
    meal.name,
    meal.position,
    meal.notes,
    toSheetBoolean(meal.included),
    meal.createdAt,
    meal.updatedAt
  ];
}

function serializeEntryAlternatives(alternatives: NutritionPlanFoodAlternative[]): string {
  if (!alternatives.length) return "";
  return JSON.stringify(
    alternatives
      .map((alternative, index) => ({
        id: alternative.id,
        entryId: alternative.entryId,
        foodId: alternative.foodId,
        foodName: alternative.foodName,
        quantityG: clampQuantityG(alternative.quantityG),
        proteinPer100g: alternative.proteinPer100g,
        carbsPer100g: alternative.carbsPer100g,
        fatPer100g: alternative.fatPer100g,
        sodiumPer100g: alternative.sodiumPer100g,
        waterPer100g: alternative.waterPer100g,
        position: alternative.position || index + 1,
        customText: alternative.customText,
        createdAt: alternative.createdAt,
        updatedAt: alternative.updatedAt
      }))
      .sort((a, b) => a.position - b.position)
  );
}

function serializeEntry(entry: NutritionPlanFoodEntry): Array<string | number> {
  return [
    entry.id,
    entry.planId,
    entry.mealId,
    entry.foodId,
    entry.foodName,
    clampQuantityG(entry.quantityG),
    entry.proteinPer100g,
    entry.carbsPer100g,
    entry.fatPer100g,
    entry.sodiumPer100g,
    entry.waterPer100g,
    entry.position,
    entry.customText,
    entry.createdAt,
    entry.updatedAt,
    serializeEntryAlternatives(entry.alternatives ?? [])
  ];
}

function serializeVersion(
  version: NutritionPlanVersion & { snapshotJson?: string },
  snapshotJson = version.snapshotJson ?? ""
): Array<string | number> {
  return [
    version.id,
    version.planId,
    version.athleteUsername,
    version.versionNumber,
    version.publishedAt,
    version.driveFileId,
    version.fileName,
    snapshotJson
  ];
}

function serializeAthleteRestriction(restriction: NutritionAthleteRestriction): Array<string | number> {
  return [
    restriction.id,
    normalizeUsername(restriction.athleteUsername),
    restriction.type,
    restriction.key,
    restriction.foodId,
    restriction.label,
    restriction.notes,
    restriction.createdAt,
    restriction.updatedAt
  ];
}

function serializeAthletePrivateNote(note: AthletePrivateNote): Array<string | number> {
  return [normalizeUsername(note.athleteUsername), note.notes, note.updatedAt];
}

function buildMealCompletionId(input: {
  athleteUsername: string;
  date: string;
  planId: string;
  mealId: string;
}): string {
  return [
    normalizeUsername(input.athleteUsername),
    input.date.trim(),
    input.planId.trim(),
    input.mealId.trim()
  ].join("__");
}

function serializeMealCompletion(completion: NutritionMealCompletion): Array<string | number> {
  return [
    completion.id,
    normalizeUsername(completion.athleteUsername),
    completion.date,
    completion.planId,
    completion.mealId,
    toSheetBoolean(completion.completed),
    completion.updatedAt
  ];
}

function serializeChangeRequest(request: NutritionChangeRequest): Array<string | number> {
  return [
    request.id,
    normalizeUsername(request.athleteUsername),
    request.athleteName,
    request.planId,
    request.planName,
    request.mealId,
    request.mealName,
    request.entryId,
    request.originalFoodId,
    request.originalFoodName,
    clampQuantityG(request.originalQuantityG),
    request.requestedFoodId,
    request.requestedFoodName,
    clampQuantityG(request.requestedQuantityG),
    request.status,
    request.athleteNotes,
    request.adminNotes,
    request.createdAt,
    request.updatedAt,
    request.resolvedAt,
    request.resolvedBy
  ];
}

async function readNutritionDatasetFresh(): Promise<NutritionDataset> {
  const [foodsRows, planRows, mealRows, entryRows, versionRows, restrictionRows] =
    await readWorksheetRowsBatch([
      { worksheetName: WORKSHEETS.foods, headers: FOOD_HEADERS },
      { worksheetName: WORKSHEETS.plans, headers: PLAN_HEADERS },
      { worksheetName: WORKSHEETS.meals, headers: MEAL_HEADERS },
      { worksheetName: WORKSHEETS.planFoods, headers: PLAN_FOOD_HEADERS },
      { worksheetName: WORKSHEETS.versions, headers: VERSION_HEADERS },
      { worksheetName: WORKSHEETS.athleteRestrictions, headers: ATHLETE_RESTRICTION_HEADERS }
    ]);

  return {
    foods: foodsRows.map(parseFood).filter((item): item is NutritionFood => Boolean(item)),
    plans: planRows.map(parsePlan).filter((item): item is NutritionPlanSummary => Boolean(item)),
    meals: mealRows.map(parseMeal).filter((item): item is NutritionPlanMeal => Boolean(item)),
    entries: entryRows
      .map(parseEntry)
      .filter((item): item is NutritionPlanFoodEntry => Boolean(item)),
    versions: versionRows
      .map(parseVersion)
      .filter((item): item is StoredNutritionPlanVersion => Boolean(item)),
    restrictions: restrictionRows
      .map(parseAthleteRestriction)
      .filter((item): item is NutritionAthleteRestriction => Boolean(item))
  };
}

async function readNutritionDataset(options?: { force?: boolean }): Promise<NutritionDataset> {
  const now = Date.now();
  if (!options?.force && nutritionDatasetCache && nutritionDatasetCache.expiresAt > now) {
    return nutritionDatasetCache.value;
  }

  if (!options?.force && nutritionDatasetReadPromise) {
    return nutritionDatasetReadPromise;
  }

  const stale = nutritionDatasetCache?.value ?? null;
  const cacheVersion = nutritionDatasetCacheVersion;
  const nextRead = readNutritionDatasetFresh()
    .then((dataset) => {
      if (nutritionDatasetCacheVersion === cacheVersion) {
        cacheNutritionDataset(dataset);
      }
      return dataset;
    })
    .catch((error) => {
      if (!options?.force && stale && isGoogleRateLimitError(error)) {
        if (nutritionDatasetCacheVersion === cacheVersion) {
          cacheNutritionDataset(stale);
        }
        return stale;
      }
      throw error;
    })
    .finally(() => {
      if (nutritionDatasetReadPromise === nextRead) {
        nutritionDatasetReadPromise = null;
      }
    });

  nutritionDatasetReadPromise = nextRead;
  return nextRead;
}

function buildFullPlan(dataset: NutritionDataset, plan: NutritionPlanSummary): NutritionPlanFull {
  const entriesByMeal = new Map<string, NutritionPlanFoodEntry[]>();
  dataset.entries
    .filter((entry) => entry.planId === plan.id)
    .sort((a, b) => a.position - b.position)
    .forEach((entry) => {
      const list = entriesByMeal.get(entry.mealId) ?? [];
      list.push(entry);
      entriesByMeal.set(entry.mealId, list);
    });

  const meals = dataset.meals
    .filter((meal) => meal.planId === plan.id)
    .sort((a, b) => a.position - b.position)
    .map((meal) => ({
      ...meal,
      entries: entriesByMeal.get(meal.id) ?? []
    }));

  return {
    ...plan,
    meals,
    versions: dataset.versions
      .filter((version) => version.planId === plan.id)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(({ snapshotJson: _snapshotJson, ...version }) => version)
  };
}

export async function listNutritionManagementData(): Promise<{
  foods: NutritionFood[];
  plans: NutritionPlanSummary[];
  restrictions: NutritionAthleteRestriction[];
}> {
  const dataset = await ensureDefaultFoods(await readNutritionDataset());
  return {
    foods: [...dataset.foods].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name, "es");
    }),
    plans: [...dataset.plans].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    restrictions: [...dataset.restrictions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  };
}

export async function getNutritionPlanById(planId: string): Promise<NutritionPlanFull | null> {
  const dataset = await readNutritionDataset();
  const plan = dataset.plans.find((item) => item.id === planId);
  if (!plan) return null;
  return buildFullPlan(dataset, plan);
}

export async function listNutritionPlansForAthlete(
  athleteUsername: string
): Promise<NutritionPlanFull[]> {
  const dataset = await readNutritionDataset();
  const username = normalizeUsername(athleteUsername);
  return dataset.plans
    .filter((plan) => normalizeUsername(plan.athleteUsername) === username)
    .sort((a, b) => {
      const statusOrder = { published: 0, review: 1, draft: 2 } satisfies Record<NutritionPlanStatus, number>;
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .map((plan) => buildFullPlan(dataset, plan));
}

export async function listInteractiveNutritionDataForAthlete(
  athleteUsername: string,
  options?: { date?: string }
): Promise<{
  plans: NutritionPlanFull[];
  foods: NutritionFood[];
  restrictions: NutritionAthleteRestriction[];
  completions: NutritionMealCompletion[];
  changeRequests: NutritionChangeRequest[];
}> {
  const username = normalizeUsername(athleteUsername);
  const dataset = await ensureDefaultFoods(await readNutritionDataset());
  const [completionsResult, changeRequestsResult] = await Promise.allSettled([
    listNutritionMealCompletionsForAthlete(username, { date: options?.date }),
    listNutritionChangeRequests({ athleteUsername: username })
  ]);

  const statusOrder = { published: 0, review: 1, draft: 2 } satisfies Record<NutritionPlanStatus, number>;
  const plans = dataset.plans
    .filter((plan) => normalizeUsername(plan.athleteUsername) === username)
    .sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    })
    .map((plan) => buildFullPlan(dataset, plan));

  return {
    plans,
    foods: [...dataset.foods].sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.name.localeCompare(b.name, "es");
    }),
    restrictions: [...dataset.restrictions]
      .filter((restriction) => restriction.athleteUsername === username)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    completions: completionsResult.status === "fulfilled" ? completionsResult.value : [],
    changeRequests: changeRequestsResult.status === "fulfilled" ? changeRequestsResult.value : []
  };
}

export async function getAthletePrivateNotes(athleteUsername: string): Promise<AthletePrivateNote> {
  const username = normalizeUsername(athleteUsername);
  const rows = await readWorksheetRows(WORKSHEETS.athletePrivateNotes, ATHLETE_PRIVATE_NOTE_HEADERS);
  const note = rows
    .map(parseAthletePrivateNote)
    .find((item): item is AthletePrivateNote => Boolean(item && item.athleteUsername === username));

  return note ?? { athleteUsername: username, notes: "", updatedAt: "" };
}

export async function updateAthletePrivateNotes(input: {
  athleteUsername: string;
  notes: string;
}): Promise<AthletePrivateNote> {
  const athleteUsername = normalizeUsername(input.athleteUsername);
  if (!athleteUsername) throw new Error("Athlete username is required.");

  const note: AthletePrivateNote = {
    athleteUsername,
    notes: input.notes.trim().slice(0, 6000),
    updatedAt: new Date().toISOString()
  };

  const updated = await updateWorksheetRowById(
    WORKSHEETS.athletePrivateNotes,
    ATHLETE_PRIVATE_NOTE_HEADERS,
    athleteUsername,
    serializeAthletePrivateNote(note)
  );
  if (!updated) {
    await appendWorksheetRows(WORKSHEETS.athletePrivateNotes, ATHLETE_PRIVATE_NOTE_HEADERS, [
      serializeAthletePrivateNote(note)
    ]);
  }

  return note;
}

export async function listNutritionMealCompletionsForAthlete(
  athleteUsername: string,
  options?: { date?: string }
): Promise<NutritionMealCompletion[]> {
  const username = normalizeUsername(athleteUsername);
  if (!username) return [];

  const rows = await readWorksheetRows(WORKSHEETS.mealCompletions, MEAL_COMPLETION_HEADERS);
  return rows
    .map(parseMealCompletion)
    .filter((item): item is NutritionMealCompletion => {
      if (!item || item.athleteUsername !== username) return false;
      if (options?.date && item.date !== options.date) return false;
      return true;
    })
    .sort((a, b) => {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export async function upsertNutritionMealCompletion(input: {
  athleteUsername: string;
  date: string;
  planId: string;
  mealId: string;
  completed: boolean;
}): Promise<NutritionMealCompletion> {
  const athleteUsername = normalizeUsername(input.athleteUsername);
  const date = input.date.trim();
  const planId = input.planId.trim();
  const mealId = input.mealId.trim();

  if (!athleteUsername) throw new Error("Athlete username is required.");
  if (!isIsoDateOnly(date)) throw new Error("Completion date is invalid.");
  if (!planId || !mealId) throw new Error("Plan and meal are required.");

  const completion: NutritionMealCompletion = {
    id: buildMealCompletionId({ athleteUsername, date, planId, mealId }),
    athleteUsername,
    date,
    planId,
    mealId,
    completed: input.completed,
    updatedAt: new Date().toISOString()
  };

  const updated = await updateWorksheetRowById(
    WORKSHEETS.mealCompletions,
    MEAL_COMPLETION_HEADERS,
    completion.id,
    serializeMealCompletion(completion)
  );
  if (!updated) {
    await appendWorksheetRows(WORKSHEETS.mealCompletions, MEAL_COMPLETION_HEADERS, [
      serializeMealCompletion(completion)
    ]);
  }

  return completion;
}

async function readNutritionChangeRequests(options?: { force?: boolean }): Promise<NutritionChangeRequest[]> {
  const now = Date.now();
  if (!options?.force && changeRequestsCache && changeRequestsCache.expiresAt > now) {
    return changeRequestsCache.value;
  }

  if (!options?.force && changeRequestsReadPromise) {
    return changeRequestsReadPromise;
  }

  const stale = changeRequestsCache?.value ?? null;
  const cacheVersion = changeRequestsCacheVersion;
  const nextRead = readWorksheetRows(WORKSHEETS.changeRequests, CHANGE_REQUEST_HEADERS)
    .then((rows) =>
      rows
        .map(parseChangeRequest)
        .filter((item): item is NutritionChangeRequest => Boolean(item))
    )
    .then((requests) => {
      if (changeRequestsCacheVersion === cacheVersion) {
        cacheChangeRequests(requests);
      }
      return requests;
    })
    .catch((error) => {
      if (!options?.force && stale && isGoogleRateLimitError(error)) {
        if (changeRequestsCacheVersion === cacheVersion) {
          cacheChangeRequests(stale);
        }
        return stale;
      }
      throw error;
    })
    .finally(() => {
      if (changeRequestsReadPromise === nextRead) {
        changeRequestsReadPromise = null;
      }
    });

  changeRequestsReadPromise = nextRead;
  return nextRead;
}

export async function listNutritionChangeRequests(options?: {
  athleteUsername?: string;
  status?: NutritionChangeRequestStatus;
  force?: boolean;
}): Promise<NutritionChangeRequest[]> {
  const athleteUsername = options?.athleteUsername
    ? normalizeUsername(options.athleteUsername)
    : "";
  const requests = await readNutritionChangeRequests({ force: options?.force });
  return requests
    .filter((item): item is NutritionChangeRequest => {
      if (!item) return false;
      if (athleteUsername && item.athleteUsername !== athleteUsername) return false;
      if (options?.status && item.status !== options.status) return false;
      return true;
    })
    .sort((a, b) => {
      const statusOrder = { pending: 0, approved: 1, denied: 2 } satisfies Record<
        NutritionChangeRequestStatus,
        number
      >;
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export async function createNutritionChangeRequest(input: {
  athleteUsername: string;
  athleteName: string;
  planId: string;
  planName: string;
  mealId: string;
  mealName: string;
  entryId: string;
  originalFoodId: string;
  originalFoodName: string;
  originalQuantityG: number;
  requestedFoodId: string;
  requestedFoodName: string;
  requestedQuantityG: number;
  athleteNotes?: string;
}): Promise<NutritionChangeRequest> {
  const athleteUsername = normalizeUsername(input.athleteUsername);
  if (!athleteUsername) throw new Error("Athlete username is required.");

  const pendingRequests = await listNutritionChangeRequests({
    athleteUsername,
    status: "pending",
    force: true
  });
  const duplicate = pendingRequests.some(
    (request) =>
      request.planId === input.planId &&
      request.mealId === input.mealId &&
      request.entryId === input.entryId &&
      request.requestedFoodId === input.requestedFoodId
  );
  if (duplicate) throw new Error("Change request already exists.");

  const now = new Date().toISOString();
  const request: NutritionChangeRequest = {
    id: randomUUID(),
    athleteUsername,
    athleteName: input.athleteName.trim().slice(0, 120),
    planId: input.planId.trim(),
    planName: input.planName.trim().slice(0, 120),
    mealId: input.mealId.trim(),
    mealName: input.mealName.trim().slice(0, 120),
    entryId: input.entryId.trim(),
    originalFoodId: input.originalFoodId.trim(),
    originalFoodName: input.originalFoodName.trim().slice(0, 160),
    originalQuantityG: clampQuantityG(input.originalQuantityG),
    requestedFoodId: input.requestedFoodId.trim(),
    requestedFoodName: input.requestedFoodName.trim().slice(0, 160),
    requestedQuantityG: clampQuantityG(input.requestedQuantityG),
    status: "pending",
    athleteNotes: input.athleteNotes?.trim().slice(0, 1000) ?? "",
    adminNotes: "",
    createdAt: now,
    updatedAt: now,
    resolvedAt: "",
    resolvedBy: ""
  };

  await appendWorksheetRows(WORKSHEETS.changeRequests, CHANGE_REQUEST_HEADERS, [
    serializeChangeRequest(request)
  ]);
  return request;
}

export async function resolveNutritionChangeRequest(input: {
  requestId: string;
  status: Extract<NutritionChangeRequestStatus, "approved" | "denied">;
  adminNotes?: string;
  resolvedBy: string;
}): Promise<NutritionChangeRequest | null> {
  const requests = await listNutritionChangeRequests({ force: true });
  const current = requests.find((request) => request.id === input.requestId);
  if (!current) return null;

  const now = new Date().toISOString();
  const updated: NutritionChangeRequest = {
    ...current,
    status: input.status,
    adminNotes: input.adminNotes?.trim().slice(0, 1000) ?? current.adminNotes,
    updatedAt: now,
    resolvedAt: now,
    resolvedBy: normalizeUsername(input.resolvedBy)
  };

  const persisted = await updateWorksheetRowById(
    WORKSHEETS.changeRequests,
    CHANGE_REQUEST_HEADERS,
    updated.id,
    serializeChangeRequest(updated)
  );
  if (!persisted) return null;
  return updated;
}

export async function createNutritionFood(input: {
  name: string;
  category?: string;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sodiumPer100g: number;
  waterPer100g: number;
  restrictionTags?: NutritionFood["restrictionTags"];
}): Promise<NutritionFood> {
  const dataset = await readNutritionDataset({ force: true });
  const name = sanitizeName(input.name, "");
  if (!name) throw new Error("Food name is required.");

  const nameKey = normalizeTextKey(name);
  const exists = dataset.foods.some((food) => food.active && normalizeTextKey(food.name) === nameKey);
  if (exists) throw new Error("Food already exists.");

  const now = new Date().toISOString();
  const food: NutritionFood = {
    id: randomUUID(),
    name,
    category: input.category?.trim() ?? "",
    referenceUnit: "100g",
    proteinPer100g: clampNumber(input.proteinPer100g, 0, 200),
    carbsPer100g: clampNumber(input.carbsPer100g, 0, 200),
    fatPer100g: clampNumber(input.fatPer100g, 0, 200),
    sodiumPer100g: clampNumber(input.sodiumPer100g, 0, 100000),
    waterPer100g: clampNumber(input.waterPer100g, 0, 100),
    restrictionTags:
      input.restrictionTags === undefined
        ? inferRestrictionTagsForFood({ name, category: input.category?.trim() ?? "" })
        : parseRestrictionTags(input.restrictionTags),
    active: true,
    createdAt: now,
    updatedAt: now
  };

  await appendWorksheetRows(WORKSHEETS.foods, FOOD_HEADERS, [serializeFood(food)]);
  return food;
}

export async function updateNutritionFood(input: Partial<NutritionFood> & { id: string }): Promise<NutritionFood | null> {
  const dataset = await readNutritionDataset({ force: true });
  const index = dataset.foods.findIndex((food) => food.id === input.id);
  if (index < 0) return null;

  const current = dataset.foods[index];
  const updated: NutritionFood = {
    ...current,
    name: sanitizeName(input.name ?? current.name, current.name),
    category: input.category?.trim() ?? current.category,
    proteinPer100g: clampNumber(input.proteinPer100g ?? current.proteinPer100g, 0, 200),
    carbsPer100g: clampNumber(input.carbsPer100g ?? current.carbsPer100g, 0, 200),
    fatPer100g: clampNumber(input.fatPer100g ?? current.fatPer100g, 0, 200),
    sodiumPer100g: clampNumber(input.sodiumPer100g ?? current.sodiumPer100g, 0, 100000),
    waterPer100g: clampNumber(input.waterPer100g ?? current.waterPer100g, 0, 100),
    restrictionTags:
      input.restrictionTags !== undefined
        ? parseRestrictionTags(input.restrictionTags)
        : current.restrictionTags,
    active: input.active ?? current.active,
    updatedAt: new Date().toISOString()
  };

  const nameKey = normalizeTextKey(updated.name);
  const conflict = dataset.foods.some(
    (food) => food.id !== updated.id && food.active && normalizeTextKey(food.name) === nameKey
  );
  if (conflict) throw new Error("Food already exists.");

  const persisted = await updateWorksheetRowById(
    WORKSHEETS.foods,
    FOOD_HEADERS,
    updated.id,
    serializeFood(updated)
  );
  if (!persisted) return null;
  return updated;
}

export async function deactivateNutritionFood(foodId: string): Promise<NutritionFood | null> {
  return updateNutritionFood({ id: foodId, active: false });
}

export async function createNutritionAthleteRestriction(input: {
  athleteUsername: string;
  type: NutritionAthleteRestrictionType;
  key: NutritionAthleteRestrictionKey;
  foodId?: string;
  notes?: string;
}): Promise<NutritionAthleteRestriction> {
  const dataset = await readNutritionDataset({ force: true });
  const athleteUsername = normalizeUsername(input.athleteUsername);
  if (!athleteUsername) throw new Error("Athlete username is required.");

  const now = new Date().toISOString();
  let key = input.key;
  let foodId = "";
  let label = "";

  if (input.type === "dislike") {
    const food = dataset.foods.find((item) => item.id === input.foodId);
    if (!food) throw new Error("Food not found.");
    key = "food_dislike";
    foodId = food.id;
    label = food.name;
  } else {
    const option = getAthleteRestrictionOption(input.type, key);
    if (!option) throw new Error("Restriction option not found.");
    label = option.label;
  }

  const duplicate = dataset.restrictions.some(
    (restriction) =>
      restriction.athleteUsername === athleteUsername &&
      restriction.type === input.type &&
      restriction.key === key &&
      restriction.foodId === foodId
  );
  if (duplicate) throw new Error("Restriction already exists.");

  const restriction: NutritionAthleteRestriction = {
    id: randomUUID(),
    athleteUsername,
    type: input.type,
    key,
    foodId,
    label,
    notes: input.notes?.trim().slice(0, 300) ?? "",
    createdAt: now,
    updatedAt: now
  };

  await appendWorksheetRows(
    WORKSHEETS.athleteRestrictions,
    ATHLETE_RESTRICTION_HEADERS,
    [serializeAthleteRestriction(restriction)]
  );
  return restriction;
}

export async function deleteNutritionAthleteRestriction(id: string): Promise<NutritionAthleteRestriction | null> {
  const dataset = await readNutritionDataset({ force: true });
  const restriction = dataset.restrictions.find((item) => item.id === id);
  if (!restriction) return null;

  await deleteWorksheetRowsWhere(
    WORKSHEETS.athleteRestrictions,
    ATHLETE_RESTRICTION_HEADERS,
    (row) => String(row[0] ?? "").trim() === id
  );
  return restriction;
}

export async function createNutritionPlanForAthlete(input: {
  athleteUsername: string;
  athleteName: string;
  name: string;
}): Promise<NutritionPlanFull> {
  const now = new Date().toISOString();
  const plan: NutritionPlanSummary = {
    id: randomUUID(),
    athleteUsername: normalizeUsername(input.athleteUsername),
    athleteName: input.athleteName.trim(),
    name: sanitizeName(input.name, "Nuevo plan"),
    status: "draft",
    targetProteinG: 0,
    targetCarbsG: 0,
    targetFatG: 0,
    notes: "",
    createdAt: now,
    updatedAt: now,
    publishedAt: "",
    publishedFileId: "",
    versionNumber: 0
  };
  const meal: NutritionPlanMeal = {
    id: randomUUID(),
    planId: plan.id,
    name: "Comida 1",
    position: 1,
    notes: "",
    included: true,
    createdAt: now,
    updatedAt: now
  };

  await Promise.all([
    appendWorksheetRows(WORKSHEETS.plans, PLAN_HEADERS, [serializePlan(plan)]),
    appendWorksheetRows(WORKSHEETS.meals, MEAL_HEADERS, [serializeMeal(meal)])
  ]);

  return { ...plan, meals: [{ ...meal, entries: [] }], versions: [] };
}

export async function saveNutritionPlan(input: NutritionPlanFull): Promise<NutritionPlanFull | null> {
  const dataset = await readNutritionDataset({ force: true });
  const planIndex = dataset.plans.findIndex((plan) => plan.id === input.id);
  if (planIndex < 0) return null;

  const current = dataset.plans[planIndex];
  const now = new Date().toISOString();
  const nextStatus =
    input.status === "published" && current.publishedFileId ? "published" : input.status;
  const plan: NutritionPlanSummary = {
    ...current,
    athleteUsername: normalizeUsername(current.athleteUsername),
    athleteName: current.athleteName,
    name: sanitizeName(input.name, current.name),
    status: nextStatus,
    targetProteinG: clampNumber(input.targetProteinG, 0, 2000),
    targetCarbsG: clampNumber(input.targetCarbsG, 0, 3000),
    targetFatG: clampNumber(input.targetFatG, 0, 1000),
    notes: input.notes.trim().slice(0, 3000),
    updatedAt: now
  };

  const meals: NutritionPlanMeal[] = input.meals.map((meal, index) => ({
    id: meal.id || randomUUID(),
    planId: plan.id,
    name: sanitizeName(meal.name, `Comida ${index + 1}`).slice(0, 120),
    position: index + 1,
    notes: meal.notes.trim().slice(0, 1000),
    included: meal.included,
    createdAt: meal.createdAt || now,
    updatedAt: now
  }));

  const validMealIds = new Set(meals.map((meal) => meal.id));
  const entries: NutritionPlanFoodEntry[] = input.meals.flatMap((meal, mealIndex) => {
    const savedMealId = meals[mealIndex]?.id ?? meal.id;
    return meal.entries
      .filter((entry) => savedMealId && validMealIds.has(savedMealId))
      .map((entry, entryIndex) => {
        const savedEntryId = entry.id || randomUUID();
        return {
          id: savedEntryId,
          planId: plan.id,
          mealId: savedMealId,
          foodId: entry.foodId,
          foodName: sanitizeName(entry.foodName, "Alimento").slice(0, 160),
          quantityG: clampQuantityG(entry.quantityG),
          proteinPer100g: clampNumber(entry.proteinPer100g, 0, 200),
          carbsPer100g: clampNumber(entry.carbsPer100g, 0, 200),
          fatPer100g: clampNumber(entry.fatPer100g, 0, 200),
          sodiumPer100g: clampNumber(entry.sodiumPer100g, 0, 100000),
          waterPer100g: clampNumber(entry.waterPer100g, 0, 100),
          position: entryIndex + 1,
          customText: entry.customText.trim().slice(0, 240),
          alternatives: (entry.alternatives ?? []).map((alternative, alternativeIndex) =>
            sanitizeAlternative(alternative, savedEntryId, alternativeIndex, now)
          ),
          createdAt: entry.createdAt || now,
          updatedAt: now
        };
      });
  });

  const plans = [...dataset.plans];
  plans[planIndex] = plan;
  const otherMeals = dataset.meals.filter((meal) => meal.planId !== plan.id);
  const otherEntries = dataset.entries.filter((entry) => entry.planId !== plan.id);
  const existingMealIds = new Set(
    dataset.meals.filter((meal) => meal.planId === plan.id).map((meal) => meal.id)
  );
  const existingEntryIds = new Set(
    dataset.entries.filter((entry) => entry.planId === plan.id).map((entry) => entry.id)
  );
  const nextMealIds = new Set(meals.map((meal) => meal.id));
  const nextEntryIds = new Set(entries.map((entry) => entry.id));

  const mealsToAppend = meals.filter((meal) => !existingMealIds.has(meal.id));
  const mealsToUpdate = meals.filter((meal) => existingMealIds.has(meal.id));
  const entriesToAppend = entries.filter((entry) => !existingEntryIds.has(entry.id));
  const entriesToUpdate = entries.filter((entry) => existingEntryIds.has(entry.id));

  await Promise.all([
    updateWorksheetRowById(WORKSHEETS.plans, PLAN_HEADERS, plan.id, serializePlan(plan)),
    appendWorksheetRows(WORKSHEETS.meals, MEAL_HEADERS, mealsToAppend.map(serializeMeal)),
    appendWorksheetRows(WORKSHEETS.planFoods, PLAN_FOOD_HEADERS, entriesToAppend.map(serializeEntry)),
    ...mealsToUpdate.map((meal) =>
      updateWorksheetRowById(WORKSHEETS.meals, MEAL_HEADERS, meal.id, serializeMeal(meal))
    ),
    ...entriesToUpdate.map((entry) =>
      updateWorksheetRowById(WORKSHEETS.planFoods, PLAN_FOOD_HEADERS, entry.id, serializeEntry(entry))
    )
  ]);

  await Promise.all([
    deleteWorksheetRowsWhere(
      WORKSHEETS.meals,
      MEAL_HEADERS,
      (row) => String(row[1] ?? "").trim() === plan.id && !nextMealIds.has(String(row[0] ?? "").trim())
    ),
    deleteWorksheetRowsWhere(
      WORKSHEETS.planFoods,
      PLAN_FOOD_HEADERS,
      (row) => String(row[1] ?? "").trim() === plan.id && !nextEntryIds.has(String(row[0] ?? "").trim())
    )
  ]);

  return buildFullPlan(
    {
      ...dataset,
      plans,
      meals: [...otherMeals, ...meals],
      entries: [...otherEntries, ...entries]
    },
    plan
  );
}

export async function duplicateNutritionPlan(planId: string): Promise<NutritionPlanFull | null> {
  const dataset = await readNutritionDataset({ force: true });
  const source = dataset.plans.find((plan) => plan.id === planId);
  if (!source) return null;

  const full = buildFullPlan(dataset, source);
  const now = new Date().toISOString();
  const nextPlanId = randomUUID();
  const mealIdMap = new Map<string, string>();
  const nextPlan: NutritionPlanSummary = {
    ...source,
    id: nextPlanId,
    name: `Copia de ${source.name}`.slice(0, 120),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    publishedAt: "",
    publishedFileId: "",
    versionNumber: 0
  };
  const nextMeals: NutritionPlanMeal[] = full.meals.map((meal, index) => {
    const nextMealId = randomUUID();
    mealIdMap.set(meal.id, nextMealId);
    return {
      ...meal,
      id: nextMealId,
      planId: nextPlanId,
      position: index + 1,
      createdAt: now,
      updatedAt: now
    };
  });
  const nextEntries: NutritionPlanFoodEntry[] = full.meals.flatMap((meal) =>
    meal.entries.map((entry, index) => {
      const nextEntryId = randomUUID();
      return {
        ...entry,
        id: nextEntryId,
        planId: nextPlanId,
        mealId: mealIdMap.get(meal.id) ?? randomUUID(),
        position: index + 1,
        alternatives: (entry.alternatives ?? []).map((alternative, alternativeIndex) => ({
          ...alternative,
          id: randomUUID(),
          entryId: nextEntryId,
          position: alternativeIndex + 1,
          createdAt: now,
          updatedAt: now
        })),
        createdAt: now,
        updatedAt: now
      };
    })
  );

  await Promise.all([
    appendWorksheetRows(WORKSHEETS.plans, PLAN_HEADERS, [serializePlan(nextPlan)]),
    appendWorksheetRows(WORKSHEETS.meals, MEAL_HEADERS, nextMeals.map(serializeMeal)),
    appendWorksheetRows(WORKSHEETS.planFoods, PLAN_FOOD_HEADERS, nextEntries.map(serializeEntry))
  ]);

  return {
    ...nextPlan,
    meals: nextMeals.map((meal) => ({
      ...meal,
      entries: nextEntries.filter((entry) => entry.mealId === meal.id)
    })),
    versions: []
  };
}

export async function deleteNutritionPlanById(planId: string): Promise<{
  deleted: boolean;
  athleteUsername: string;
  fileIds: string[];
}> {
  const dataset = await readNutritionDataset({ force: true });
  const plan = dataset.plans.find((item) => item.id === planId);
  if (!plan) return { deleted: false, athleteUsername: "", fileIds: [] };

  const fileIds = new Set<string>();
  if (plan.publishedFileId) fileIds.add(plan.publishedFileId);
  dataset.versions
    .filter((version) => version.planId === planId)
    .forEach((version) => fileIds.add(version.driveFileId));

  await Promise.all([
    deleteWorksheetRowsWhere(
      WORKSHEETS.plans,
      PLAN_HEADERS,
      (row) => String(row[0] ?? "").trim() === planId
    ),
    deleteWorksheetRowsWhere(
      WORKSHEETS.meals,
      MEAL_HEADERS,
      (row) => String(row[1] ?? "").trim() === planId
    ),
    deleteWorksheetRowsWhere(
      WORKSHEETS.planFoods,
      PLAN_FOOD_HEADERS,
      (row) => String(row[1] ?? "").trim() === planId
    ),
    deleteWorksheetRowsWhere(
      WORKSHEETS.versions,
      VERSION_HEADERS,
      (row) => String(row[1] ?? "").trim() === planId
    )
  ]);

  return {
    deleted: true,
    athleteUsername: plan.athleteUsername,
    fileIds: Array.from(fileIds)
  };
}

export function buildNutritionPlanPdfFileName(plan: NutritionPlanFull): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = sanitizeFileName(`${date} ${plan.athleteName || plan.athleteUsername} Plan nutricional`);
  return `${base || "plan nutricional"}.pdf`;
}

export async function markNutritionPlanPublished(input: {
  planId: string;
  driveFileId: string;
  fileName: string;
  snapshot: NutritionPlanFull;
}): Promise<NutritionPlanFull | null> {
  const dataset = await readNutritionDataset({ force: true });
  const planIndex = dataset.plans.findIndex((plan) => plan.id === input.planId);
  if (planIndex < 0) return null;

  const now = new Date().toISOString();
  const current = dataset.plans[planIndex];
  const nextVersionNumber = current.versionNumber + 1;
  const updatedPlan: NutritionPlanSummary = {
    ...current,
    status: "published",
    updatedAt: now,
    publishedAt: now,
    publishedFileId: input.driveFileId,
    versionNumber: nextVersionNumber
  };
  const version: NutritionPlanVersion = {
    id: randomUUID(),
    planId: current.id,
    athleteUsername: current.athleteUsername,
    versionNumber: nextVersionNumber,
    publishedAt: now,
    driveFileId: input.driveFileId,
    fileName: input.fileName
  };

  await Promise.all([
    updateWorksheetRowById(WORKSHEETS.plans, PLAN_HEADERS, updatedPlan.id, serializePlan(updatedPlan)),
    appendWorksheetRows(WORKSHEETS.versions, VERSION_HEADERS, [
      serializeVersion(version, JSON.stringify(input.snapshot))
    ])
  ]);

  return getNutritionPlanById(input.planId);
}
