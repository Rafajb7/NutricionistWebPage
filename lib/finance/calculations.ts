import type {
  CreateFinanceContractInput,
  FinanceContract,
  FinanceDashboard,
  FinanceMonthlyPoint,
  FinancePayment,
  FinancePaymentStatus,
  FinanceRenewalAlert
} from "@/lib/finance/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function todayIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDateOnly(value);
  return toIsoDate(date) === value;
}

export function parseDateOnly(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

export function addMonths(date: string, months: number): string {
  const parsed = parseDateOnly(date);
  const originalDay = parsed.getUTCDate();
  const targetMonthIndex = parsed.getUTCMonth() + months;
  const targetYear = parsed.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetMonth = normalizedMonthIndex + 1;
  const clampedDay = Math.min(originalDay, daysInMonth(targetYear, targetMonth));
  return toIsoDate(new Date(Date.UTC(targetYear, normalizedMonthIndex, clampedDay)));
}

export function differenceInCalendarDays(date: string, baseDate: string): number {
  const target = parseDateOnly(date).getTime();
  const base = parseDateOnly(baseDate).getTime();
  return Math.round((target - base) / DAY_MS);
}

export function getMonthRange(date: string): { start: string; end: string; month: string } {
  const parsed = parseDateOnly(date);
  const year = parsed.getUTCFullYear();
  const monthIndex = parsed.getUTCMonth();
  const start = toIsoDate(new Date(Date.UTC(year, monthIndex, 1)));
  const end = toIsoDate(new Date(Date.UTC(year, monthIndex + 1, 0)));
  return { start, end, month: start.slice(0, 7) };
}

export function getContractDates(startDate: string, durationMonths: number) {
  const normalizedDuration = Math.max(1, Math.trunc(durationMonths));
  const endDate = addDays(addMonths(startDate, normalizedDuration), -1);
  return {
    endDate,
    renewalDueDate: addDays(endDate, 1)
  };
}

export function parseCurrencyToCents(value: string): number | null {
  const raw = String(value ?? "")
    .trim()
    .replace(/[^\d,.\-]/g, "");
  if (!raw || raw === "-" || raw === "," || raw === ".") return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  let normalized = raw;

  if (hasComma && hasDot) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const lastDot = raw.lastIndexOf(".");
    const decimals = raw.length - lastDot - 1;
    normalized = decimals > 0 && decimals <= 2 ? raw : raw.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatCents(cents: number, currency = "EUR"): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(safeCents / 100);
}

export function splitAmountCents(totalCents: number, paymentCount: number): number[] {
  const count = Math.max(1, Math.trunc(paymentCount));
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function getComputedPaymentStatus(
  payment: Pick<FinancePayment, "status" | "dueDate">,
  today = todayIsoDate()
): FinancePaymentStatus | "overdue" {
  if (payment.status === "paid" || payment.status === "cancelled") return payment.status;
  return payment.dueDate < today ? "overdue" : "pending";
}

export function buildFinancePaymentsForContract(
  input: CreateFinanceContractInput,
  contractId: string,
  now: string,
  createId: () => string
): FinancePayment[] {
  const count = input.financed ? Math.max(1, Math.trunc(input.paymentCount)) : 1;
  const intervalMonths = Math.max(1, Math.trunc(input.paymentIntervalMonths));
  const amounts =
    input.financed && input.paymentAmountCents !== null && input.paymentAmountCents > 0
      ? Array.from({ length: count }, () => input.paymentAmountCents ?? 0)
      : splitAmountCents(input.totalAmountCents, count);

  return Array.from({ length: count }, (_, index) => ({
    id: createId(),
    contractId,
    athleteUsername: input.athleteUsername,
    athleteName: input.athleteName,
    planLabel: input.planLabel,
    dueDate: addMonths(input.firstPaymentDate, index * intervalMonths),
    expectedAmountCents: amounts[index] ?? 0,
    status: "pending",
    paidAt: "",
    paidAmountCents: 0,
    sequenceIndex: index + 1,
    sequenceCount: count,
    notes: "",
    createdAt: now,
    updatedAt: now
  }));
}

function isBetween(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function buildLastMonthKeys(today: string, count: number): string[] {
  const startMonth = `${today.slice(0, 7)}-01`;
  return Array.from({ length: count }, (_, index) =>
    addMonths(startMonth, index - (count - 1)).slice(0, 7)
  );
}

function hasRegisteredRenewal(contract: FinanceContract, contracts: FinanceContract[]): boolean {
  return contracts.some((candidate) => {
    if (candidate.id === contract.id || candidate.status === "cancelled") return false;
    if (candidate.previousContractId === contract.id) return true;
    return (
      candidate.athleteUsername === contract.athleteUsername &&
      candidate.startDate >= contract.renewalDueDate
    );
  });
}

function buildRenewalAlerts(
  contracts: FinanceContract[],
  today: string
): FinanceRenewalAlert[] {
  return contracts
    .filter((contract) => contract.status === "active")
    .filter((contract) => !hasRegisteredRenewal(contract, contracts))
    .map((contract) => ({
      contract,
      daysUntilRenewal: differenceInCalendarDays(contract.renewalDueDate, today)
    }))
    .filter((item) => item.daysUntilRenewal <= 7)
    .map((item) => ({
      contractId: item.contract.id,
      athleteUsername: item.contract.athleteUsername,
      athleteName: item.contract.athleteName,
      planLabel: item.contract.planLabel,
      renewalDueDate: item.contract.renewalDueDate,
      daysUntilRenewal: item.daysUntilRenewal,
      status: item.daysUntilRenewal < 0 ? ("overdue" as const) : ("upcoming" as const)
    }))
    .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);
}

function buildMonthlySeries(
  contracts: FinanceContract[],
  payments: FinancePayment[],
  today: string
): FinanceMonthlyPoint[] {
  const keys = buildLastMonthKeys(today, 12);
  const points = new Map<string, FinanceMonthlyPoint>(
    keys.map((key) => [
      key,
      {
        month: key,
        expectedCents: 0,
        paidCents: 0,
        contractedCents: 0
      }
    ])
  );

  for (const contract of contracts) {
    if (contract.status === "cancelled") continue;
    const key = monthKey(contract.startDate);
    const point = points.get(key);
    if (point) point.contractedCents += contract.totalAmountCents;
  }

  for (const payment of payments) {
    if (payment.status !== "cancelled") {
      const expectedPoint = points.get(monthKey(payment.dueDate));
      if (expectedPoint) expectedPoint.expectedCents += payment.expectedAmountCents;
    }

    if (payment.status === "paid") {
      const paidDate = payment.paidAt || payment.dueDate;
      const paidPoint = points.get(monthKey(paidDate));
      if (paidPoint) paidPoint.paidCents += payment.paidAmountCents || payment.expectedAmountCents;
    }
  }

  return keys.map((key) => points.get(key) as FinanceMonthlyPoint);
}

export function buildFinanceDashboard(input: {
  contracts: FinanceContract[];
  payments: FinancePayment[];
  today?: string;
}): FinanceDashboard {
  const today = input.today ?? todayIsoDate();
  const month = getMonthRange(today);
  const next30 = addDays(today, 30);

  const paidThisMonthCents = input.payments
    .filter((payment) => payment.status === "paid")
    .filter((payment) => isBetween(payment.paidAt || payment.dueDate, month.start, month.end))
    .reduce((sum, payment) => sum + (payment.paidAmountCents || payment.expectedAmountCents), 0);

  const expectedThisMonthCents = input.payments
    .filter((payment) => payment.status !== "cancelled")
    .filter((payment) => isBetween(payment.dueDate, month.start, month.end))
    .reduce((sum, payment) => sum + payment.expectedAmountCents, 0);

  const pendingCents = input.payments
    .filter((payment) => payment.status === "pending")
    .reduce((sum, payment) => sum + payment.expectedAmountCents, 0);

  const next30DaysCents = input.payments
    .filter((payment) => payment.status === "pending")
    .filter((payment) => isBetween(payment.dueDate, today, next30))
    .reduce((sum, payment) => sum + payment.expectedAmountCents, 0);

  const overdueCount = input.payments.filter(
    (payment) => getComputedPaymentStatus(payment, today) === "overdue"
  ).length;

  const activeContracts = input.contracts.filter((contract) => contract.status === "active");
  const activeAthletesCount = new Set(activeContracts.map((contract) => contract.athleteUsername))
    .size;
  const activeContractValueCents = activeContracts.reduce(
    (sum, contract) => sum + contract.totalAmountCents,
    0
  );
  const monthlySeries = buildMonthlySeries(input.contracts, input.payments, today);
  const current = monthlySeries[monthlySeries.length - 1]?.paidCents ?? 0;
  const previous = monthlySeries[monthlySeries.length - 2]?.paidCents ?? 0;
  const monthlyVariationPercent =
    previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : null;

  return {
    paidThisMonthCents,
    expectedThisMonthCents,
    pendingCents,
    next30DaysCents,
    overdueCount,
    activeAthletesCount,
    activeContractValueCents,
    monthlyVariationPercent,
    renewalAlerts: buildRenewalAlerts(input.contracts, today),
    monthlySeries
  };
}
