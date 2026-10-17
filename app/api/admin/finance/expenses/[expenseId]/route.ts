import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildFinanceDashboard } from "@/lib/finance/calculations";
import {
  financeExpenseRequestSchema,
  isValidFinanceId,
  parseRequiredAmountToCents
} from "@/lib/finance/validation";
import {
  deleteFinanceExpense,
  listFinanceRecords,
  updateFinanceExpense
} from "@/lib/google/finance";
import { deleteDriveFileById } from "@/lib/google/drive";
import { logError, logInfo } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 30;
type Context = { params: Promise<{ expenseId: string }> };

export async function PATCH(req: Request, context: Context) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;
  const { expenseId } = await context.params;
  if (!isValidFinanceId(expenseId))
    return NextResponse.json({ error: "Identificador de gasto no válido." }, { status: 400 });
  try {
    const parsed = financeExpenseRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Revisa la fecha, descripción, importe, moneda e IVA." },
        { status: 400 }
      );
    const { amount, ...input } = parsed.data;
    const expense = await updateFinanceExpense(expenseId, {
      ...input,
      amountCents: parseRequiredAmountToCents(amount)
    });
    if (!expense) return NextResponse.json({ error: "No se encontró el gasto." }, { status: 404 });
    const finance = await listFinanceRecords();
    logInfo("Finance expense updated", { username: auth.session.username, expenseId });
    return NextResponse.json({ ok: true, expense, dashboard: buildFinanceDashboard(finance) });
  } catch (error) {
    logError("Failed to update finance expense", { expenseId, error });
    return NextResponse.json({ error: "No se pudo actualizar el gasto." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: Context) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;
  const { expenseId } = await context.params;
  if (!isValidFinanceId(expenseId))
    return NextResponse.json({ error: "Identificador de gasto no válido." }, { status: 400 });
  try {
    const deleted = await deleteFinanceExpense(expenseId);
    if (!deleted) return NextResponse.json({ error: "No se encontró el gasto." }, { status: 404 });
    let attachmentCleanupFailed = false;
    for (const file of deleted.files) {
      if (!file.driveFileId) continue;
      try {
        await deleteDriveFileById(file.driveFileId);
      } catch (error) {
        attachmentCleanupFailed = true;
        logError("Failed to delete expense attachment from Drive", {
          expenseId,
          driveFileId: file.driveFileId,
          error
        });
      }
    }
    const finance = await listFinanceRecords();
    logInfo("Finance expense deleted", { username: auth.session.username, expenseId });
    return NextResponse.json({
      ok: true,
      expenses: finance.expenses,
      expenseInvoiceFiles: finance.expenseInvoiceFiles,
      dashboard: buildFinanceDashboard(finance),
      warning: attachmentCleanupFailed
        ? "El gasto se eliminó, pero algún PDF sigue en Drive. Puedes retirarlo desde la carpeta de facturas."
        : undefined
    });
  } catch (error) {
    logError("Failed to delete finance expense", { expenseId, error });
    return NextResponse.json({ error: "No se pudo eliminar el gasto." }, { status: 500 });
  }
}
