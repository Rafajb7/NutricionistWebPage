import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildFinanceDashboard } from "@/lib/finance/calculations";
import { isValidFinanceId } from "@/lib/finance/validation";
import {
  deleteFinanceExpenseInvoiceFile,
  listFinanceRecords
} from "@/lib/google/finance";
import { deleteDriveFileById } from "@/lib/google/drive";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{
    expenseInvoiceFileId: string;
  }>;
};

export async function DELETE(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { expenseInvoiceFileId } = await context.params;
  if (!isValidFinanceId(expenseInvoiceFileId)) {
    return NextResponse.json({ error: "Identificador de factura no valido." }, { status: 400 });
  }

  try {
    const deleted = await deleteFinanceExpenseInvoiceFile(expenseInvoiceFileId);
    if (!deleted) {
      return NextResponse.json({ error: "No se encontro la factura cargada." }, { status: 404 });
    }

    await deleteDriveFileById(deleted.driveFileId).catch((error) => {
      logError("Failed to delete finance expense invoice PDF from Drive", {
        username: auth.session?.username,
        driveFileId: deleted.driveFileId,
        error
      });
    });
    const finance = await listFinanceRecords();

    logInfo("Finance expense invoice deleted", {
      username: auth.session.username,
      expenseInvoiceFileId,
      expenseId: deleted.expenseId,
      driveFileId: deleted.driveFileId
    });

    return NextResponse.json({
      ok: true,
      deleted,
      expenses: finance.expenses,
      expenseInvoiceFiles: finance.expenseInvoiceFiles,
      dashboard: buildFinanceDashboard({
        contracts: finance.contracts,
        payments: finance.payments,
        expenses: finance.expenses
      })
    });
  } catch (error) {
    logError("Failed to delete finance expense invoice", {
      username: auth.session.username,
      expenseInvoiceFileId,
      error
    });
    return NextResponse.json({ error: "No se pudo eliminar el PDF de la factura." }, { status: 500 });
  }
}
