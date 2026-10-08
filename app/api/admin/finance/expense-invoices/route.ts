import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { financeExpenseRequestSchema, parseRequiredAmountToCents } from "@/lib/finance/validation";
import {
  createFinanceExpenseWithInvoiceFile
} from "@/lib/google/finance";
import {
  deleteDriveFileById,
  uploadFinanceExpenseInvoicePdf
} from "@/lib/google/drive";
import { getEnv } from "@/lib/env";
import { MAX_FINANCE_INVOICE_MB } from "@/lib/finance/upload-limits";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const form = await req.formData();
    const file = form.get("invoice");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No se ha subido ningun PDF." }, { status: 400 });
    }
    if (!isPdfFile(file)) {
      return NextResponse.json({ error: "Solo se admiten facturas en PDF." }, { status: 400 });
    }

    const maxUploadMb = Math.min(getEnv().MAX_UPLOAD_MB, MAX_FINANCE_INVOICE_MB);
    const maxBytes = maxUploadMb * 1024 * 1024;
    if (file.size === 0) return NextResponse.json({ error: "El PDF está vacío." }, { status: 400 });
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `Archivo demasiado grande. Maximo ${maxUploadMb} MB.` }, { status: 413 });
    }

    const parsed = financeExpenseRequestSchema.safeParse({
      date: form.get("date"), category: form.get("category"), description: form.get("description"),
      amount: form.get("amount"), currency: form.get("currency"), vatRate: form.get("vatRate"),
      vatDeductible: form.get("vatDeductible") === "true", notes: form.get("notes") || ""
    });
    if (!parsed.success) return NextResponse.json({ error: "Revisa la fecha, descripción, importe bruto, moneda e IVA." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) return NextResponse.json({ error: "El archivo no es un PDF válido." }, { status: 400 });
    const uploaded = await uploadFinanceExpenseInvoicePdf({
      originalFileName: `${parsed.data.description} ${parsed.data.date}.pdf`,
      mimeType: file.type || "application/pdf",
      buffer
    });

    try {
      const created = await createFinanceExpenseWithInvoiceFile({
        expense: {
          ...parsed.data,
          amountCents: parseRequiredAmountToCents(parsed.data.amount)
        },
        driveFileId: uploaded.id,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        webViewLink: uploaded.webViewLink,
        parsedDate: parsed.data.date,
        parsedAmountCents: parseRequiredAmountToCents(parsed.data.amount),
        parsedSupplier: parsed.data.description

      });

      logInfo("Finance expense invoice uploaded", {
        username: auth.session.username,
        expenseId: created.expense?.id ?? "",
        driveFileId: uploaded.id,
        amountCents: created.expense?.amountCents ?? 0,
        status: created.expenseInvoiceFile.status
      });

      return NextResponse.json({
        ok: true,
        expense: created.expense,
        expenseInvoiceFile: created.expenseInvoiceFile
      });
    } catch (error) {
      await deleteDriveFileById(uploaded.id).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    logError("Failed to upload finance expense invoice", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "No se pudo cargar el PDF de la factura." }, { status: 500 });
  }
}
