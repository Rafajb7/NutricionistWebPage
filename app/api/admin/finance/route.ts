import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildFinanceDashboard } from "@/lib/finance/calculations";
import { listFinanceRecords } from "@/lib/google/finance";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { logError } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const [users, finance] = await Promise.all([readUsersFromSheet(), listFinanceRecords()]);
    const athletes = users
      .filter((user) => user.permission === "user")
      .map((user) => ({
        username: normalizeUsername(user.username),
        name: user.name.trim(),
        email: user.email.trim()
      }))
      .filter((user) => user.username)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    return NextResponse.json({
      athletes,
      contracts: finance.contracts,
      payments: finance.payments,
      planOptions: finance.planOptions,
      dashboard: buildFinanceDashboard({
        contracts: finance.contracts,
        payments: finance.payments
      })
    });
  } catch (error) {
    logError("Failed to load finance data", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not load finance data." }, { status: 500 });
  }
}
