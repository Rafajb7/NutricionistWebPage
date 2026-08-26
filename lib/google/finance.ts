import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import { getEnv } from "@/lib/env";
import { getGoogleAuth } from "@/lib/google/auth";
import {
  buildFinancePaymentsForContract,
  getContractDates,
  todayIsoDate
} from "@/lib/finance/calculations";
import type {
  CreateFinanceContractInput,
  FinanceContract,
  FinanceContractStatus,
  FinancePayment,
  FinancePaymentStatus,
  FinancePlanOption,
  UpdateFinanceContractInput,
  UpdateFinancePaymentInput
} from "@/lib/finance/types";
import { DEFAULT_FINANCE_PLAN_OPTIONS } from "@/lib/finance/types";

type FinanceSheetsInfo = {
  spreadsheetId: string;
  contractsWorksheet: string;
  paymentsWorksheet: string;
  planOptionsWorksheet: string;
};

type FinanceDataset = {
  contracts: FinanceContract[];
  payments: FinancePayment[];
  planOptions: FinancePlanOption[];
};

const WORKSHEETS = {
  contracts: "FinanceContracts",
  payments: "FinancePayments",
  planOptions: "FinancePlanOptions"
} as const;

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
        worksheetName: WORKSHEETS.planOptions,
        headers: PLAN_OPTION_HEADERS
      })
    ]);

    return {
      spreadsheetId,
      contractsWorksheet: WORKSHEETS.contracts,
      paymentsWorksheet: WORKSHEETS.payments,
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
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: info.spreadsheetId,
    range: `'${worksheetName}'!A2:${endCol}`,
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING"
  });
  return (response.data.values as string[][] | undefined) ?? [];
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
  await sheets.spreadsheets.values.append({
    spreadsheetId: info.spreadsheetId,
    range: `'${worksheetName}'!A:${endCol}`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows }
  });
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
  await sheets.spreadsheets.values.update({
    spreadsheetId: info.spreadsheetId,
    range: `'${worksheetName}'!A${target.rowNumber}:${endCol}${target.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [rowValues] }
  });
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

async function ensureDefaultPlanOptions(dataset: FinanceDataset): Promise<FinanceDataset> {
  if (dataset.planOptions.length) return dataset;

  await appendWorksheetRows(
    WORKSHEETS.planOptions,
    PLAN_OPTION_HEADERS,
    DEFAULT_FINANCE_PLAN_OPTIONS.map(serializePlanOption)
  );
  return {
    ...dataset,
    planOptions: DEFAULT_FINANCE_PLAN_OPTIONS
  };
}

async function readFinanceDataset(): Promise<FinanceDataset> {
  const [contractRows, paymentRows, optionRows] = await Promise.all([
    readWorksheetRows(WORKSHEETS.contracts, CONTRACT_HEADERS),
    readWorksheetRows(WORKSHEETS.payments, PAYMENT_HEADERS),
    readWorksheetRows(WORKSHEETS.planOptions, PLAN_OPTION_HEADERS)
  ]);

  return ensureDefaultPlanOptions({
    contracts: contractRows
      .map(parseContract)
      .filter((contract): contract is FinanceContract => Boolean(contract)),
    payments: paymentRows
      .map(parsePayment)
      .filter((payment): payment is FinancePayment => Boolean(payment)),
    planOptions: optionRows
      .map(parsePlanOption)
      .filter((option): option is FinancePlanOption => Boolean(option))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  });
}

export async function listFinanceRecords(): Promise<{
  contracts: FinanceContract[];
  payments: FinancePayment[];
  planOptions: FinancePlanOption[];
}> {
  const dataset = await readFinanceDataset();
  return {
    contracts: [...dataset.contracts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    payments: [...dataset.payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    planOptions: [...dataset.planOptions].sort((a, b) => a.sortOrder - b.sortOrder)
  };
}

export async function createFinanceContractWithPayments(
  input: CreateFinanceContractInput
): Promise<{ contract: FinanceContract; payments: FinancePayment[]; created: boolean }> {
  const dataset = await readFinanceDataset();
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
  const dataset = await readFinanceDataset();
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
  const dataset = await readFinanceDataset();
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
