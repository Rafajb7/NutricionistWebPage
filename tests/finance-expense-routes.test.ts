import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), upload: vi.fn(), save: vi.fn(), remove: vi.fn(), list: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/lib/google/drive", () => ({ uploadFinanceExpenseInvoicePdf: mocks.upload, deleteDriveFileById: mocks.remove, downloadDriveFile: mocks.download }));
vi.mock("@/lib/google/finance", () => ({ createFinanceExpenseWithInvoiceFile: mocks.save, listFinanceRecords: mocks.list }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MAX_UPLOAD_MB: 4 }) }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { POST } from "@/app/api/admin/finance/expense-invoices/route";
import { GET } from "@/app/api/admin/finance/expense-invoices/[expenseInvoiceFileId]/pdf/route";

function request(overrides: Record<string, string> = {}, pdf = "%PDF-1.7\nexample") {
  const form = new FormData();
  Object.entries({ date: "2026-10-08", description: "Alquiler consulta", category: "Local", amount: "121,00", currency: "EUR", vatRate: "21", vatDeductible: "true", ...overrides }).forEach(([key, value]) => form.append(key, value));
  form.append("invoice", new File([pdf], "original.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/admin/finance/expense-invoices", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { username: "admin" } });
  mocks.upload.mockResolvedValue({ id: "drive-id", name: "Alquiler consulta 2026-10-08.pdf", mimeType: "application/pdf", sizeBytes: 30, webViewLink: "" });
  mocks.save.mockImplementation(async input => ({ expense: { id: "expense-id", ...input.expense }, expenseInvoiceFile: { id: "invoice-id", ...input } }));
  mocks.remove.mockResolvedValue(undefined);
});

describe("manual expense invoice API", () => {
  it("persists the manual fields and names the Drive attachment after description and date", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ originalFileName: "Alquiler consulta 2026-10-08.pdf" }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ expense: expect.objectContaining({ amountCents: 12100, date: "2026-10-08", currency: "EUR", vatRate: 21, vatDeductible: true }) }));
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ amount: "" }, { vatRate: "101" }, { currency: "XYZ" }, { date: "invalid" }])("rejects invalid manual input before uploading: %j", async overrides => {
    expect((await POST(request(overrides))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects fake PDFs before uploading", async () => {
    expect((await POST(request({}, "not a pdf"))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("rejects oversized attachments before calling Drive", async () => {
    expect((await POST(request({}, "%PDF-" + "x".repeat(4 * 1024 * 1024)))).status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("removes an uploaded file when persistence fails", async () => {
    mocks.save.mockRejectedValue(new Error("Sheets unavailable"));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith("drive-id");
  });
  it("requires an admin session before reading or writing a PDF", async () => {
    mocks.auth.mockResolvedValue({ session: null, response: new Response(null, { status: 403 }) });
    expect((await POST(request())).status).toBe(403);
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ expenseInvoiceFileId: "invoice-id" }) })).status).toBe(403);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("opens only an attached finance PDF through the authenticated proxy", async () => {
    mocks.list.mockResolvedValue({ expenseInvoiceFiles: [{ id: "invoice-id", driveFileId: "drive-id", fileName: "Factura.pdf" }] });
    mocks.download.mockResolvedValue({ data: Buffer.from("%PDF-1.7"), name: "Factura.pdf", mimeType: "application/pdf" });
    const context = { params: Promise.resolve({ expenseInvoiceFileId: "invoice-id" }) };
    const response = await GET(new Request("http://localhost"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(mocks.download).toHaveBeenCalledWith("drive-id");
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ expenseInvoiceFileId: "unknown-id" }) })).status).toBe(404);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
});
