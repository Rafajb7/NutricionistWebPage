import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildFinanceDashboard } from "@/lib/finance/calculations";
import {
  financeExpenseRequestSchema,
  parseRequiredAmountToCents
} from "@/lib/finance/validation";
import { createFinanceExpense, listFinanceRecords } from "@/lib/google/finance";
import { logError, logInfo } from "@/lib/logger";

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = financeExpenseRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const expense = await createFinanceExpense({
      date: parsed.data.date,
      category: parsed.data.category,
      description: parsed.data.description,
      amountCents: parseRequiredAmountToCents(parsed.data.amount),
      currency: parsed.data.currency,
      notes: parsed.data.notes
    });
    const finance = await listFinanceRecords();

    logInfo("Finance expense created", {
      username: auth.session.username,
      expenseId: expense.id,
      amountCents: expense.amountCents
    });

    return NextResponse.json({
      ok: true,
      expense,
      dashboard: buildFinanceDashboard({
        contracts: finance.contracts,
        payments: finance.payments,
        expenses: finance.expenses
      })
    });
  } catch (error) {
    logError("Failed to create finance expense", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create expense." }, { status: 500 });
  }
}
