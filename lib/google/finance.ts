import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import { isGoogleRateLimitError, withGoogleApiRetry } from "@/lib/google/retry";
import {
  buildFinancePaymentsForContract,
  calculateFinanceInvoiceTotals,
  getContractDates,
  todayIsoDate
} from "@/lib/finance/calculations";
import type {
  CreateFinanceExpenseInput,
  CreateFinanceContractInput,
  CreateFinanceInvoiceInput,
  FinanceContract,
  FinanceContractStatus,
  FinanceExpense,
  FinanceInvoice,
  FinanceInvoiceIssuerSettings,
  FinanceInvoiceLineItem,
  FinancePayment,
  FinancePaymentStatus,
  FinancePlanOption,
  UpdateFinanceContractInput,
  UpdateFinanceInvoiceSettingsInput,
  UpdateFinancePaymentInput
} from "@/lib/finance/types";
import { DEFAULT_FINANCE_INVOICE_SETTINGS, DEFAULT_FINANCE_PLAN_OPTIONS } from "@/lib/finance/types";

type FinanceSheetsInfo = {
  spreadsheetId: string;
  contractsWorksheet: string;
  paymentsWorksheet: string;
  expensesWorksheet: string;
  invoicesWorksheet: string;
  invoiceSettingsWorksheet: string;
  planOptionsWorksheet: string;
};

type FinanceDataset = {
  contracts: FinanceContract[];
  payments: FinancePayment[];
  expenses: FinanceExpense[];
  invoices: FinanceInvoice[];
  invoiceSettings: FinanceInvoiceIssuerSettings;
  planOptions: FinancePlanOption[];
};

const FINANCE_DATASET_CACHE_TTL_MS = 3 * 60_000;

let financeDatasetCache: { expiresAt: number; value: FinanceDataset } | null = null;
let financeDatasetReadPromise: Promise<FinanceDataset> | null = null;
let financeDatasetCacheVersion = 0;

const WORKSHEETS = {
  contracts: "FinanceContracts",
  payments: "FinancePayments",
  expenses: "FinanceExpenses",
  invoices: "FinanceInvoices",
  invoiceSettings: "FinanceInvoiceSettings",
  planOptions: "FinancePlanOptions"
} as const;

function cacheFinanceDataset(dataset: FinanceDataset): void {
  financeDatasetCache = {
    expiresAt: Date.now() + FINANCE_DATASET_CACHE_TTL_MS,
    value: dataset
  };
}

function invalidateFinanceDatasetCache(): void {
  financeDatasetCache = null;
  financeDatasetReadPromise = null;
  financeDatasetCacheVersion += 1;
}

const CONTRACT_HEADERS = [
  "Id",
  "Usuario atleta",
  "Nombre atleta",
  "Plan key",
  "Plan label",
  "Duracion meses",
  "Fecha inicio",
  "Fecha fin",
  "Fecha renovacion",
  "Importe total cents",
  "Moneda",
  "Financiado",
  "Numero pagos",
  "Importe por pago cents",
  "Intervalo pagos meses",
  "Estado",
  "Contrato anterior id",
  "Idempotency key",
  "Notas",
  "Creado",
  "Actualizado"
];

const PAYMENT_HEADERS = [
  "Id",
  "Contract id",
  "Usuario atleta",
  "Nombre atleta",
  "Plan label",
  "Fecha prevista",
  "Importe previsto cents",
  "Estado",
  "Fecha cobro",
  "Importe cobrado cents",
  "Secuencia",
  "Total pagos",
  "Notas",
  "Creado",
  "Actualizado"
];

const EXPENSE_HEADERS = [
  "Id",
  "Fecha",
  "Categoria",
  "Descripcion",
  "Importe cents",
  "Moneda",
  "Notas",
  "Creado",
  "Actualizado"
];

const INVOICE_HEADERS = [
  "Id",
  "Numero factura",
  "Serie",
  "Numero secuencia",
  "Fecha expedicion",
  "Fecha operacion",
  "Fecha vencimiento",
  "Cliente nombre",
  "Cliente NIF",
  "Cliente direccion",
  "Cliente CP",
  "Cliente ciudad",
  "Cliente provincia",
  "Cliente pais",
  "Cliente email",
  "Emisor JSON",
  "Lineas JSON",
  "IRPF %",
  "Subtotal cents",
  "Descuento cents",
  "Base imponible cents",
  "IVA cents",
  "IRPF cents",
  "Total cents",
  "Moneda",
  "Metodo pago",
  "Notas",
  "Estado",
  "Creado",
  "Actualizado"
];

const INVOICE_SETTINGS_HEADERS = [
  "Id",
  "Nombre fiscal",
  "NIF",
  "Direccion",
  "CP",
  "Ciudad",
  "Provincia",
  "Pais",
  "Email",
  "Telefono",
  "Web",
  "Serie",
  "Siguiente numero",
  "IVA por defecto %",
  "IRPF por defecto %",
  "Metodo pago",
  "IBAN",
  "Notas",
  "Actualizado"
];

const PLAN_OPTION_HEADERS = ["Key", "Label", "Duration months", "Active", "Sort order"];

let financeSheetsPromise: Promise<FinanceSheetsInfo> | null = null;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
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

function parseRate(value: unknown, fallback = 0): number {
  const parsed = parseNumber(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function parseBoolean(value: unknown, fallback = false): boolean {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (["si", "yes", "true", "1", "activo", "active"].includes(normalized)) return true;
  if (["no", "false", "0", "inactivo", "inactive"].includes(normalized)) return false;
  return fallback;
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
  try {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function parseContractStatus(value: unknown): FinanceContractStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "finished" || normalized === "finalizado") return "finished";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "cancelado") {
    return "cancelled";
  }
  return "active";
}

function parsePaymentStatus(value: unknown): FinancePaymentStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "paid" || normalized === "cobrado") return "paid";
  if (normalized === "cancelled" || normalized === "canceled" || normalized === "cancelado") {
    return "cancelled";
  }
  return "pending";
}

function toSheetBoolean(value: boolean): string {
  return value ? "SI" : "NO";
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

  const response = await drive.files.list({
    q: query,
    fields: "files(id,name,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 10,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });

  return response.data.files?.[0]?.id ?? null;
}

async function createSpreadsheetInFolder(input: {
  name: string;
  folderId: string;
  initialWorksheetTitle: string;
}): Promise<string> {
  const sheets = await getSheetsClient();
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: input.name },
      sheets: [{ properties: { title: input.initialWorksheetTitle } }]
    },
    fields: "spreadsheetId"
  });

  const spreadsheetId = created.data.spreadsheetId;
  if (!spreadsheetId) throw new Error(`Could not create spreadsheet "${input.name}".`);

  const drive = await getDriveClient();
  const current = await drive.files.get({
    fileId: spreadsheetId,
    fields: "parents",
    supportsAllDrives: true
  });
  const currentParents = (current.data.parents ?? []).join(",");
  await drive.files.update({
    fileId: spreadsheetId,
    addParents: input.folderId,
    removeParents: currentParents || undefined,
    fields: "id,parents",
    supportsAllDrives: true
  });

  return spreadsheetId;
}

async function getWorksheetTitles(spreadsheetId: string): Promise<Set<string>> {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title"
  });

  return new Set(
    (response.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title?.trim() ?? "")
      .filter(Boolean)
  );
}

async function ensureWorksheet(spreadsheetId: string, title: string): Promise<void> {
  const titles = await getWorksheetTitles(spreadsheetId);
  if (titles.has(title)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title } } }]
    }
  });
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
  const hasCurrentHeaders = input.headers.every(
    (header, index) => String(firstRow[index] ?? "").trim() === header
  );
  if (hasCurrentHeaders) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: input.spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [input.headers] }
  });
}

async function resolveFinanceSpreadsheetId(): Promise<string> {
  const env = getEnv();
  if (isValidSpreadsheetId(env.GOOGLE_FINANCE_SPREADSHEET_ID)) {
    return env.GOOGLE_FINANCE_SPREADSHEET_ID.trim();
  }

  const name = env.GOOGLE_FINANCE_SHEET_NAME.trim() || "Finanzas";
  const existing = await findSpreadsheetInFolder(name, env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (existing) return existing;

  return createSpreadsheetInFolder({
    name,
    folderId: env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    initialWorksheetTitle: WORKSHEETS.contracts
  });
}

async function ensureFinanceSheetsReady(): Promise<FinanceSheetsInfo> {
  if (financeSheetsPromise) return financeSheetsPromise;

  financeSheetsPromise = (async () => {
    const spreadsheetId = await resolveFinanceSpreadsheetId();
    await ensureWorksheet(spreadsheetId, WORKSHEETS.contracts);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.payments);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.expenses);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.invoices);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.invoiceSettings);
    await ensureWorksheet(spreadsheetId, WORKSHEETS.planOptions);

    await Promise.all([
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.contracts,
        headers: CONTRACT_HEADERS
      }),
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.payments,
        headers: PAYMENT_HEADERS
      }),
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.expenses,
        headers: EXPENSE_HEADERS
      }),
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.invoices,
        headers: INVOICE_HEADERS
      }),
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.invoiceSettings,
        headers: INVOICE_SETTINGS_HEADERS
      }),
      ensureHeaderRow({
        spreadsheetId,
        worksheetName: WORKSHEETS.planOptions,
        headers: PLAN_OPTION_HEADERS
      })
    ]);

    return {
      spreadsheetId,
      contractsWorksheet: WORKSHEETS.contracts,
      paymentsWorksheet: WORKSHEETS.payments,
      expensesWorksheet: WORKSHEETS.expenses,
      invoicesWorksheet: WORKSHEETS.invoices,
      invoiceSettingsWorksheet: WORKSHEETS.invoiceSettings,
      planOptionsWorksheet: WORKSHEETS.planOptions
    };
  })();

  try {
    return await financeSheetsPromise;
  } catch (error) {
    financeSheetsPromise = null;
    throw error;
  }
}

async function readWorksheetRows(worksheetName: string, headers: string[]): Promise<string[][]> {
  const info = await ensureFinanceSheetsReady();
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

  const info = await ensureFinanceSheetsReady();
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
  const info = await ensureFinanceSheetsReady();
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
  invalidateFinanceDatasetCache();
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

  const info = await ensureFinanceSheetsReady();
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
  invalidateFinanceDatasetCache();
  return true;
}

function parsePlanOption(row: string[]): FinancePlanOption | null {
  const key = String(row[0] ?? "").trim();
  const label = String(row[1] ?? "").trim();
  if (!key || !label) return null;
  return {
    key,
    label,
    durationMonths: Math.max(1, parseInteger(row[2])),
    active: parseBoolean(row[3], true),
    sortOrder: parseInteger(row[4])
  };
}

function parseContract(row: string[]): FinanceContract | null {
  const id = String(row[0] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[1] ?? ""));
  if (!id || !athleteUsername) return null;

  return {
    id,
    athleteUsername,
    athleteName: String(row[2] ?? "").trim(),
    planKey: String(row[3] ?? "").trim(),
    planLabel: String(row[4] ?? "").trim(),
    durationMonths: Math.max(1, parseInteger(row[5])),
    startDate: String(row[6] ?? "").trim(),
    endDate: String(row[7] ?? "").trim(),
    renewalDueDate: String(row[8] ?? "").trim(),
    totalAmountCents: parseInteger(row[9]),
    currency: String(row[10] ?? "EUR").trim() || "EUR",
    financed: parseBoolean(row[11], false),
    paymentCount: Math.max(1, parseInteger(row[12])),
    paymentAmountCents: parseInteger(row[13]),
    paymentIntervalMonths: Math.max(1, parseInteger(row[14])),
    status: parseContractStatus(row[15]),
    previousContractId: String(row[16] ?? "").trim(),
    idempotencyKey: String(row[17] ?? "").trim(),
    notes: String(row[18] ?? "").trim(),
    createdAt: String(row[19] ?? "").trim(),
    updatedAt: String(row[20] ?? "").trim()
  };
}

function parsePayment(row: string[]): FinancePayment | null {
  const id = String(row[0] ?? "").trim();
  const contractId = String(row[1] ?? "").trim();
  const athleteUsername = normalizeUsername(String(row[2] ?? ""));
  if (!id || !contractId || !athleteUsername) return null;

  return {
    id,
    contractId,
    athleteUsername,
    athleteName: String(row[3] ?? "").trim(),
    planLabel: String(row[4] ?? "").trim(),
    dueDate: String(row[5] ?? "").trim(),
    expectedAmountCents: parseInteger(row[6]),
    status: parsePaymentStatus(row[7]),
    paidAt: String(row[8] ?? "").trim(),
    paidAmountCents: parseInteger(row[9]),
    sequenceIndex: Math.max(1, parseInteger(row[10])),
    sequenceCount: Math.max(1, parseInteger(row[11])),
    notes: String(row[12] ?? "").trim(),
    createdAt: String(row[13] ?? "").trim(),
    updatedAt: String(row[14] ?? "").trim()
  };
}

function parseExpense(row: string[]): FinanceExpense | null {
  const id = String(row[0] ?? "").trim();
  const date = String(row[1] ?? "").trim();
  const description = String(row[3] ?? "").trim();
  if (!id || !date || !description) return null;

  return {
    id,
    date,
    category: String(row[2] ?? "").trim(),
    description,
    amountCents: parseInteger(row[4]),
    currency: String(row[5] ?? "EUR").trim() || "EUR",
    notes: String(row[6] ?? "").trim(),
    createdAt: String(row[7] ?? "").trim(),
    updatedAt: String(row[8] ?? "").trim()
  };
}

function normalizeInvoiceIssuerSettings(
  input: Partial<FinanceInvoiceIssuerSettings>
): FinanceInvoiceIssuerSettings {
  return {
    ...DEFAULT_FINANCE_INVOICE_SETTINGS,
    ...input,
    id: input.id?.trim() || DEFAULT_FINANCE_INVOICE_SETTINGS.id,
    businessName: normalizeText(input.businessName, 180),
    taxId: normalizeText(input.taxId, 40),
    address: normalizeText(input.address, 240),
    postalCode: normalizeText(input.postalCode, 20),
    city: normalizeText(input.city, 120),
    province: normalizeText(input.province, 120),
    country: normalizeText(input.country || DEFAULT_FINANCE_INVOICE_SETTINGS.country, 80),
    email: normalizeText(input.email, 160),
    phone: normalizeText(input.phone, 60),
    website: normalizeText(input.website, 160),
    invoiceSeries: normalizeText(input.invoiceSeries || DEFAULT_FINANCE_INVOICE_SETTINGS.invoiceSeries, 40),
    nextInvoiceNumber: Math.max(1, Math.trunc(input.nextInvoiceNumber ?? 1)),
    defaultVatRate: parseRate(input.defaultVatRate, DEFAULT_FINANCE_INVOICE_SETTINGS.defaultVatRate),
    defaultIrpfRate: parseRate(input.defaultIrpfRate, DEFAULT_FINANCE_INVOICE_SETTINGS.defaultIrpfRate),
    paymentMethod: normalizeText(input.paymentMethod || DEFAULT_FINANCE_INVOICE_SETTINGS.paymentMethod, 160),
    bankIban: normalizeText(input.bankIban, 80),
    notes: normalizeText(input.notes, 1000),
    updatedAt: normalizeText(input.updatedAt, 80)
  };
}

function parseInvoiceSettings(row: string[]): FinanceInvoiceIssuerSettings | null {
  const id = String(row[0] ?? "").trim();
  if (!id) return null;
  return normalizeInvoiceIssuerSettings({
    id,
    businessName: row[1],
    taxId: row[2],
    address: row[3],
    postalCode: row[4],
    city: row[5],
    province: row[6],
    country: row[7],
    email: row[8],
    phone: row[9],
    website: row[10],
    invoiceSeries: row[11],
    nextInvoiceNumber: parseInteger(row[12]),
    defaultVatRate: parseRate(row[13], DEFAULT_FINANCE_INVOICE_SETTINGS.defaultVatRate),
    defaultIrpfRate: parseRate(row[14], DEFAULT_FINANCE_INVOICE_SETTINGS.defaultIrpfRate),
    paymentMethod: row[15],
    bankIban: row[16],
    notes: row[17],
    updatedAt: row[18]
  });
}

function normalizeInvoiceLineItem(input: Partial<FinanceInvoiceLineItem>): FinanceInvoiceLineItem {
  return {
    id: normalizeText(input.id, 120) || randomUUID(),
    description: normalizeText(input.description, 240),
    quantity: Number.isFinite(input.quantity) ? Math.max(0.001, Number(input.quantity)) : 1,
    unitPriceCents: Number.isFinite(input.unitPriceCents)
      ? Math.max(0, Math.trunc(Number(input.unitPriceCents)))
      : 0,
    discountPercent: parseRate(input.discountPercent, 0),
    vatRate: parseRate(input.vatRate, DEFAULT_FINANCE_INVOICE_SETTINGS.defaultVatRate)
  };
}

function parseInvoice(row: string[]): FinanceInvoice | null {
  const id = String(row[0] ?? "").trim();
  const invoiceNumber = String(row[1] ?? "").trim();
  if (!id || !invoiceNumber) return null;

  const issuer = normalizeInvoiceIssuerSettings(
    parseJsonValue<Partial<FinanceInvoiceIssuerSettings>>(row[15], DEFAULT_FINANCE_INVOICE_SETTINGS)
  );
  const lineItems = parseJsonValue<FinanceInvoiceLineItem[]>(row[16], []).map(normalizeInvoiceLineItem);
  const irpfRate = parseRate(row[17], 0);
  const fallbackTotals = calculateFinanceInvoiceTotals(lineItems, irpfRate);

  return {
    id,
    invoiceNumber,
    series: String(row[2] ?? "").trim(),
    sequenceNumber: Math.max(1, parseInteger(row[3])),
    issueDate: String(row[4] ?? "").trim(),
    operationDate: String(row[5] ?? "").trim(),
    dueDate: String(row[6] ?? "").trim(),
    client: {
      name: String(row[7] ?? "").trim(),
      taxId: String(row[8] ?? "").trim(),
      address: String(row[9] ?? "").trim(),
      postalCode: String(row[10] ?? "").trim(),
      city: String(row[11] ?? "").trim(),
      province: String(row[12] ?? "").trim(),
      country: String(row[13] ?? "Espana").trim() || "Espana",
      email: String(row[14] ?? "").trim()
    },
    issuer,
    lineItems,
    irpfRate,
    totals: {
      subtotalCents: parseInteger(row[18]) || fallbackTotals.subtotalCents,
      discountCents: parseInteger(row[19]) || fallbackTotals.discountCents,
      taxableBaseCents: parseInteger(row[20]) || fallbackTotals.taxableBaseCents,
      vatCents: parseInteger(row[21]) || fallbackTotals.vatCents,
      irpfCents: parseInteger(row[22]) || fallbackTotals.irpfCents,
      totalCents: parseInteger(row[23]) || fallbackTotals.totalCents
    },
    currency: String(row[24] ?? "EUR").trim() || "EUR",
    paymentMethod: String(row[25] ?? "").trim(),
    notes: String(row[26] ?? "").trim(),
    status: String(row[27] ?? "").trim() === "cancelled" ? "cancelled" : "issued",
    createdAt: String(row[28] ?? "").trim(),
    updatedAt: String(row[29] ?? "").trim()
  };
}

function serializePlanOption(option: FinancePlanOption): Array<string | number> {
  return [
    option.key,
    option.label,
    option.durationMonths,
    toSheetBoolean(option.active),
    option.sortOrder
  ];
}

function serializeContract(contract: FinanceContract): Array<string | number> {
  return [
    contract.id,
    contract.athleteUsername,
    contract.athleteName,
    contract.planKey,
    contract.planLabel,
    contract.durationMonths,
    contract.startDate,
    contract.endDate,
    contract.renewalDueDate,
    contract.totalAmountCents,
    contract.currency,
    toSheetBoolean(contract.financed),
    contract.paymentCount,
    contract.paymentAmountCents,
    contract.paymentIntervalMonths,
    contract.status,
    contract.previousContractId,
    contract.idempotencyKey,
    contract.notes,
    contract.createdAt,
    contract.updatedAt
  ];
}

function serializePayment(payment: FinancePayment): Array<string | number> {
  return [
    payment.id,
    payment.contractId,
    payment.athleteUsername,
    payment.athleteName,
    payment.planLabel,
    payment.dueDate,
    payment.expectedAmountCents,
    payment.status,
    payment.paidAt,
    payment.paidAmountCents,
    payment.sequenceIndex,
    payment.sequenceCount,
    payment.notes,
    payment.createdAt,
    payment.updatedAt
  ];
}

function serializeExpense(expense: FinanceExpense): Array<string | number> {
  return [
    expense.id,
    expense.date,
    expense.category,
    expense.description,
    expense.amountCents,
    expense.currency,
    expense.notes,
    expense.createdAt,
    expense.updatedAt
  ];
}

function serializeInvoiceSettings(settings: FinanceInvoiceIssuerSettings): Array<string | number> {
  return [
    settings.id,
    settings.businessName,
    settings.taxId,
    settings.address,
    settings.postalCode,
    settings.city,
    settings.province,
    settings.country,
    settings.email,
    settings.phone,
    settings.website,
    settings.invoiceSeries,
    settings.nextInvoiceNumber,
    settings.defaultVatRate,
    settings.defaultIrpfRate,
    settings.paymentMethod,
    settings.bankIban,
    settings.notes,
    settings.updatedAt
  ];
}

function serializeInvoice(invoice: FinanceInvoice): Array<string | number> {
  return [
    invoice.id,
    invoice.invoiceNumber,
    invoice.series,
    invoice.sequenceNumber,
    invoice.issueDate,
    invoice.operationDate,
    invoice.dueDate,
    invoice.client.name,
    invoice.client.taxId,
    invoice.client.address,
    invoice.client.postalCode,
    invoice.client.city,
    invoice.client.province,
    invoice.client.country,
    invoice.client.email,
    JSON.stringify(invoice.issuer),
    JSON.stringify(invoice.lineItems),
    invoice.irpfRate,
    invoice.totals.subtotalCents,
    invoice.totals.discountCents,
    invoice.totals.taxableBaseCents,
    invoice.totals.vatCents,
    invoice.totals.irpfCents,
    invoice.totals.totalCents,
    invoice.currency,
    invoice.paymentMethod,
    invoice.notes,
    invoice.status,
    invoice.createdAt,
    invoice.updatedAt
  ];
}

async function ensureDefaultPlanOptions(dataset: FinanceDataset): Promise<FinanceDataset> {
  if (dataset.planOptions.length) return dataset;

  await appendWorksheetRows(
    WORKSHEETS.planOptions,
    PLAN_OPTION_HEADERS,
    DEFAULT_FINANCE_PLAN_OPTIONS.map(serializePlanOption)
  );
  const nextDataset = {
    ...dataset,
    planOptions: DEFAULT_FINANCE_PLAN_OPTIONS
  };
  cacheFinanceDataset(nextDataset);
  return nextDataset;
}

async function readFinanceDatasetFresh(): Promise<FinanceDataset> {
  const [contractRows, paymentRows, expenseRows, invoiceRows, invoiceSettingsRows, optionRows] = await readWorksheetRowsBatch([
    { worksheetName: WORKSHEETS.contracts, headers: CONTRACT_HEADERS },
    { worksheetName: WORKSHEETS.payments, headers: PAYMENT_HEADERS },
    { worksheetName: WORKSHEETS.expenses, headers: EXPENSE_HEADERS },
    { worksheetName: WORKSHEETS.invoices, headers: INVOICE_HEADERS },
    { worksheetName: WORKSHEETS.invoiceSettings, headers: INVOICE_SETTINGS_HEADERS },
    { worksheetName: WORKSHEETS.planOptions, headers: PLAN_OPTION_HEADERS }
  ]);
  const invoiceSettings =
    invoiceSettingsRows
      .map(parseInvoiceSettings)
      .filter((settings): settings is FinanceInvoiceIssuerSettings => Boolean(settings))
      .find((settings) => settings.id === DEFAULT_FINANCE_INVOICE_SETTINGS.id) ??
    normalizeInvoiceIssuerSettings(DEFAULT_FINANCE_INVOICE_SETTINGS);

  return ensureDefaultPlanOptions({
    contracts: contractRows
      .map(parseContract)
      .filter((contract): contract is FinanceContract => Boolean(contract)),
    payments: paymentRows
      .map(parsePayment)
      .filter((payment): payment is FinancePayment => Boolean(payment)),
    expenses: expenseRows
      .map(parseExpense)
      .filter((expense): expense is FinanceExpense => Boolean(expense)),
    invoices: invoiceRows
      .map(parseInvoice)
      .filter((invoice): invoice is FinanceInvoice => Boolean(invoice)),
    invoiceSettings,
    planOptions: optionRows
      .map(parsePlanOption)
      .filter((option): option is FinancePlanOption => Boolean(option))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  });
}

async function readFinanceDataset(options?: { force?: boolean }): Promise<FinanceDataset> {
  const now = Date.now();
  if (!options?.force && financeDatasetCache && financeDatasetCache.expiresAt > now) {
    return financeDatasetCache.value;
  }

  if (!options?.force && financeDatasetReadPromise) {
    return financeDatasetReadPromise;
  }

  const stale = financeDatasetCache?.value ?? null;
  const cacheVersion = financeDatasetCacheVersion;
  const nextRead = readFinanceDatasetFresh()
    .then((dataset) => {
      if (financeDatasetCacheVersion === cacheVersion) {
        cacheFinanceDataset(dataset);
      }
      return dataset;
    })
    .catch((error) => {
      if (!options?.force && stale && isGoogleRateLimitError(error)) {
        if (financeDatasetCacheVersion === cacheVersion) {
          cacheFinanceDataset(stale);
        }
        return stale;
      }
      throw error;
    })
    .finally(() => {
      if (financeDatasetReadPromise === nextRead) {
        financeDatasetReadPromise = null;
      }
    });

  financeDatasetReadPromise = nextRead;
  return nextRead;
}

export async function listFinanceRecords(): Promise<{
  contracts: FinanceContract[];
  payments: FinancePayment[];
  expenses: FinanceExpense[];
  invoices: FinanceInvoice[];
  invoiceSettings: FinanceInvoiceIssuerSettings;
  planOptions: FinancePlanOption[];
}> {
  const dataset = await readFinanceDataset();
  return {
    contracts: [...dataset.contracts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    payments: [...dataset.payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    expenses: [...dataset.expenses].sort((a, b) => b.date.localeCompare(a.date)),
    invoices: [...dataset.invoices].sort((a, b) => b.issueDate.localeCompare(a.issueDate)),
    invoiceSettings: dataset.invoiceSettings,
    planOptions: [...dataset.planOptions].sort((a, b) => a.sortOrder - b.sortOrder)
  };
}

export async function updateFinanceInvoiceSettings(
  input: UpdateFinanceInvoiceSettingsInput
): Promise<FinanceInvoiceIssuerSettings> {
  const dataset = await readFinanceDataset({ force: true });
  const now = new Date().toISOString();
  const settings = normalizeInvoiceIssuerSettings({
    ...dataset.invoiceSettings,
    ...input,
    id: DEFAULT_FINANCE_INVOICE_SETTINGS.id,
    updatedAt: now
  });

  const persisted = await updateWorksheetRowById(
    WORKSHEETS.invoiceSettings,
    INVOICE_SETTINGS_HEADERS,
    settings.id,
    serializeInvoiceSettings(settings)
  );
  if (!persisted) {
    await appendWorksheetRows(WORKSHEETS.invoiceSettings, INVOICE_SETTINGS_HEADERS, [
      serializeInvoiceSettings(settings)
    ]);
  }
  cacheFinanceDataset({
    ...dataset,
    invoiceSettings: settings
  });
  return settings;
}

function buildInvoiceNumber(series: string, sequenceNumber: number): string {
  return `${series}-${String(sequenceNumber).padStart(4, "0")}`;
}

function getNextInvoiceSequence(series: string, settings: FinanceInvoiceIssuerSettings, invoices: FinanceInvoice[]): number {
  const highestInSeries = invoices
    .filter((invoice) => invoice.series === series)
    .reduce((highest, invoice) => Math.max(highest, invoice.sequenceNumber), 0);
  const configuredNext = settings.invoiceSeries === series ? settings.nextInvoiceNumber : 1;
  return Math.max(configuredNext, highestInSeries + 1, 1);
}

function normalizeInvoiceClient(input: CreateFinanceInvoiceInput["client"]): CreateFinanceInvoiceInput["client"] {
  return {
    name: normalizeText(input.name, 180),
    taxId: normalizeText(input.taxId, 40),
    address: normalizeText(input.address, 240),
    postalCode: normalizeText(input.postalCode, 20),
    city: normalizeText(input.city, 120),
    province: normalizeText(input.province, 120),
    country: normalizeText(input.country || "Espana", 80),
    email: normalizeText(input.email, 160)
  };
}

export async function createFinanceInvoice(input: CreateFinanceInvoiceInput): Promise<FinanceInvoice> {
  const dataset = await readFinanceDataset({ force: true });
  const now = new Date().toISOString();
  const issuer = normalizeInvoiceIssuerSettings(dataset.invoiceSettings);
  const series = normalizeText(input.series || issuer.invoiceSeries, 40) || DEFAULT_FINANCE_INVOICE_SETTINGS.invoiceSeries;
  const sequenceNumber =
    input.sequenceNumber && input.sequenceNumber > 0
      ? Math.trunc(input.sequenceNumber)
      : getNextInvoiceSequence(series, issuer, dataset.invoices);
  const invoiceNumber = buildInvoiceNumber(series, sequenceNumber);

  if (dataset.invoices.some((invoice) => invoice.invoiceNumber === invoiceNumber)) {
    throw new Error(`Invoice number already exists: ${invoiceNumber}`);
  }

  const lineItems = input.lineItems
    .map(normalizeInvoiceLineItem)
    .filter((line) => line.description && line.quantity > 0 && line.unitPriceCents > 0);
  if (!lineItems.length) {
    throw new Error("Invoice must include at least one valid line item.");
  }

  const irpfRate = parseRate(input.irpfRate, 0);
  const totals = calculateFinanceInvoiceTotals(lineItems, irpfRate);
  const invoice: FinanceInvoice = {
    id: randomUUID(),
    invoiceNumber,
    series,
    sequenceNumber,
    issueDate: input.issueDate,
    operationDate: input.operationDate?.trim() || input.issueDate,
    dueDate: input.dueDate?.trim() || "",
    client: normalizeInvoiceClient(input.client),
    issuer,
    lineItems,
    irpfRate,
    totals,
    currency: normalizeText(input.currency || "EUR", 3).toUpperCase() || "EUR",
    paymentMethod: normalizeText(input.paymentMethod || issuer.paymentMethod, 160),
    notes: normalizeText(input.notes, 1000),
    status: "issued",
    createdAt: now,
    updatedAt: now
  };

  await appendWorksheetRows(WORKSHEETS.invoices, INVOICE_HEADERS, [serializeInvoice(invoice)]);

  if (series === issuer.invoiceSeries && sequenceNumber >= issuer.nextInvoiceNumber) {
    await updateFinanceInvoiceSettings({ nextInvoiceNumber: sequenceNumber + 1 });
  }

  return invoice;
}

export async function getFinanceInvoiceById(invoiceId: string): Promise<FinanceInvoice | null> {
  const dataset = await readFinanceDataset();
  return dataset.invoices.find((invoice) => invoice.id === invoiceId) ?? null;
}

export async function createFinanceExpense(input: CreateFinanceExpenseInput): Promise<FinanceExpense> {
  const now = new Date().toISOString();
  const expense: FinanceExpense = {
    id: randomUUID(),
    date: input.date,
    category: input.category.trim().slice(0, 120),
    description: input.description.trim().slice(0, 180),
    amountCents: Math.max(1, Math.trunc(input.amountCents)),
    currency: input.currency.trim().toUpperCase() || "EUR",
    notes: input.notes?.trim().slice(0, 1000) ?? "",
    createdAt: now,
    updatedAt: now
  };

  await appendWorksheetRows(WORKSHEETS.expenses, EXPENSE_HEADERS, [serializeExpense(expense)]);
  return expense;
}

export async function createFinanceContractWithPayments(
  input: CreateFinanceContractInput
): Promise<{ contract: FinanceContract; payments: FinancePayment[]; created: boolean }> {
  const dataset = await readFinanceDataset({ force: true });
  const idempotencyKey = input.idempotencyKey?.trim() ?? "";
  if (idempotencyKey) {
    const existing = dataset.contracts.find(
      (contract) => contract.idempotencyKey === idempotencyKey
    );
    if (existing) {
      return {
        contract: existing,
        payments: dataset.payments.filter((payment) => payment.contractId === existing.id),
        created: false
      };
    }
  }

  const now = new Date().toISOString();
  const contractId = randomUUID();
  const contractDates = getContractDates(input.startDate, input.durationMonths);
  const paymentCount = input.financed ? Math.max(1, Math.trunc(input.paymentCount)) : 1;
  const paymentAmountCents = input.financed
    ? input.paymentAmountCents ?? Math.floor(input.totalAmountCents / paymentCount)
    : input.totalAmountCents;

  const contract: FinanceContract = {
    id: contractId,
    athleteUsername: normalizeUsername(input.athleteUsername),
    athleteName: input.athleteName.trim(),
    planKey: input.planKey.trim(),
    planLabel: input.planLabel.trim(),
    durationMonths: Math.max(1, Math.trunc(input.durationMonths)),
    startDate: input.startDate,
    endDate: contractDates.endDate,
    renewalDueDate: contractDates.renewalDueDate,
    totalAmountCents: Math.max(1, Math.trunc(input.totalAmountCents)),
    currency: input.currency.trim().toUpperCase() || "EUR",
    financed: input.financed,
    paymentCount,
    paymentAmountCents,
    paymentIntervalMonths: Math.max(1, Math.trunc(input.paymentIntervalMonths)),
    status: "active",
    previousContractId: input.previousContractId?.trim() ?? "",
    idempotencyKey,
    notes: input.notes?.trim().slice(0, 1000) ?? "",
    createdAt: now,
    updatedAt: now
  };

  const payments = buildFinancePaymentsForContract(input, contractId, now, randomUUID);

  await Promise.all([
    appendWorksheetRows(WORKSHEETS.contracts, CONTRACT_HEADERS, [serializeContract(contract)]),
    appendWorksheetRows(WORKSHEETS.payments, PAYMENT_HEADERS, payments.map(serializePayment))
  ]);

  return { contract, payments, created: true };
}

export async function updateFinancePayment(
  input: UpdateFinancePaymentInput
): Promise<FinancePayment | null> {
  const dataset = await readFinanceDataset({ force: true });
  const index = dataset.payments.findIndex((payment) => payment.id === input.paymentId);
  if (index < 0) return null;

  const current = dataset.payments[index];
  const nextStatus = input.status ?? current.status;
  const shouldDefaultPaidFields = nextStatus === "paid" && current.status !== "paid";
  const updated: FinancePayment = {
    ...current,
    status: nextStatus,
    dueDate: input.dueDate ?? current.dueDate,
    expectedAmountCents: input.expectedAmountCents ?? current.expectedAmountCents,
    paidAt:
      input.paidAt !== undefined
        ? input.paidAt
        : shouldDefaultPaidFields
          ? todayIsoDate()
          : current.paidAt,
    paidAmountCents:
      input.paidAmountCents !== undefined
        ? input.paidAmountCents
        : shouldDefaultPaidFields
          ? current.expectedAmountCents
          : current.paidAmountCents,
    notes: input.notes !== undefined ? input.notes.trim().slice(0, 1000) : current.notes,
    updatedAt: new Date().toISOString()
  };

  if (updated.status !== "paid") {
    updated.paidAt = "";
    updated.paidAmountCents = 0;
  }

  const persisted = await updateWorksheetRowById(
    WORKSHEETS.payments,
    PAYMENT_HEADERS,
    updated.id,
    serializePayment(updated)
  );
  if (!persisted) return null;
  return updated;
}

export async function updateFinanceContract(
  input: UpdateFinanceContractInput
): Promise<{
  contract: FinanceContract | null;
  cancelledPayments: number;
}> {
  const dataset = await readFinanceDataset({ force: true });
  const index = dataset.contracts.findIndex((contract) => contract.id === input.contractId);
  if (index < 0) return { contract: null, cancelledPayments: 0 };

  const current = dataset.contracts[index];
  const updated: FinanceContract = {
    ...current,
    status: input.status ?? current.status,
    notes: input.notes !== undefined ? input.notes.trim().slice(0, 1000) : current.notes,
    updatedAt: new Date().toISOString()
  };

  let cancelledPayments = 0;
  let paymentsToUpdate: FinancePayment[] = [];
  if (input.status === "cancelled" && input.cancelPendingFuturePayments) {
    const today = input.today ?? todayIsoDate();
    paymentsToUpdate = dataset.payments.flatMap((payment) => {
      if (
        payment.contractId !== current.id ||
        payment.status !== "pending" ||
        payment.dueDate < today
      ) {
        return [];
      }
      cancelledPayments += 1;
      return [{
        ...payment,
        status: "cancelled" as const,
        updatedAt: new Date().toISOString()
      }];
    });
  }

  const persisted = await updateWorksheetRowById(
    WORKSHEETS.contracts,
    CONTRACT_HEADERS,
    updated.id,
    serializeContract(updated)
  );
  if (!persisted) return { contract: null, cancelledPayments: 0 };

  await Promise.all(
    paymentsToUpdate.map((payment) =>
      updateWorksheetRowById(
        WORKSHEETS.payments,
        PAYMENT_HEADERS,
        payment.id,
        serializePayment(payment)
      )
    )
  );

  return { contract: updated, cancelledPayments };
}
