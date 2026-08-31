import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  financePaymentUpdateRequestSchema,
  isValidFinanceId,
  parseOptionalAmountToCents
} from "@/lib/finance/validation";
import { updateFinancePayment } from "@/lib/google/finance";
import { logError, logInfo } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    paymentId: string;
  }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { paymentId } = await context.params;
  if (!isValidFinanceId(paymentId)) {
    return NextResponse.json({ error: "Invalid payment id." }, { status: 400 });
  }

  try {
    const parsed = financePaymentUpdateRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const expectedAmountCents =
      parsed.data.expectedAmount !== undefined
        ? parseOptionalAmountToCents(parsed.data.expectedAmount)
        : undefined;
    const paidAmountCents =
      parsed.data.paidAmount !== undefined
        ? parseOptionalAmountToCents(parsed.data.paidAmount)
        : undefined;

    const payment = await updateFinancePayment({
      paymentId,
      status: parsed.data.status,
      dueDate: parsed.data.dueDate,
      expectedAmountCents: expectedAmountCents ?? undefined,
      paidAt: parsed.data.paidAt,
      paidAmountCents: paidAmountCents ?? undefined,
      notes: parsed.data.notes
    });
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });

    logInfo("Finance payment updated", {
      username: auth.session.username,
      paymentId,
      status: payment.status
    });

    return NextResponse.json({ ok: true, payment });
  } catch (error) {
    logError("Failed to update finance payment", {
      username: auth.session.username,
      paymentId,
      error
    });
    return NextResponse.json({ error: "Could not update finance payment." }, { status: 500 });
  }
}
