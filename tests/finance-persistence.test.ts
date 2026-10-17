import { beforeEach, describe, expect, it, vi } from "vitest";
import { contractInput } from "./fixtures/finance";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  read: vi.fn(),
  batchGet: vi.fn(),
  update: vi.fn(),
  append: vi.fn(),
  clear: vi.fn(),
  exchange: vi.fn()
}));
vi.mock("googleapis", () => ({
  google: {
    sheets: () => ({
      spreadsheets: {
        get: mocks.get,
        values: {
          get: mocks.read,
          batchGet: mocks.batchGet,
          update: mocks.update,
          append: mocks.append,
          batchClear: mocks.clear
        }
      }
    })
  }
}));
vi.mock("@/lib/google/auth", () => ({ getGoogleAuth: () => ({}) }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ GOOGLE_FINANCE_SPREADSHEET_ID: "finance-test-spreadsheet-id" })
}));
vi.mock("@/lib/finance/exchange-rates-server", () => ({ getFinanceExchangeRates: mocks.exchange }));
const titles = [
  "FinanceContracts",
  "FinancePayments",
  "FinanceExpenses",
  "FinanceExpenseInvoiceFiles",
  "FinanceInvoices",
  "FinanceInvoiceSettings",
  "FinancePlanOptions"
];
type Row = Array<string | number>;
let rows: Record<string, Row[]>;
const expenseInput = {
  date: "2026-03-31",
  category: "General",
  description: "Editado",
  amountCents: 12100,
  currency: "USD",
  vatRate: 21,
  vatDeductible: true,
  notes: "Nueva nota"
};
function title(range: string) {
  return range.split("'")[1];
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  rows = Object.fromEntries(titles.map((key) => [key, []]));
  rows.FinancePlanOptions = [["monthly", "Mensual", 1, "TRUE", 1]];
  rows.FinanceExpenses = [
    [
      "expense-edit",
      "2026-03-31",
      "General",
      "Original",
      12100,
      "USD",
      "Nota",
      "created",
      "old",
      21,
      "TRUE",
      9680,
      0.8,
      "2026-03-31"
    ],
    ["expense-other", "2026-04-01", "General", "Otro", 1000, "EUR", "", "created", "old"]
  ];
  mocks.get.mockResolvedValue({
    data: { sheets: titles.map((key, sheetId) => ({ properties: { title: key, sheetId } })) }
  });
  mocks.read.mockImplementation(async ({ range }: { range: string }) => ({
    data: { values: range.includes("!A1:") ? [] : structuredClone(rows[title(range)]) }
  }));
  mocks.batchGet.mockImplementation(async ({ ranges }: { ranges: string[] }) => ({
    data: { valueRanges: ranges.map((range) => ({ values: structuredClone(rows[title(range)]) })) }
  }));
  mocks.update.mockImplementation(
    async ({ range, requestBody }: { range: string; requestBody: { values: Row[] } }) => {
      const row = Number(range.match(/!A(\d+):/)![1]);
      if (row >= 2) rows[title(range)][row - 2] = structuredClone(requestBody.values[0]);
      return { data: {} };
    }
  );
  mocks.append.mockImplementation(
    async ({ range, requestBody }: { range: string; requestBody: { values: Row[] } }) => {
      rows[title(range)].push(...structuredClone(requestBody.values));
      return { data: {} };
    }
  );
  mocks.clear.mockImplementation(async ({ requestBody }: { requestBody: { ranges: string[] } }) => {
    for (const range of requestBody.ranges)
      rows[title(range)][Number(range.match(/!A(\d+):/)![1]) - 2] = [];
    return { data: {} };
  });
  mocks.exchange.mockResolvedValue({
    date: "2026-10-16",
    source: "test",
    rates: { EUR: 1, USD: 0.95, GBP: 1.2 }
  });
});

describe("finance Sheets persistence", () => {
  it("edits a standalone expense without changing its identity, creation timestamp or historical exchange rate", async () => {
    const { updateFinanceExpense, listFinanceRecords } = await import("@/lib/google/finance");
    const result = await updateFinanceExpense("expense-edit", expenseInput);
    expect(result).toMatchObject({
      id: "expense-edit",
      createdAt: "created",
      description: "Editado",
      euroAmountCents: 9680,
      exchangeRateToEur: 0.8,
      exchangeRateDate: "2026-03-31"
    });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(
      (await listFinanceRecords()).expenses.find((item) => item.id === "expense-edit")
    ).toMatchObject({ notes: "Nueva nota", vatDeductible: true });
    expect(rows.FinanceExpenses[1][3]).toBe("Otro");
    expect(rows.FinanceExpenseInvoiceFiles).toEqual([]);
  });
  it("recalculates an edited amount at the original rate and fetches a new rate only for a different currency", async () => {
    const { updateFinanceExpense } = await import("@/lib/google/finance");
    expect(
      await updateFinanceExpense("expense-edit", { ...expenseInput, amountCents: 24200 })
    ).toMatchObject({ euroAmountCents: 19360, exchangeRateDate: "2026-03-31" });
    expect(mocks.exchange).not.toHaveBeenCalled();
    expect(
      await updateFinanceExpense("expense-edit", { ...expenseInput, currency: "GBP" })
    ).toMatchObject({ euroAmountCents: 14520, exchangeRateDate: "2026-10-16" });
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "deletes the correct expense and only its linked files, with attachments=%s",
    async (attached) => {
      const linked = [
        "file-linked",
        "expense-edit",
        "drive-linked",
        "Factura.pdf",
        "application/pdf",
        100,
        "",
        "2026-03-31",
        12100,
        "",
        "",
        "expense-created",
        "",
        "created",
        "old"
      ];
      const unrelated = [
        "file-other",
        "expense-other",
        "drive-other",
        "Otro.pdf",
        "application/pdf",
        100,
        "",
        "2026-04-01",
        1000,
        "",
        "",
        "expense-created",
        "",
        "created",
        "old"
      ];
      rows.FinanceExpenseInvoiceFiles = attached ? [linked, unrelated] : [unrelated];
      const { deleteFinanceExpense, listFinanceRecords } = await import("@/lib/google/finance");
      await listFinanceRecords(); // Populate the read cache before deletion.
      const result = await deleteFinanceExpense("expense-edit");
      expect(result?.files.map((file) => file.driveFileId)).toEqual(
        attached ? ["drive-linked"] : []
      );
      const after = await listFinanceRecords();
      expect(after.expenses.map((item) => item.id)).toEqual(["expense-other"]);
      expect(after.expenseInvoiceFiles.map((file) => file.id)).toEqual(["file-other"]);
      expect(mocks.clear).toHaveBeenCalledTimes(1);
    }
  );
  it("retains documents when editing an attached expense", async () => {
    rows.FinanceExpenseInvoiceFiles = [["file-linked", "expense-edit", "drive-linked"]];
    const before = structuredClone(rows.FinanceExpenseInvoiceFiles);
    const { updateFinanceExpense } = await import("@/lib/google/finance");
    await updateFinanceExpense("expense-edit", expenseInput);
    expect(rows.FinanceExpenseInvoiceFiles).toEqual(before);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("round-trips methods in appended contract/payment columns and allows a different method for one installment", async () => {
    const { createFinanceContractWithPayments, listFinanceRecords, updateFinancePayment } =
      await import("@/lib/google/finance");
    const created = await createFinanceContractWithPayments(contractInput);
    const loaded = await listFinanceRecords();
    expect(loaded.contracts[0].paymentMethod).toBe("cash");
    expect(loaded.payments.every((item) => item.paymentMethod === "cash")).toBe(true);
    expect(rows.FinanceContracts[0][21]).toBe(20000);
    expect(rows.FinanceContracts[0][22]).toBe("cash");
    const installment = created.payments.find((item) => item.status === "pending")!;
    await updateFinancePayment({
      paymentId: installment.id,
      status: "paid",
      paidAt: "2026-03-01",
      paymentMethod: "bank_transfer"
    });
    const after = await listFinanceRecords();
    expect(after.payments.find((item) => item.id === installment.id)).toMatchObject({
      paymentMethod: "bank_transfer",
      paidAmountCents: 20000
    });
    expect(
      after.payments
        .filter((item) => item.id !== installment.id)
        .every((item) => item.paymentMethod === "cash")
    ).toBe(true);
    expect(after.contracts[0].paymentMethod).toBe("cash");
  });
  it("loads legacy rows without assigning a made-up payment method", async () => {
    rows.FinanceContracts = [
      [
        "old-contract",
        "ana",
        "Ana",
        "monthly",
        "Mensual",
        1,
        "2026-01-01",
        "2026-01-31",
        "2026-02-01",
        20000,
        "EUR",
        "FALSE",
        1,
        20000,
        1,
        "active",
        "",
        "",
        "",
        "created",
        "updated",
        0
      ]
    ];
    rows.FinancePayments = [
      [
        "old-payment",
        "old-contract",
        "ana",
        "Ana",
        "Mensual",
        "2026-01-01",
        20000,
        "paid",
        "2026-01-01",
        20000,
        1,
        1,
        "",
        "created",
        "updated"
      ]
    ];
    const { listFinanceRecords } = await import("@/lib/google/finance");
    const data = await listFinanceRecords();
    expect(data.contracts[0].paymentMethod).toBeUndefined();
    expect(data.payments[0].paymentMethod).toBeUndefined();
    expect(rows.FinancePayments[0]).toHaveLength(15);
  });
});
