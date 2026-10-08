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
  const total = parseRequiredAmountToCents(input.payload.totalAmount);
  const reservation = parseOptionalAmountToCents(input.payload.reservationAmount) ?? 0;
  if (reservation > total) throw new Error("La reserva no puede superar el importe total.");
  const count = financed ? input.payload.paymentCount : 1;
  if (total > reservation && total - reservation < count) throw new Error("El saldo no permite tantas cuotas.");
  return {
    athleteUsername: input.athlete.username,
    athleteName: input.athlete.name,
    planKey: input.payload.planKey,
    planLabel,
    durationMonths,
    startDate: input.payload.startDate,
    firstPaymentDate: input.payload.firstPaymentDate,
    totalAmountCents: total,
    reservationAmountCents: reservation,
    currency: input.payload.currency.toUpperCase(),
    financed,
    paymentCount: financed ? input.payload.paymentCount : 1,
    paymentAmountCents: Math.ceil((total - reservation) / count),
    paymentIntervalMonths: financed ? input.payload.paymentIntervalMonths : 1,
    previousContractId: input.payload.previousContractId,
    idempotencyKey: input.payload.idempotencyKey,
    notes: input.payload.notes?.trim() ?? ""
  };
}
