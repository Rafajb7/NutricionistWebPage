import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { financeInvoiceSettingsRequestSchema } from "@/lib/finance/validation";
import { updateFinanceInvoiceSettings } from "@/lib/google/finance";
import { logError, logInfo } from "@/lib/logger";

export async function PATCH(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = financeInvoiceSettingsRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const settings = await updateFinanceInvoiceSettings(parsed.data);

    logInfo("Finance invoice settings updated", {
      username: auth.session.username
    });

    return NextResponse.json({ ok: true, invoiceSettings: settings });
  } catch (error) {
    logError("Failed to update finance invoice settings", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not update invoice settings." }, { status: 500 });
  }
}
