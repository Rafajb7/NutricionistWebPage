import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { buildCreateFinanceContractInput } from "@/lib/finance/contract-input";
import { financeContractRequestSchema } from "@/lib/finance/validation";
import { createFinanceContractWithPayments, listFinanceRecords } from "@/lib/google/finance";
import { readUsersFromSheet } from "@/lib/google/sheets";
import { logError, logInfo } from "@/lib/logger";

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = financeContractRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const targetUsername = normalizeUsername(parsed.data.athleteUsername);
    const [users, finance] = await Promise.all([readUsersFromSheet(), listFinanceRecords()]);
    const athlete = users.find((user) => normalizeUsername(user.username) === targetUsername);
    if (!athlete || athlete.permission !== "user") {
      return NextResponse.json({ error: "Athlete not found." }, { status: 404 });
    }

    const input = buildCreateFinanceContractInput({
      payload: parsed.data,
      athlete: {
        username: normalizeUsername(athlete.username),
        name: athlete.name.trim()
      },
      planOptions: finance.planOptions
    });
    const result = await createFinanceContractWithPayments(input);

    logInfo("Finance contract created", {
      username: auth.session.username,
      athleteUsername: targetUsername,
      contractId: result.contract.id,
      created: result.created
    });

    return NextResponse.json({
      ok: true,
      contract: result.contract,
      payments: result.payments,
      created: result.created
    });
  } catch (error) {
    logError("Failed to create finance contract", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create finance contract." }, { status: 500 });
  }
}
