import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildFinanceDashboard } from "@/lib/finance/calculations";
import {
  parseExpenseInvoicePdf,
  type ParsedExpenseInvoicePdf
} from "@/lib/finance/expense-invoice-parser";
import {
  createFinanceExpenseWithInvoiceFile,
  listFinanceRecords
} from "@/lib/google/finance";
import {
  deleteDriveFileById,
  uploadFinanceExpenseInvoicePdf
} from "@/lib/google/drive";
import { getEnv } from "@/lib/env";
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

    const maxUploadMb = getEnv().MAX_UPLOAD_MB;
    const maxBytes = maxUploadMb * 1024 * 1024;
    if (file.size > maxBytes) {
      return NextResponse.json({ error: `Archivo demasiado grande. Maximo ${maxUploadMb} MB.` }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploaded = await uploadFinanceExpenseInvoicePdf({
      originalFileName: file.name,
      mimeType: file.type || "application/pdf",
      buffer
    });

    try {
      let parsed: ParsedExpenseInvoicePdf | null = null;
      let parseError = "";
      try {
        parsed = await parseExpenseInvoicePdf(buffer, file.name);
      } catch (error) {
        parseError = "No se pudo leer el texto del PDF.";
        logError("Failed to parse finance expense invoice PDF", {
          username: auth.session.username,
          fileName: file.name,
          error
        });
      }

      const canCreateExpense = Boolean(parsed?.date && parsed.amountCents);
      if (!canCreateExpense && !parseError) {
        parseError =
          "No se pudo detectar la fecha y el importe total para crear el gasto automaticamente.";
      }

      const created = await createFinanceExpenseWithInvoiceFile({
        expense: canCreateExpense
          ? {
              date: parsed!.date!,
              category: parsed!.category,
              description: parsed!.supplier
                ? `Factura ${parsed!.supplier}`
                : file.name.replace(/\.pdf$/i, ""),
              amountCents: parsed!.amountCents!,
              currency: "EUR",
              notes: `PDF cargado automaticamente: ${uploaded.name}`
            }
          : null,
        driveFileId: uploaded.id,
        fileName: uploaded.name,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        webViewLink: uploaded.webViewLink,
        parsedDate: parsed?.date ?? "",
        parsedAmountCents: parsed?.amountCents ?? 0,
        parsedSupplier: parsed?.supplier ?? "",
        textPreview: parsed?.textPreview ?? "",
        parseError
      });
      const finance = await listFinanceRecords();

      logInfo("Finance expense invoice uploaded", {
        username: auth.session.username,
        expenseId: created.expense?.id ?? "",
        driveFileId: uploaded.id,
        amountCents: created.expense?.amountCents ?? 0,
        status: created.expenseInvoiceFile.status
      });

      return NextResponse.json({
        ok: true,
        autoExpenseCreated: Boolean(created.expense),
        expense: created.expense,
        expenseInvoiceFile: created.expenseInvoiceFile,
        expenses: finance.expenses,
        expenseInvoiceFiles: finance.expenseInvoiceFiles,
        dashboard: buildFinanceDashboard({
          contracts: finance.contracts,
          payments: finance.payments,
          expenses: finance.expenses
        })
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
