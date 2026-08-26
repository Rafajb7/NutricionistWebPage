import type { z } from "zod";
import {
  parseOptionalAmountToCents,
  parseRequiredAmountToCents,
  financeContractRequestSchema
} from "@/lib/finance/validation";
import type {
  CreateFinanceContractInput,
  FinanceAthlete,
  FinancePlanOption
} from "@/lib/finance/types";

export type FinanceContractRequest = z.infer<typeof financeContractRequestSchema>;

export function buildCreateFinanceContractInput(input: {
  payload: FinanceContractRequest;
  athlete: Pick<FinanceAthlete, "username" | "name">;
  planOptions: FinancePlanOption[];
}): CreateFinanceContractInput {
  const option = input.planOptions.find((item) => item.key === input.payload.planKey);
  const planLabel = input.payload.planLabel?.trim() || option?.label;
  const durationMonths = input.payload.durationMonths ?? option?.durationMonths;
  if (!planLabel || !durationMonths) {
    throw new Error("Invalid finance plan.");
  }

  const financed = input.payload.financed;
  return {
    athleteUsername: input.athlete.username,
    athleteName: input.athlete.name,
    planKey: input.payload.planKey,
    planLabel,
    durationMonths,
    startDate: input.payload.startDate,
    firstPaymentDate: input.payload.firstPaymentDate,
    totalAmountCents: parseRequiredAmountToCents(input.payload.totalAmount),
    currency: input.payload.currency.toUpperCase(),
    financed,
    paymentCount: financed ? input.payload.paymentCount : 1,
    paymentAmountCents: financed
      ? parseOptionalAmountToCents(input.payload.paymentAmount)
      : null,
    paymentIntervalMonths: financed ? input.payload.paymentIntervalMonths : 1,
    previousContractId: input.payload.previousContractId,
    idempotencyKey: input.payload.idempotencyKey,
    notes: input.payload.notes?.trim() ?? ""
  };
}
