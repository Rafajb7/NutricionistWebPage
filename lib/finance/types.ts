export type FinanceContractStatus = "active" | "finished" | "cancelled";

export type FinancePaymentStatus = "pending" | "paid" | "cancelled";

export type FinanceComputedPaymentStatus = FinancePaymentStatus | "overdue";

export type FinanceInvoiceStatus = "issued" | "cancelled";

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

export type FinanceExpense = {
  id: string;
  date: string;
  category: string;
  description: string;
  amountCents: number;
  currency: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceInvoiceIssuerSettings = {
  id: string;
  businessName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  invoiceSeries: string;
  nextInvoiceNumber: number;
  defaultVatRate: number;
  defaultIrpfRate: number;
  paymentMethod: string;
  bankIban: string;
  notes: string;
  updatedAt: string;
};

export type FinanceInvoiceLineItem = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  discountPercent: number;
  vatRate: number;
};

export type FinanceInvoiceTotals = {
  subtotalCents: number;
  discountCents: number;
  taxableBaseCents: number;
  vatCents: number;
  irpfCents: number;
  totalCents: number;
};

export type FinanceInvoiceClient = {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  country: string;
  email: string;
};

export type FinanceInvoice = {
  id: string;
  invoiceNumber: string;
  series: string;
  sequenceNumber: number;
  issueDate: string;
  operationDate: string;
  dueDate: string;
  client: FinanceInvoiceClient;
  issuer: FinanceInvoiceIssuerSettings;
  lineItems: FinanceInvoiceLineItem[];
  irpfRate: number;
  totals: FinanceInvoiceTotals;
  currency: string;
  paymentMethod: string;
  notes: string;
  status: FinanceInvoiceStatus;
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
  expenseCents: number;
  netCents: number;
  contractedCents: number;
};

export type FinanceDashboard = {
  paidThisMonthCents: number;
  expectedThisMonthCents: number;
  expensesThisMonthCents: number;
  netThisMonthCents: number;
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
  expenses: FinanceExpense[];
  invoices: FinanceInvoice[];
  invoiceSettings: FinanceInvoiceIssuerSettings;
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

export type CreateFinanceExpenseInput = {
  date: string;
  category: string;
  description: string;
  amountCents: number;
  currency: string;
  notes?: string;
};

export type UpdateFinanceInvoiceSettingsInput = Partial<
  Omit<FinanceInvoiceIssuerSettings, "id" | "updatedAt">
>;

export type CreateFinanceInvoiceInput = {
  series?: string;
  sequenceNumber?: number;
  issueDate: string;
  operationDate?: string;
  dueDate?: string;
  client: FinanceInvoiceClient;
  lineItems: FinanceInvoiceLineItem[];
  irpfRate: number;
  currency: string;
  paymentMethod?: string;
  notes?: string;
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

export const DEFAULT_FINANCE_INVOICE_SETTINGS: FinanceInvoiceIssuerSettings = {
  id: "default",
  businessName: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  country: "Espana",
  email: "",
  phone: "",
  website: "",
  invoiceSeries: `F-${new Date().getFullYear()}`,
  nextInvoiceNumber: 1,
  defaultVatRate: 21,
  defaultIrpfRate: 0,
  paymentMethod: "Transferencia bancaria",
  bankIban: "",
  notes: "",
  updatedAt: ""
};
