import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import { renderFinanceInvoicePdf } from "@/lib/finance/invoice-pdf";
import { isValidFinanceId } from "@/lib/finance/validation";
import { getFinanceInvoiceById } from "@/lib/google/finance";
import { logError } from "@/lib/logger";

type RouteContext = {
  params: Promise<{
    invoiceId: string;
  }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

function sanitizeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
}

export async function GET(_req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { invoiceId } = await context.params;
  if (!isValidFinanceId(invoiceId)) {
    return NextResponse.json({ error: "Invalid invoice id." }, { status: 400 });
  }

  try {
    const invoice = await getFinanceInvoiceById(invoiceId);
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404 });

    const pdf = await renderFinanceInvoicePdf(invoice);
    const fileName = `${sanitizeFileName(invoice.invoiceNumber)}.pdf`;

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    logError("Failed to generate finance invoice PDF", {
      username: auth.session.username,
      invoiceId,
      error
    });
    return NextResponse.json({ error: "Could not generate invoice PDF." }, { status: 500 });
  }
}
