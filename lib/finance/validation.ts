import { z } from "zod";
import { isIsoDate, parseCurrencyToCents } from "@/lib/finance/calculations";

const optionalText = z.string().max(1000).optional();
const optionalShortText = z.string().trim().max(240).optional();

const idSchema = z.string().min(8).max(160);

const dateSchema = z.string().refine(isIsoDate, "Invalid date.");
const optionalDateSchema = dateSchema.optional().or(z.literal(""));

const amountSchema = z
  .string()
  .min(1)
  .max(40)
  .refine((value) => {
    const cents = parseCurrencyToCents(value);
    return cents !== null && cents > 0;
  }, "Invalid amount.");

const optionalAmountSchema = z
  .string()
  .max(40)
  .optional()
  .refine((value) => {
    if (!value?.trim()) return true;
    const cents = parseCurrencyToCents(value);
    return cents !== null && cents > 0;
  }, "Invalid amount.");

export const financeContractRequestSchema = z.object({
  athleteUsername: z.string().min(1).max(120),
  planKey: z.string().min(1).max(80),
  planLabel: z.string().min(1).max(120).optional(),
  durationMonths: z.coerce.number().int().min(1).max(120).optional(),
  startDate: dateSchema,
  firstPaymentDate: dateSchema,
  totalAmount: amountSchema,
  currency: z.string().trim().min(3).max(3).default("EUR"),
  financed: z.coerce.boolean().default(false),
  paymentCount: z.coerce.number().int().min(1).max(120).default(1),
  paymentAmount: optionalAmountSchema,
  paymentIntervalMonths: z.coerce.number().int().min(1).max(60).default(1),
  previousContractId: z.string().max(160).optional(),
  idempotencyKey: z.string().max(160).optional(),
  notes: optionalText
});

export const financeContractOnUserCreateSchema = financeContractRequestSchema.omit({
  athleteUsername: true
});

export const financePaymentUpdateRequestSchema = z
  .object({
    status: z.enum(["pending", "paid", "cancelled"]).optional(),
    dueDate: dateSchema.optional(),
    expectedAmount: optionalAmountSchema,
    paidAt: dateSchema.optional().or(z.literal("")),
    paidAmount: optionalAmountSchema,
    notes: optionalText
  })
  .refine((value) => Object.keys(value).length > 0, "Empty update.");

export const financeContractUpdateRequestSchema = z
  .object({
    status: z.enum(["active", "finished", "cancelled"]).optional(),
    notes: optionalText,
    cancelPendingFuturePayments: z.coerce.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "Empty update.");

export const financeExpenseRequestSchema = z.object({
  date: dateSchema,
  category: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(180),
  amount: amountSchema,
  currency: z.string().trim().min(3).max(3).default("EUR"),
  notes: optionalText
});

export const financeInvoiceSettingsRequestSchema = z.object({
  businessName: z.string().trim().max(180).optional(),
  taxId: z.string().trim().max(40).optional(),
  address: z.string().trim().max(240).optional(),
  postalCode: z.string().trim().max(20).optional(),
  city: z.string().trim().max(120).optional(),
  province: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  email: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(60).optional(),
  website: z.string().trim().max(160).optional(),
  invoiceSeries: z.string().trim().min(1).max(40).optional(),
  nextInvoiceNumber: z.coerce.number().int().min(1).max(999999).optional(),
  defaultVatRate: z.coerce.number().min(0).max(100).optional(),
  defaultIrpfRate: z.coerce.number().min(0).max(100).optional(),
  paymentMethod: z.string().trim().max(160).optional(),
  bankIban: z.string().trim().max(80).optional(),
  notes: optionalText
});

export const financeInvoiceRequestSchema = z.object({
  series: z.string().trim().min(1).max(40).optional(),
  sequenceNumber: z.coerce.number().int().min(1).max(999999).optional(),
  issueDate: dateSchema,
  operationDate: optionalDateSchema,
  dueDate: optionalDateSchema,
  client: z.object({
    name: z.string().trim().min(1).max(180),
    taxId: z.string().trim().min(1).max(40),
    address: z.string().trim().min(1).max(240),
    postalCode: z.string().trim().max(20).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    country: z.string().trim().max(80).default("Espana"),
    email: z.string().trim().max(160).optional()
  }),
  lineItems: z
    .array(
      z.object({
        id: z.string().trim().max(120).optional(),
        description: z.string().trim().min(1).max(240),
        quantity: z.coerce.number().positive().max(9999),
        unitPrice: amountSchema,
        discountPercent: z.coerce.number().min(0).max(100).default(0),
        vatRate: z.coerce.number().min(0).max(100).default(21)
      })
    )
    .min(1)
    .max(20),
  irpfRate: z.coerce.number().min(0).max(100).default(0),
  currency: z.string().trim().min(3).max(3).default("EUR"),
  paymentMethod: optionalShortText,
  notes: optionalText
});

export function parseRequiredAmountToCents(value: string): number {
  const cents = parseCurrencyToCents(value);
  if (cents === null || cents <= 0) {
    throw new Error("Invalid amount.");
  }
  return cents;
}

export function parseOptionalAmountToCents(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const cents = parseCurrencyToCents(value);
  if (cents === null || cents < 0) {
    throw new Error("Invalid amount.");
  }
  return cents;
}

export function isValidFinanceId(value: string): boolean {
  return idSchema.safeParse(value).success;
}
