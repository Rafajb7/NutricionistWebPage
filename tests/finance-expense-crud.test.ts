import { beforeEach, describe, expect, it, vi } from "vitest";
import { expense } from "./fixtures/finance";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  deleteFile: vi.fn()
}));
vi.mock("@/lib/auth/require-session", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/lib/google/finance", () => ({
  updateFinanceExpense: mocks.update,
  deleteFinanceExpense: mocks.remove,
  listFinanceRecords: mocks.list
}));
vi.mock("@/lib/google/drive", () => ({ deleteDriveFileById: mocks.deleteFile }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));
import { PATCH, DELETE } from "@/app/api/admin/finance/expenses/[expenseId]/route";
const context = { params: Promise.resolve({ expenseId: expense.id }) };
const payload = {
  date: "2026-04-01",
  category: "Local",
  description: "Alquiler actualizado",
  amount: "242,00",
  currency: "EUR",
  vatRate: 21,
  vatDeductible: true,
  notes: "Editado"
};
function request(body: unknown = payload) {
  return new Request("http://localhost/api/admin/finance/expenses/expense-id", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { username: "admin" } });
  mocks.update.mockResolvedValue({ ...expense, amountCents: 24200 });
  mocks.remove.mockResolvedValue({ expense, files: [] });
  mocks.list.mockResolvedValue({
    contracts: [],
    payments: [],
    expenses: [],
    expenseInvoiceFiles: []
  });
});
describe("expense CRUD API", () => {
  it("updates a standalone expense by its own ID and refreshes the dashboard", async () => {
    const response = await PATCH(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expense.id, {
      ...payload,
      amount: undefined,
      amountCents: 24200
    });
    expect((await response.json()).dashboard.expensesThisMonthCents).toBe(0);
  });
  it("deletes an expense without a document", async () => {
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith(expense.id);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
  it("removes all associated PDFs when deleting an attached expense", async () => {
    mocks.remove.mockResolvedValue({
      expense,
      files: [{ driveFileId: "file-1" }, { driveFileId: "file-2" }]
    });
    expect((await DELETE(request(), context)).status).toBe(200);
    expect(mocks.deleteFile.mock.calls).toEqual([["file-1"], ["file-2"]]);
  });
  it("reports partial Drive cleanup honestly after a successful ledger deletion", async () => {
    mocks.remove.mockResolvedValue({ expense, files: [{ driveFileId: "file-1" }] });
    mocks.deleteFile.mockRejectedValue(new Error("Drive unavailable"));
    const response = await DELETE(request(), context);
    expect(response.status).toBe(200);
    expect((await response.json()).warning).toContain("sigue en Drive");
  });
  it.each([PATCH, DELETE])(
    "requires admin authorization before touching records",
    async (handler) => {
      mocks.auth.mockResolvedValue({
        session: null,
        response: new Response(null, { status: 403 })
      });
      expect((await handler(request(), context)).status).toBe(403);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.remove).not.toHaveBeenCalled();
    }
  );
  it.each([PATCH, DELETE])("returns 404 for a missing record", async (handler) => {
    mocks.update.mockResolvedValue(null);
    mocks.remove.mockResolvedValue(null);
    expect((await handler(request(), context)).status).toBe(404);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
  it.each([{ amount: "0" }, { vatRate: -1 }, { date: "2026-02-30" }, { currency: "BAD" }])(
    "rejects invalid changes %j",
    async (change) => {
      expect((await PATCH(request({ ...payload, ...change }), context)).status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    }
  );
  it("leaves files alone when the ledger operation fails", async () => {
    mocks.remove.mockRejectedValue(new Error("Sheets failed"));
    expect((await DELETE(request(), context)).status).toBe(500);
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
