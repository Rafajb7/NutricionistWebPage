import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { isValidFinanceId } from "@/lib/finance/validation";
import { listFinanceRecords } from "@/lib/google/finance";
import { downloadDriveFile } from "@/lib/google/drive";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: Request, context: { params: Promise<{ expenseInvoiceFileId: string }> }) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;
  const { expenseInvoiceFileId } = await context.params;
  if (!isValidFinanceId(expenseInvoiceFileId)) return NextResponse.json({ error: "Identificador no válido." }, { status: 400 });
  try {
    const finance = await listFinanceRecords();
    const file = finance.expenseInvoiceFiles.find(item => item.id === expenseInvoiceFileId);
    if (!file) return NextResponse.json({ error: "Factura no encontrada." }, { status: 404 });
    const pdf = await downloadDriveFile(file.driveFileId);
    return new NextResponse(new Uint8Array(pdf.data), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="factura.pdf"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store"
      }
    });
  } catch (error) {
    logError("Failed to open expense invoice", { expenseInvoiceFileId, error });
    return NextResponse.json({ error: "No se pudo abrir la factura." }, { status: 500 });
  }
}
