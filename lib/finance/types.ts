export type FinanceContractStatus = "active" | "finished" | "cancelled";

export type FinancePaymentStatus = "pending" | "paid" | "cancelled";

export type FinanceComputedPaymentStatus = FinancePaymentStatus | "overdue";

export type FinancePlanOption = {
  key: string;
  label: string;
  durationMonths: number;
  active: boolean;
  sortOrder: number;
};

export type FinanceContract = {
  id: string;
  athleteUsername: string;
  athleteName: string;
  planKey: string;
  planLabel: string;
  durationMonths: number;
  startDate: string;
  endDate: string;
  renewalDueDate: string;
  totalAmountCents: number;
  currency: string;
  financed: boolean;
  paymentCount: number;
  paymentAmountCents: number;
  paymentIntervalMonths: number;
  status: FinanceContractStatus;
  previousContractId: string;
  idempotencyKey: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type FinancePayment = {
  id: string;
  contractId: string;
  athleteUsername: string;
  athleteName: string;
  planLabel: string;
  dueDate: string;
  expectedAmountCents: number;
  status: FinancePaymentStatus;
  paidAt: string;
  paidAmountCents: number;
  sequenceIndex: number;
  sequenceCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceAthlete = {
  username: string;
  name: string;
  email: string;
};

export type FinanceRenewalAlert = {
  contractId: string;
  athleteUsername: string;
  athleteName: string;
  planLabel: string;
  renewalDueDate: string;
  daysUntilRenewal: number;
  status: "upcoming" | "overdue";
};

export type FinanceMonthlyPoint = {
  month: string;
  expectedCents: number;
  paidCents: number;
  contractedCents: number;
};

export type FinanceDashboard = {
  paidThisMonthCents: number;
  expectedThisMonthCents: number;
  pendingCents: number;
  next30DaysCents: number;
  overdueCount: number;
  activeAthletesCount: number;
  activeContractValueCents: number;
  monthlyVariationPercent: number | null;
  renewalAlerts: FinanceRenewalAlert[];
  monthlySeries: FinanceMonthlyPoint[];
};

export type FinanceManagementData = {
  athletes: FinanceAthlete[];
  contracts: FinanceContract[];
  payments: FinancePayment[];
  planOptions: FinancePlanOption[];
  dashboard: FinanceDashboard;
};

export type CreateFinanceContractInput = {
  athleteUsername: string;
  athleteName: string;
  planKey: string;
  planLabel: string;
  durationMonths: number;
  startDate: string;
  firstPaymentDate: string;
  totalAmountCents: number;
  currency: string;
  financed: boolean;
  paymentCount: number;
  paymentAmountCents: number | null;
  paymentIntervalMonths: number;
  previousContractId?: string;
  idempotencyKey?: string;
  notes?: string;
};

export type UpdateFinancePaymentInput = {
  paymentId: string;
  status?: FinancePaymentStatus;
  dueDate?: string;
  expectedAmountCents?: number;
  paidAt?: string;
  paidAmountCents?: number;
  notes?: string;
};

export type UpdateFinanceContractInput = {
  contractId: string;
  status?: FinanceContractStatus;
  notes?: string;
  cancelPendingFuturePayments?: boolean;
  today?: string;
};

export const DEFAULT_FINANCE_PLAN_OPTIONS: FinancePlanOption[] = [
  {
    key: "monthly",
    label: "Mensual",
    durationMonths: 1,
    active: true,
    sortOrder: 1
  },
  {
    key: "quarterly",
    label: "Trimestral",
    durationMonths: 3,
    active: true,
    sortOrder: 2
  },
  {
    key: "semiannual",
    label: "Semestral",
    durationMonths: 6,
    active: true,
    sortOrder: 3
  },
  {
    key: "annual",
    label: "Anual",
    durationMonths: 12,
    active: true,
    sortOrder: 4
  }
];
