import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  financeContractUpdateRequestSchema,
  isValidFinanceId
} from "@/lib/finance/validation";
import { todayIsoDate } from "@/lib/finance/calculations";
import { updateFinanceContract } from "@/lib/google/finance";
import { logError, logInfo } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    contractId: string;
  }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { contractId } = await context.params;
  if (!isValidFinanceId(contractId)) {
    return NextResponse.json({ error: "Invalid contract id." }, { status: 400 });
  }

  try {
    const parsed = financeContractUpdateRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const result = await updateFinanceContract({
      contractId,
      status: parsed.data.status,
      notes: parsed.data.notes,
      cancelPendingFuturePayments: parsed.data.cancelPendingFuturePayments,
      today: todayIsoDate()
    });
    if (!result.contract) {
      return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    }

    logInfo("Finance contract updated", {
      username: auth.session.username,
      contractId,
      status: result.contract.status,
      cancelledPayments: result.cancelledPayments
    });

    return NextResponse.json({
      ok: true,
      contract: result.contract,
      cancelledPayments: result.cancelledPayments
    });
  } catch (error) {
    logError("Failed to update finance contract", {
      username: auth.session.username,
      contractId,
      error
    });
    return NextResponse.json({ error: "Could not update finance contract." }, { status: 500 });
  }
}
