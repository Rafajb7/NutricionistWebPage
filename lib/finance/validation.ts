import { z } from "zod";
import { isIsoDate, parseCurrencyToCents } from "@/lib/finance/calculations";

const optionalText = z.string().max(1000).optional();

const idSchema = z.string().min(8).max(160);

const dateSchema = z.string().refine(isIsoDate, "Invalid date.");

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
