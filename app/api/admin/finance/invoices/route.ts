import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireAdminSession } from "@/lib/auth/require-session";
import { calculateFinanceInvoiceTotals } from "@/lib/finance/calculations";
import { financeInvoiceRequestSchema, parseRequiredAmountToCents } from "@/lib/finance/validation";
import { createFinanceInvoice, listFinanceRecords } from "@/lib/google/finance";
import { logError, logInfo } from "@/lib/logger";

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = financeInvoiceRequestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const lineItems = parsed.data.lineItems.map((line) => ({
      id: line.id?.trim() || randomUUID(),
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: parseRequiredAmountToCents(line.unitPrice),
      discountPercent: line.discountPercent,
      vatRate: line.vatRate
    }));
    const invoice = await createFinanceInvoice({
      series: parsed.data.series,
      sequenceNumber: parsed.data.sequenceNumber,
      issueDate: parsed.data.issueDate,
      operationDate: parsed.data.operationDate || undefined,
      dueDate: parsed.data.dueDate || undefined,
      client: {
        name: parsed.data.client.name,
        taxId: parsed.data.client.taxId,
        address: parsed.data.client.address,
        postalCode: parsed.data.client.postalCode ?? "",
        city: parsed.data.client.city ?? "",
        province: parsed.data.client.province ?? "",
        country: parsed.data.client.country,
        email: parsed.data.client.email ?? ""
      },
      lineItems,
      irpfRate: parsed.data.irpfRate,
      currency: parsed.data.currency,
      paymentMethod: parsed.data.paymentMethod,
      notes: parsed.data.notes
    });
    const finance = await listFinanceRecords();

    logInfo("Finance invoice created", {
      username: auth.session.username,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber
    });

    return NextResponse.json({
      ok: true,
      invoice,
      invoices: finance.invoices,
      invoiceSettings: finance.invoiceSettings,
      previewTotals: calculateFinanceInvoiceTotals(lineItems, parsed.data.irpfRate)
    });
  } catch (error) {
    logError("Failed to create finance invoice", {
      username: auth.session.username,
      error
    });
    return NextResponse.json({ error: "Could not create invoice." }, { status: 500 });
  }
}
