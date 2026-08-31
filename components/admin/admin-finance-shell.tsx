"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Download,
  FileClock,
  FileText,
  LineChart,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Trash2,
  UserRound,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDays,
  addMonths,
  calculateFinanceInvoiceTotals,
  calculateInvoiceLineBaseCents,
  differenceInCalendarDays,
  formatCents,
  getComputedPaymentStatus,
  getMonthRange,
  parseCurrencyToCents,
  todayIsoDate,
} from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS } from "@/lib/finance/types";
import type {
  FinanceAthlete,
  FinanceComputedPaymentStatus,
  FinanceContract,
  FinanceDashboard,
  FinanceExpense,
  FinanceInvoice,
  FinanceInvoiceIssuerSettings,
  FinanceInvoiceLineItem,
  FinanceManagementData,
  FinanceMonthlyPoint,
  FinancePayment,
  FinancePaymentStatus,
  FinancePlanOption,
} from "@/lib/finance/types";

type SessionUser = {
  username: string;
  name: string;
};

type AdminFinanceShellProps = {
  user: SessionUser;
};

type FinanceFormState = {
  athleteUsername: string;
  planKey: string;
  totalAmount: string;
  startDate: string;
  firstPaymentDate: string;
  financed: boolean;
  paymentCount: string;
  paymentAmount: string;
  paymentIntervalMonths: string;
  previousContractId: string;
  notes: string;
};

type PaymentEditState = {
  paymentId: string;
  status: FinancePaymentStatus;
  dueDate: string;
  expectedAmount: string;
  paidAt: string;
  paidAmount: string;
  notes: string;
};

type ExpenseFormState = {
  date: string;
  category: string;
  description: string;
  amount: string;
  currency: string;
  notes: string;
};

type InvoiceSettingsFormState = {
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
  nextInvoiceNumber: string;
  defaultVatRate: string;
  defaultIrpfRate: string;
  paymentMethod: string;
  bankIban: string;
  notes: string;
};

type InvoiceLineFormState = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  vatRate: string;
};

type InvoiceFormState = {
  series: string;
  sequenceNumber: string;
  issueDate: string;
  operationDate: string;
  dueDate: string;
  clientAthleteUsername: string;
  clientName: string;
  clientTaxId: string;
  clientAddress: string;
  clientPostalCode: string;
  clientCity: string;
  clientProvince: string;
  clientCountry: string;
  clientEmail: string;
  lineItems: InvoiceLineFormState[];
  irpfRate: string;
  currency: string;
  paymentMethod: string;
  notes: string;
};

const EMPTY_DASHBOARD: FinanceDashboard = {
  paidThisMonthCents: 0,
  expectedThisMonthCents: 0,
  expensesThisMonthCents: 0,
  netThisMonthCents: 0,
  pendingCents: 0,
  next30DaysCents: 0,
  overdueCount: 0,
  activeAthletesCount: 0,
  activeContractValueCents: 0,
  monthlyVariationPercent: null,
  renewalAlerts: [],
  monthlySeries: [],
};

function createClientId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function defaultFinanceForm(): FinanceFormState {
  const today = todayIsoDate();
  return {
    athleteUsername: "",
    planKey: "monthly",
    totalAmount: "",
    startDate: today,
    firstPaymentDate: today,
    financed: false,
    paymentCount: "1",
    paymentAmount: "",
    paymentIntervalMonths: "1",
    previousContractId: "",
    notes: "",
  };
}

function defaultExpenseForm(): ExpenseFormState {
  return {
    date: todayIsoDate(),
    category: "General",
    description: "",
    amount: "",
    currency: "EUR",
    notes: "",
  };
}

function settingsToInvoiceFormState(
  settings: FinanceInvoiceIssuerSettings,
): InvoiceSettingsFormState {
  return {
    businessName: settings.businessName,
    taxId: settings.taxId,
    address: settings.address,
    postalCode: settings.postalCode,
    city: settings.city,
    province: settings.province,
    country: settings.country,
    email: settings.email,
    phone: settings.phone,
    website: settings.website,
    invoiceSeries: settings.invoiceSeries,
    nextInvoiceNumber: String(settings.nextInvoiceNumber),
    defaultVatRate: String(settings.defaultVatRate),
    defaultIrpfRate: String(settings.defaultIrpfRate),
    paymentMethod: settings.paymentMethod,
    bankIban: settings.bankIban,
    notes: settings.notes,
  };
}

function createInvoiceLine(
  settings: FinanceInvoiceIssuerSettings,
): InvoiceLineFormState {
  return {
    id: createClientId(),
    description: "Asesoramiento nutricional",
    quantity: "1",
    unitPrice: "",
    discountPercent: "0",
    vatRate: String(settings.defaultVatRate),
  };
}

function defaultInvoiceForm(
  settings: FinanceInvoiceIssuerSettings,
): InvoiceFormState {
  const today = todayIsoDate();
  return {
    series: settings.invoiceSeries,
    sequenceNumber: String(settings.nextInvoiceNumber),
    issueDate: today,
    operationDate: today,
    dueDate: "",
    clientAthleteUsername: "",
    clientName: "",
    clientTaxId: "",
    clientAddress: "",
    clientPostalCode: "",
    clientCity: "",
    clientProvince: "",
    clientCountry: "Espana",
    clientEmail: "",
    lineItems: [createInvoiceLine(settings)],
    irpfRate: String(settings.defaultIrpfRate),
    currency: "EUR",
    paymentMethod: settings.paymentMethod,
    notes: "",
  };
}

function buildPreviewLineItems(
  form: InvoiceFormState,
): FinanceInvoiceLineItem[] {
  return form.lineItems.map((line) => ({
    id: line.id,
    description: line.description.trim(),
    quantity: Math.max(0, Number(String(line.quantity).replace(",", ".")) || 0),
    unitPriceCents: parseCurrencyToCents(line.unitPrice) ?? 0,
    discountPercent: Math.min(
      100,
      Math.max(0, Number(String(line.discountPercent).replace(",", ".")) || 0),
    ),
    vatRate: Math.min(
      100,
      Math.max(0, Number(String(line.vatRate).replace(",", ".")) || 0),
    ),
  }));
}

function centsToInput(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2).replace(".", ",");
}

function formatDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMonthLabel(value: string): string {
  const parsed = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    month: "short",
    year: "2-digit",
  });
}

function statusLabel(status: FinanceComputedPaymentStatus): string {
  if (status === "paid") return "Cobrado";
  if (status === "cancelled") return "Cancelado";
  if (status === "overdue") return "Vencido";
  return "Pendiente";
}

function statusClass(status: FinanceComputedPaymentStatus): string {
  if (status === "paid")
    return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (status === "cancelled")
    return "border-zinc-400/30 bg-zinc-500/10 text-zinc-200";
  if (status === "overdue")
    return "border-red-400/40 bg-red-500/10 text-red-200";
  return "border-amber-400/40 bg-amber-500/10 text-amber-200";
}

function contractStatusLabel(status: FinanceContract["status"]): string {
  if (status === "finished") return "Finalizado";
  if (status === "cancelled") return "Cancelado";
  return "Activo";
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function getAthleteName(athletes: FinanceAthlete[], username: string): string {
  return (
    athletes.find((athlete) => athlete.username === username)?.name ?? username
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CircleDollarSign;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-brand-muted">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold text-brand-text">{value}</p>
          <p className="mt-1 text-xs text-brand-muted">{hint}</p>
        </div>
        <div className="rounded-xl border border-brand-accent/30 bg-brand-accent/10 p-2 text-brand-accent">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-56 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-sm text-brand-muted">
      No hay datos suficientes.
    </div>
  );
}

function ExpectedVsPaidChart({ points }: { points: FinanceMonthlyPoint[] }) {
  const data = points.slice(-12);
  const maxValue = Math.max(
    1,
    ...data.flatMap((point) => [
      point.expectedCents,
      point.paidCents,
      point.expenseCents,
    ]),
  );
  if (!data.length || maxValue <= 1) return <EmptyChart />;

  const chartHeight = 150;
  const barSlot = 42;
  const width = data.length * barSlot + 32;

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-brand-muted">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-brand-accent" />
          Previsto
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          Cobrado
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
          Gastos
        </span>
      </div>
      <svg viewBox={`0 0 ${width} 220`} className="h-56 w-full" role="img">
        <line
          x1="20"
          y1="170"
          x2={width - 8}
          y2="170"
          stroke="rgba(255,255,255,0.18)"
        />
        {data.map((point, index) => {
          const x = 28 + index * barSlot;
          const expectedHeight = (point.expectedCents / maxValue) * chartHeight;
          const paidHeight = (point.paidCents / maxValue) * chartHeight;
          const expenseHeight = (point.expenseCents / maxValue) * chartHeight;
          return (
            <g key={point.month}>
              <rect
                x={x}
                y={170 - expectedHeight}
                width="12"
                height={expectedHeight}
                rx="3"
                fill="var(--brand-accent)"
              />
              <rect
                x={x + 15}
                y={170 - paidHeight}
                width="12"
                height={paidHeight}
                rx="3"
                fill="#34d399"
              />
              <rect
                x={x + 30}
                y={170 - expenseHeight}
                width="12"
                height={expenseHeight}
                rx="3"
                fill="#f87171"
              />
              <text
                x={x + 13}
                y="196"
                textAnchor="middle"
                className="fill-current text-[10px] text-brand-muted"
              >
                {formatMonthLabel(point.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function EvolutionChart({ points }: { points: FinanceMonthlyPoint[] }) {
  const data = points.slice(-12);
  const maxValue = Math.max(
    1,
    ...data.map((point) => Math.max(0, point.netCents)),
  );
  if (!data.length || maxValue <= 1) return <EmptyChart />;

  const width = 560;
  const height = 200;
  const graphHeight = 140;
  const step = data.length > 1 ? (width - 56) / (data.length - 1) : 0;
  const coords = data.map((point, index) => {
    const x = 28 + index * step;
    const y = 160 - (Math.max(0, point.netCents) / maxValue) * graphHeight;
    return `${x},${y}`;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        role="img"
      >
        <line
          x1="24"
          y1="160"
          x2={width - 24}
          y2="160"
          stroke="rgba(255,255,255,0.18)"
        />
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke="#60a5fa"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {data.map((point, index) => {
          const [x, y] = coords[index].split(",").map(Number);
          return (
            <g key={point.month}>
              <circle cx={x} cy={y} r="5" fill="#60a5fa" />
              <text
                x={x}
                y="187"
                textAnchor="middle"
                className="fill-current text-[10px] text-brand-muted"
              >
                {formatMonthLabel(point.month)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function AdminFinanceShell({ user }: AdminFinanceShellProps) {
  const [data, setData] = useState<FinanceManagementData>({
    athletes: [],
    contracts: [],
    payments: [],
    expenses: [],
    invoices: [],
    invoiceSettings: DEFAULT_FINANCE_INVOICE_SETTINGS,
    planOptions: [],
    dashboard: EMPTY_DASHBOARD,
  });
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingInvoiceSettings, setSavingInvoiceSettings] = useState(false);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [contractActionId, setContractActionId] = useState<string | null>(null);

  const [athleteFilter, setAthleteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | FinanceComputedPaymentStatus
  >("all");
  const [periodFilter, setPeriodFilter] = useState<
    "all" | "month" | "next30" | "overdue"
  >("all");
  const [search, setSearch] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(
    todayIsoDate().slice(0, 7),
  );

  const [form, setForm] = useState<FinanceFormState>(defaultFinanceForm);
  const [expenseForm, setExpenseForm] =
    useState<ExpenseFormState>(defaultExpenseForm);
  const [invoiceSettingsForm, setInvoiceSettingsForm] =
    useState<InvoiceSettingsFormState>(() =>
      settingsToInvoiceFormState(DEFAULT_FINANCE_INVOICE_SETTINGS),
    );
  const [invoiceForm, setInvoiceForm] = useState<InvoiceFormState>(() =>
    defaultInvoiceForm(DEFAULT_FINANCE_INVOICE_SETTINGS),
  );
  const [paymentEdit, setPaymentEdit] = useState<PaymentEditState | null>(null);

  const today = todayIsoDate();

  async function loadData() {
    try {
      const res = await fetch("/api/admin/finance");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        window.location.href = "/dashboard";
        return;
      }

      const json = (await res.json()) as Partial<FinanceManagementData> & {
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar Finanzas.");
      const invoiceSettings =
        json.invoiceSettings ?? DEFAULT_FINANCE_INVOICE_SETTINGS;

      setData({
        athletes: json.athletes ?? [],
        contracts: json.contracts ?? [],
        payments: json.payments ?? [],
        expenses: json.expenses ?? [],
        invoices: json.invoices ?? [],
        invoiceSettings,
        planOptions: json.planOptions ?? [],
        dashboard: json.dashboard ?? EMPTY_DASHBOARD,
      });
      setInvoiceSettingsForm(settingsToInvoiceFormState(invoiceSettings));
      setInvoiceForm((current) => ({
        ...current,
        series: current.series || invoiceSettings.invoiceSeries,
        sequenceNumber:
          current.sequenceNumber || String(invoiceSettings.nextInvoiceNumber),
        irpfRate: current.irpfRate || String(invoiceSettings.defaultIrpfRate),
        paymentMethod: current.paymentMethod || invoiceSettings.paymentMethod,
        lineItems: current.lineItems.length
          ? current.lineItems.map((line) => ({
              ...line,
              vatRate: line.vatRate || String(invoiceSettings.defaultVatRate),
            }))
          : [createInvoiceLine(invoiceSettings)],
      }));
    } catch (error) {
      console.error(error);
      toast.error("Error cargando Finanzas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const activePlanOptions = useMemo(
    () => data.planOptions.filter((option) => option.active),
    [data.planOptions],
  );

  const contractsByAthlete = useMemo(() => {
    const map = new Map<string, FinanceContract[]>();
    data.contracts.forEach((contract) => {
      const list = map.get(contract.athleteUsername) ?? [];
      list.push(contract);
      map.set(contract.athleteUsername, list);
    });
    return map;
  }, [data.contracts]);

  const paymentsByDate = useMemo(() => {
    const map = new Map<string, FinancePayment[]>();
    data.payments.forEach((payment) => {
      const list = map.get(payment.dueDate) ?? [];
      list.push(payment);
      map.set(payment.dueDate, list);
    });
    return map;
  }, [data.payments]);

  const expensesByDate = useMemo(() => {
    const map = new Map<string, FinanceExpense[]>();
    data.expenses.forEach((expense) => {
      const list = map.get(expense.date) ?? [];
      list.push(expense);
      map.set(expense.date, list);
    });
    return map;
  }, [data.expenses]);

  const filteredPayments = useMemo(() => {
    const monthRange = getMonthRange(today);
    const next30 = addDays(today, 30);
    const q = normalizeText(search);
    return data.payments
      .filter(
        (payment) =>
          !athleteFilter || payment.athleteUsername === athleteFilter,
      )
      .filter((payment) => {
        const computed = getComputedPaymentStatus(payment, today);
        return statusFilter === "all" || computed === statusFilter;
      })
      .filter((payment) => {
        if (periodFilter === "month")
          return (
            payment.dueDate >= monthRange.start &&
            payment.dueDate <= monthRange.end
          );
        if (periodFilter === "next30")
          return payment.dueDate >= today && payment.dueDate <= next30;
        if (periodFilter === "overdue")
          return getComputedPaymentStatus(payment, today) === "overdue";
        return true;
      })
      .filter((payment) => {
        if (!q) return true;
        return (
          normalizeText(payment.athleteName).includes(q) ||
          normalizeText(payment.athleteUsername).includes(q) ||
          normalizeText(payment.planLabel).includes(q)
        );
      })
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [athleteFilter, data.payments, periodFilter, search, statusFilter, today]);

  const upcomingPayments = useMemo(
    () =>
      data.payments
        .filter((payment) => payment.status === "pending")
        .filter((payment) => payment.dueDate >= today)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8),
    [data.payments, today],
  );

  const selectedAthleteData = useMemo(() => {
    if (!selectedAthlete) return null;
    const athlete = data.athletes.find(
      (item) => item.username === selectedAthlete,
    );
    if (!athlete) return null;
    const contracts = (contractsByAthlete.get(selectedAthlete) ?? []).sort(
      (a, b) => b.startDate.localeCompare(a.startDate),
    );
    const payments = data.payments
      .filter((payment) => payment.athleteUsername === selectedAthlete)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    return { athlete, contracts, payments };
  }, [contractsByAthlete, data.athletes, data.payments, selectedAthlete]);

  const invoicePreviewLineItems = useMemo(
    () => buildPreviewLineItems(invoiceForm),
    [invoiceForm],
  );
  const invoicePreviewTotals = useMemo(
    () =>
      calculateFinanceInvoiceTotals(
        invoicePreviewLineItems,
        Number(String(invoiceForm.irpfRate).replace(",", ".")) || 0,
      ),
    [invoiceForm.irpfRate, invoicePreviewLineItems],
  );

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  function updateForm<K extends keyof FinanceFormState>(
    key: K,
    value: FinanceFormState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvoiceSettingsForm<K extends keyof InvoiceSettingsFormState>(
    key: K,
    value: InvoiceSettingsFormState[K],
  ) {
    setInvoiceSettingsForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvoiceForm<K extends keyof InvoiceFormState>(
    key: K,
    value: InvoiceFormState[K],
  ) {
    setInvoiceForm((current) => ({ ...current, [key]: value }));
  }

  function updateInvoiceLine(
    lineId: string,
    patch: Partial<InvoiceLineFormState>,
  ) {
    setInvoiceForm((current) => ({
      ...current,
      lineItems: current.lineItems.map((line) =>
        line.id === lineId ? { ...line, ...patch } : line,
      ),
    }));
  }

  function addInvoiceLine() {
    setInvoiceForm((current) => ({
      ...current,
      lineItems: [
        ...current.lineItems,
        createInvoiceLine(data.invoiceSettings),
      ],
    }));
  }

  function removeInvoiceLine(lineId: string) {
    setInvoiceForm((current) => ({
      ...current,
      lineItems:
        current.lineItems.length > 1
          ? current.lineItems.filter((line) => line.id !== lineId)
          : current.lineItems,
    }));
  }

  function selectInvoiceClient(username: string) {
    const athlete = data.athletes.find((item) => item.username === username);
    setInvoiceForm((current) => ({
      ...current,
      clientAthleteUsername: username,
      clientName: athlete?.name ?? current.clientName,
      clientEmail: athlete?.email ?? current.clientEmail,
    }));
  }

  async function handleSaveInvoiceSettings() {
    setSavingInvoiceSettings(true);
    try {
      const res = await fetch("/api/admin/finance/invoice-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...invoiceSettingsForm,
          nextInvoiceNumber: Number(invoiceSettingsForm.nextInvoiceNumber || 1),
          defaultVatRate: Number(
            String(invoiceSettingsForm.defaultVatRate).replace(",", ".") || 0,
          ),
          defaultIrpfRate: Number(
            String(invoiceSettingsForm.defaultIrpfRate).replace(",", ".") || 0,
          ),
        }),
      });
      const json = (await res.json()) as {
        invoiceSettings?: FinanceInvoiceIssuerSettings;
        error?: string;
      };
      if (!res.ok || !json.invoiceSettings) {
        throw new Error(
          json.error ?? "No se pudieron guardar los datos de facturacion.",
        );
      }

      setData((current) => ({
        ...current,
        invoiceSettings: json.invoiceSettings!,
      }));
      setInvoiceSettingsForm(settingsToInvoiceFormState(json.invoiceSettings));
      setInvoiceForm((current) => ({
        ...current,
        series: current.series || json.invoiceSettings!.invoiceSeries,
        sequenceNumber:
          current.sequenceNumber ||
          String(json.invoiceSettings!.nextInvoiceNumber),
        irpfRate:
          current.irpfRate || String(json.invoiceSettings!.defaultIrpfRate),
        paymentMethod:
          current.paymentMethod || json.invoiceSettings!.paymentMethod,
      }));
      toast.success("Datos de facturacion guardados.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error guardando datos de facturacion.",
      );
    } finally {
      setSavingInvoiceSettings(false);
    }
  }

  async function handleCreateInvoice() {
    if (
      !data.invoiceSettings.businessName.trim() ||
      !data.invoiceSettings.taxId.trim() ||
      !data.invoiceSettings.address.trim()
    ) {
      toast.error("Completa primero los datos fiscales del emisor.");
      return;
    }
    if (
      !invoiceForm.clientName.trim() ||
      !invoiceForm.clientTaxId.trim() ||
      !invoiceForm.clientAddress.trim()
    ) {
      toast.error("Nombre, NIF y direccion del cliente son obligatorios.");
      return;
    }
    if (
      !invoiceForm.lineItems.some(
        (line) => line.description.trim() && line.unitPrice.trim(),
      )
    ) {
      toast.error("Anade al menos una linea con concepto e importe.");
      return;
    }

    setSavingInvoice(true);
    try {
      const res = await fetch("/api/admin/finance/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series: invoiceForm.series,
          sequenceNumber: Number(invoiceForm.sequenceNumber || 1),
          issueDate: invoiceForm.issueDate,
          operationDate: invoiceForm.operationDate || invoiceForm.issueDate,
          dueDate: invoiceForm.dueDate || undefined,
          client: {
            name: invoiceForm.clientName,
            taxId: invoiceForm.clientTaxId,
            address: invoiceForm.clientAddress,
            postalCode: invoiceForm.clientPostalCode,
            city: invoiceForm.clientCity,
            province: invoiceForm.clientProvince,
            country: invoiceForm.clientCountry,
            email: invoiceForm.clientEmail,
          },
          lineItems: invoiceForm.lineItems,
          irpfRate: Number(String(invoiceForm.irpfRate).replace(",", ".") || 0),
          currency: invoiceForm.currency,
          paymentMethod: invoiceForm.paymentMethod,
          notes: invoiceForm.notes,
        }),
      });
      const json = (await res.json()) as {
        invoice?: FinanceInvoice;
        invoices?: FinanceInvoice[];
        invoiceSettings?: FinanceInvoiceIssuerSettings;
        error?: string;
      };
      if (!res.ok || !json.invoice)
        throw new Error(json.error ?? "No se pudo emitir la factura.");

      const nextSettings = json.invoiceSettings ?? data.invoiceSettings;
      setData((current) => ({
        ...current,
        invoices: json.invoices ?? [json.invoice!, ...current.invoices],
        invoiceSettings: nextSettings,
      }));
      setInvoiceSettingsForm(settingsToInvoiceFormState(nextSettings));
      setInvoiceForm(defaultInvoiceForm(nextSettings));
      toast.success(`Factura ${json.invoice.invoiceNumber} emitida.`);
      window.open(
        `/api/admin/finance/invoices/${json.invoice.id}/pdf`,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error emitiendo factura.",
      );
    } finally {
      setSavingInvoice(false);
    }
  }

  async function handleCreateContract() {
    if (!form.athleteUsername || !form.totalAmount.trim()) {
      toast.error("Selecciona atleta e importe.");
      return;
    }

    setSavingContract(true);
    try {
      const res = await fetch("/api/admin/finance/contracts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteUsername: form.athleteUsername,
          planKey: form.planKey,
          startDate: form.startDate,
          firstPaymentDate: form.firstPaymentDate,
          totalAmount: form.totalAmount,
          currency: "EUR",
          financed: form.financed,
          paymentCount: Number(form.paymentCount || 1),
          paymentAmount: form.paymentAmount || undefined,
          paymentIntervalMonths: Number(form.paymentIntervalMonths || 1),
          previousContractId: form.previousContractId || undefined,
          idempotencyKey: createClientId(),
          notes: form.notes,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo crear el contrato.");
        return;
      }

      toast.success(
        form.previousContractId ? "Renovacion registrada." : "Contrato creado.",
      );
      const keepAthlete = form.athleteUsername;
      setForm({ ...defaultFinanceForm(), athleteUsername: keepAthlete });
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Error creando contrato.");
    } finally {
      setSavingContract(false);
    }
  }

  async function handleCreateExpense() {
    if (!expenseForm.description.trim() || !expenseForm.amount.trim()) {
      toast.error("Descripcion e importe del gasto son obligatorios.");
      return;
    }

    setSavingExpense(true);
    try {
      const res = await fetch("/api/admin/finance/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(expenseForm),
      });
      const json = (await res.json()) as {
        expense?: FinanceExpense;
        dashboard?: FinanceDashboard;
        error?: string;
      };
      if (!res.ok || !json.expense)
        throw new Error(json.error ?? "No se pudo registrar el gasto.");

      setData((current) => ({
        ...current,
        expenses: [json.expense!, ...current.expenses].sort((a, b) =>
          b.date.localeCompare(a.date),
        ),
        dashboard: json.dashboard ?? current.dashboard,
      }));
      setExpenseForm(defaultExpenseForm());
      toast.success("Gasto registrado.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error registrando gasto.",
      );
    } finally {
      setSavingExpense(false);
    }
  }

  function startPaymentEdit(payment: FinancePayment) {
    setPaymentEdit({
      paymentId: payment.id,
      status: payment.status === "paid" ? "paid" : "paid",
      dueDate: payment.dueDate,
      expectedAmount: centsToInput(payment.expectedAmountCents),
      paidAt: payment.paidAt || today,
      paidAmount: centsToInput(
        payment.paidAmountCents || payment.expectedAmountCents,
      ),
      notes: payment.notes,
    });
  }

  async function handleSavePayment() {
    if (!paymentEdit) return;

    setSavingPayment(true);
    try {
      const res = await fetch(
        `/api/admin/finance/payments/${paymentEdit.paymentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: paymentEdit.status,
            dueDate: paymentEdit.dueDate,
            expectedAmount: paymentEdit.expectedAmount,
            paidAt: paymentEdit.status === "paid" ? paymentEdit.paidAt : "",
            paidAmount:
              paymentEdit.status === "paid" ? paymentEdit.paidAmount : "",
            notes: paymentEdit.notes,
          }),
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo actualizar el pago.");
        return;
      }

      toast.success("Pago actualizado.");
      setPaymentEdit(null);
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Error actualizando pago.");
    } finally {
      setSavingPayment(false);
    }
  }

  async function handleContractStatus(
    contract: FinanceContract,
    status: FinanceContract["status"],
    cancelFuture = false,
  ) {
    if (status === "cancelled") {
      const confirmed = window.confirm(
        "Quieres cancelar este contrato? Los pagos futuros pendientes pueden marcarse como cancelados.",
      );
      if (!confirmed) return;
    }

    setContractActionId(contract.id);
    try {
      const res = await fetch(`/api/admin/finance/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          cancelPendingFuturePayments: cancelFuture,
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        cancelledPayments?: number;
      };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo actualizar el contrato.");
        return;
      }

      toast.success(
        status === "cancelled"
          ? `Contrato cancelado. Pagos futuros cancelados: ${json.cancelledPayments ?? 0}.`
          : "Contrato actualizado.",
      );
      await loadData();
    } catch (error) {
      console.error(error);
      toast.error("Error actualizando contrato.");
    } finally {
      setContractActionId(null);
    }
  }

  function renewContract(contract: FinanceContract, sameConditions: boolean) {
    setSelectedAthlete(contract.athleteUsername);
    setForm({
      athleteUsername: contract.athleteUsername,
      planKey: sameConditions ? contract.planKey : "monthly",
      totalAmount: sameConditions
        ? centsToInput(contract.totalAmountCents)
        : "",
      startDate: contract.renewalDueDate,
      firstPaymentDate: contract.renewalDueDate,
      financed: sameConditions ? contract.financed : false,
      paymentCount: sameConditions ? String(contract.paymentCount) : "1",
      paymentAmount:
        sameConditions && contract.financed
          ? centsToInput(contract.paymentAmountCents)
          : "",
      paymentIntervalMonths: sameConditions
        ? String(contract.paymentIntervalMonths)
        : "1",
      previousContractId: contract.id,
      notes: sameConditions ? contract.notes : "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function buildCalendarCells() {
    const monthStart = `${calendarMonth}-01`;
    const range = getMonthRange(monthStart);
    const first = new Date(`${range.start}T00:00:00`);
    const firstWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = Number(range.end.slice(-2));
    const cells: Array<{ date: string; inMonth: boolean }> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({
        date: addDays(range.start, i - firstWeekday),
        inMonth: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({
        date: `${calendarMonth}-${String(day).padStart(2, "0")}`,
        inMonth: true,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({
        date: addDays(range.end, cells.length % 7),
        inMonth: false,
      });
    }
    return cells;
  }

  const calendarCells = buildCalendarCells();

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/tools">
                <BrandButton
                  variant="ghost"
                  className="w-full justify-center px-4 py-2 sm:w-auto"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Herramientas admin
                </BrandButton>
              </Link>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                  Administrador
                </p>
                <p className="font-semibold text-brand-text">{user.name}</p>
              </div>
              <BrandButton
                variant="ghost"
                className="px-4 py-2"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                Herramienta admin
              </p>
              <h1 className="mt-1 text-3xl font-semibold text-brand-text">
                Finanzas
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-brand-muted">
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2">
                <WalletCards className="h-4 w-4 text-brand-accent" />
                Contratos y pagos
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2">
                <CalendarDays className="h-4 w-4 text-brand-accent" />
                Calendario financiero
              </span>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-32 w-full rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                icon={CircleDollarSign}
                label="Cobrado mes"
                value={formatCents(data.dashboard.paidThisMonthCents)}
                hint="Importe realmente registrado"
              />
              <SummaryCard
                icon={FileClock}
                label="Previsto mes"
                value={formatCents(data.dashboard.expectedThisMonthCents)}
                hint="Pagos con vencimiento este mes"
              />
              <SummaryCard
                icon={ReceiptText}
                label="Gastos mes"
                value={formatCents(data.dashboard.expensesThisMonthCents)}
                hint="Salidas registradas este mes"
              />
              <SummaryCard
                icon={LineChart}
                label="Neto mes"
                value={formatCents(data.dashboard.netThisMonthCents)}
                hint="Cobrado menos gastos"
              />
              <SummaryCard
                icon={Clock3}
                label="Pendiente"
                value={formatCents(data.dashboard.pendingCents)}
                hint="Pendiente total no cancelado"
              />
              <SummaryCard
                icon={CalendarDays}
                label="Prox. 30 dias"
                value={formatCents(data.dashboard.next30DaysCents)}
                hint="Cobros esperados cercanos"
              />
              <SummaryCard
                icon={AlertTriangle}
                label="Vencidos"
                value={String(data.dashboard.overdueCount)}
                hint="Pagos fuera de plazo"
              />
              <SummaryCard
                icon={UserRound}
                label="Atletas activos"
                value={String(data.dashboard.activeAthletesCount)}
                hint="Con contrato activo"
              />
            </section>

            {data.dashboard.renewalAlerts.length ||
            data.dashboard.overdueCount ? (
              <section className="grid gap-3 lg:grid-cols-2">
                {data.dashboard.renewalAlerts.map((alert) => (
                  <article
                    key={alert.contractId}
                    className={`rounded-2xl border p-4 ${
                      alert.status === "overdue"
                        ? "border-red-400/35 bg-red-500/10"
                        : "border-amber-400/35 bg-amber-500/10"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-brand-text">
                          {alert.status === "overdue"
                            ? "Renovacion vencida"
                            : "Renovacion proxima"}
                        </p>
                        <p className="mt-1 text-sm text-brand-muted">
                          {alert.athleteName} - {alert.planLabel} -{" "}
                          {formatDate(alert.renewalDueDate)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const contract = data.contracts.find(
                            (item) => item.id === alert.contractId,
                          );
                          if (contract) renewContract(contract, true);
                        }}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-brand-text transition hover:bg-white/10"
                      >
                        <RefreshCw className="h-4 w-4" />
                        Renovar
                      </button>
                    </div>
                  </article>
                ))}
                {data.dashboard.overdueCount ? (
                  <article className="rounded-2xl border border-red-400/35 bg-red-500/10 p-4">
                    <p className="text-sm font-semibold text-brand-text">
                      Pagos vencidos
                    </p>
                    <p className="mt-1 text-sm text-brand-muted">
                      Hay {data.dashboard.overdueCount} pagos pendientes fuera
                      de plazo.
                    </p>
                  </article>
                ) : null}
              </section>
            ) : null}

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">
                      Nuevo contrato
                    </h2>
                    <p className="text-sm text-brand-muted">
                      Tambien sirve para configurar atletas existentes o renovar
                      periodos.
                    </p>
                  </div>
                  {form.previousContractId ? (
                    <span className="rounded-full border border-brand-accent/30 bg-brand-accent/10 px-3 py-1 text-xs text-brand-text">
                      Renovacion
                    </span>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-brand-muted">
                    Atleta
                    <select
                      value={form.athleteUsername}
                      onChange={(event) =>
                        updateForm("athleteUsername", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      <option value="">Seleccionar atleta</option>
                      {data.athletes.map((athlete) => (
                        <option key={athlete.username} value={athlete.username}>
                          {athlete.name} ({athlete.username})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Plan contratado
                    <select
                      value={form.planKey}
                      onChange={(event) =>
                        updateForm("planKey", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      {activePlanOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Precio total / cuota
                    <input
                      value={form.totalAmount}
                      onChange={(event) =>
                        updateForm("totalAmount", event.target.value)
                      }
                      placeholder="540,00"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Fecha inicio
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(event) =>
                        updateForm("startDate", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Fecha primer pago
                    <input
                      type="date"
                      value={form.firstPaymentDate}
                      onChange={(event) =>
                        updateForm("firstPaymentDate", event.target.value)
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Pago fraccionado
                    <select
                      value={form.financed ? "yes" : "no"}
                      onChange={(event) =>
                        updateForm("financed", event.target.value === "yes")
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      <option value="no">No</option>
                      <option value="yes">Si</option>
                    </select>
                  </label>
                  {form.financed ? (
                    <>
                      <label className="block text-sm text-brand-muted">
                        Numero de pagos
                        <input
                          type="number"
                          min={1}
                          value={form.paymentCount}
                          onChange={(event) =>
                            updateForm("paymentCount", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Importe por pago
                        <input
                          value={form.paymentAmount}
                          onChange={(event) =>
                            updateForm("paymentAmount", event.target.value)
                          }
                          placeholder="Auto si queda vacio"
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Periodicidad en meses
                        <input
                          type="number"
                          min={1}
                          value={form.paymentIntervalMonths}
                          onChange={(event) =>
                            updateForm(
                              "paymentIntervalMonths",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="block text-sm text-brand-muted md:col-span-2">
                    Notas
                    <textarea
                      value={form.notes}
                      onChange={(event) =>
                        updateForm("notes", event.target.value)
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <BrandButton
                    onClick={handleCreateContract}
                    disabled={savingContract}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {savingContract
                      ? "Guardando..."
                      : form.previousContractId
                        ? "Registrar renovacion"
                        : "Crear contrato"}
                  </BrandButton>
                  {form.previousContractId ? (
                    <BrandButton
                      variant="ghost"
                      onClick={() =>
                        setForm({
                          ...defaultFinanceForm(),
                          athleteUsername: form.athleteUsername,
                        })
                      }
                    >
                      Cancelar renovacion
                    </BrandButton>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">
                      Nuevo gasto
                    </h2>
                    <p className="text-sm text-brand-muted">
                      Se registra en calendario y cuentas actuales.
                    </p>
                  </div>
                  <ReceiptText className="h-5 w-5 text-brand-accent" />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-brand-muted">
                    Fecha
                    <input
                      type="date"
                      value={expenseForm.date}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Categoria
                    <input
                      value={expenseForm.category}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Descripcion
                    <input
                      value={expenseForm.description}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Importe
                    <input
                      value={expenseForm.amount}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          amount: event.target.value,
                        }))
                      }
                      placeholder="120,00"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted md:col-span-2">
                    Notas
                    <textarea
                      value={expenseForm.notes}
                      onChange={(event) =>
                        setExpenseForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <BrandButton
                    onClick={handleCreateExpense}
                    disabled={savingExpense}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {savingExpense ? "Guardando..." : "Registrar gasto"}
                  </BrandButton>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">
                  Proximos cobros
                </h2>
                <div className="mt-3 space-y-2">
                  {upcomingPayments.length ? (
                    upcomingPayments.map((payment) => {
                      const days = differenceInCalendarDays(
                        payment.dueDate,
                        today,
                      );
                      return (
                        <button
                          key={payment.id}
                          type="button"
                          onClick={() => startPaymentEdit(payment)}
                          className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-brand-accent/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-brand-text">
                                {payment.athleteName}
                              </p>
                              <p className="mt-1 text-xs text-brand-muted">
                                {payment.planLabel} - pago{" "}
                                {payment.sequenceIndex}/{payment.sequenceCount}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-brand-text">
                              {formatCents(payment.expectedAmountCents)}
                            </p>
                          </div>
                          <p className="mt-2 text-xs text-brand-muted">
                            {formatDate(payment.dueDate)} -{" "}
                            {days === 0 ? "hoy" : `en ${days} dias`}
                          </p>
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-brand-muted">
                      No hay cobros proximos.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FileText className="h-5 w-5 text-brand-accent" />
                      <h2 className="text-lg font-semibold text-brand-text">
                        Generador de facturas
                      </h2>
                    </div>
                    <p className="mt-1 text-sm text-brand-muted">
                      Factura ordinaria con emisor, receptor, conceptos, base,
                      IVA, IRPF opcional y total.
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-xl border border-brand-accent/30 bg-brand-accent/10 px-3 py-2 text-xs text-brand-text">
                    {invoiceForm.series}-
                    {String(invoiceForm.sequenceNumber || "1").padStart(4, "0")}
                  </span>
                </div>

                <div className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-brand-accent" />
                        <h3 className="text-sm font-semibold text-brand-text">
                          Datos fiscales por defecto
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={handleSaveInvoiceSettings}
                        disabled={savingInvoiceSettings}
                        className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10 disabled:opacity-60"
                      >
                        <Save className="h-3.5 w-3.5" />
                        {savingInvoiceSettings ? "Guardando..." : "Guardar"}
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Nombre fiscal
                        <input
                          value={invoiceSettingsForm.businessName}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "businessName",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        NIF/CIF
                        <input
                          value={invoiceSettingsForm.taxId}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "taxId",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Email
                        <input
                          value={invoiceSettingsForm.email}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "email",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Direccion fiscal
                        <input
                          value={invoiceSettingsForm.address}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "address",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        CP
                        <input
                          value={invoiceSettingsForm.postalCode}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "postalCode",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Ciudad
                        <input
                          value={invoiceSettingsForm.city}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "city",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Provincia
                        <input
                          value={invoiceSettingsForm.province}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "province",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Pais
                        <input
                          value={invoiceSettingsForm.country}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "country",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Serie
                        <input
                          value={invoiceSettingsForm.invoiceSeries}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "invoiceSeries",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Siguiente numero
                        <input
                          type="number"
                          min={1}
                          value={invoiceSettingsForm.nextInvoiceNumber}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "nextInvoiceNumber",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        IVA por defecto (%)
                        <input
                          value={invoiceSettingsForm.defaultVatRate}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "defaultVatRate",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        IRPF por defecto (%)
                        <input
                          value={invoiceSettingsForm.defaultIrpfRate}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "defaultIrpfRate",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Telefono
                        <input
                          value={invoiceSettingsForm.phone}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "phone",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Web
                        <input
                          value={invoiceSettingsForm.website}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "website",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Metodo de pago
                        <input
                          value={invoiceSettingsForm.paymentMethod}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "paymentMethod",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        IBAN
                        <input
                          value={invoiceSettingsForm.bankIban}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "bankIban",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Notas por defecto
                        <textarea
                          value={invoiceSettingsForm.notes}
                          onChange={(event) =>
                            updateInvoiceSettingsForm(
                              "notes",
                              event.target.value,
                            )
                          }
                          rows={2}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <h3 className="text-sm font-semibold text-brand-text">
                      Nueva factura
                    </h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="block text-sm text-brand-muted">
                        Serie
                        <input
                          value={invoiceForm.series}
                          onChange={(event) =>
                            updateInvoiceForm("series", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Numero
                        <input
                          type="number"
                          min={1}
                          value={invoiceForm.sequenceNumber}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "sequenceNumber",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Fecha
                        <input
                          type="date"
                          value={invoiceForm.issueDate}
                          onChange={(event) =>
                            updateInvoiceForm("issueDate", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Fecha operacion
                        <input
                          type="date"
                          value={invoiceForm.operationDate}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "operationDate",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Vencimiento
                        <input
                          type="date"
                          value={invoiceForm.dueDate}
                          onChange={(event) =>
                            updateInvoiceForm("dueDate", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Cliente atleta
                        <select
                          value={invoiceForm.clientAthleteUsername}
                          onChange={(event) =>
                            selectInvoiceClient(event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        >
                          <option value="">Manual</option>
                          {data.athletes.map((athlete) => (
                            <option
                              key={athlete.username}
                              value={athlete.username}
                            >
                              {athlete.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Nombre / razon social cliente
                        <input
                          value={invoiceForm.clientName}
                          onChange={(event) =>
                            updateInvoiceForm("clientName", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        NIF cliente
                        <input
                          value={invoiceForm.clientTaxId}
                          onChange={(event) =>
                            updateInvoiceForm("clientTaxId", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-3">
                        Direccion cliente
                        <input
                          value={invoiceForm.clientAddress}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "clientAddress",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        CP
                        <input
                          value={invoiceForm.clientPostalCode}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "clientPostalCode",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Ciudad
                        <input
                          value={invoiceForm.clientCity}
                          onChange={(event) =>
                            updateInvoiceForm("clientCity", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Provincia
                        <input
                          value={invoiceForm.clientProvince}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "clientProvince",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Pais
                        <input
                          value={invoiceForm.clientCountry}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "clientCountry",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Email cliente
                        <input
                          value={invoiceForm.clientEmail}
                          onChange={(event) =>
                            updateInvoiceForm("clientEmail", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </div>

                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-brand-text">
                          Conceptos
                        </h4>
                        <button
                          type="button"
                          onClick={addInvoiceLine}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Linea
                        </button>
                      </div>
                      {invoiceForm.lineItems.map((line) => (
                        <div
                          key={line.id}
                          className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 md:grid-cols-12"
                        >
                          <label className="block text-xs text-brand-muted md:col-span-4">
                            Concepto
                            <input
                              value={line.description}
                              onChange={(event) =>
                                updateInvoiceLine(line.id, {
                                  description: event.target.value,
                                })
                              }
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            />
                          </label>
                          <label className="block text-xs text-brand-muted md:col-span-2">
                            Cantidad
                            <input
                              value={line.quantity}
                              onChange={(event) =>
                                updateInvoiceLine(line.id, {
                                  quantity: event.target.value,
                                })
                              }
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            />
                          </label>
                          <label className="block text-xs text-brand-muted md:col-span-2">
                            Precio
                            <input
                              value={line.unitPrice}
                              onChange={(event) =>
                                updateInvoiceLine(line.id, {
                                  unitPrice: event.target.value,
                                })
                              }
                              placeholder="90,00"
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            />
                          </label>
                          <label className="block text-xs text-brand-muted md:col-span-1">
                            Dto.
                            <input
                              value={line.discountPercent}
                              onChange={(event) =>
                                updateInvoiceLine(line.id, {
                                  discountPercent: event.target.value,
                                })
                              }
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            />
                          </label>
                          <label className="block text-xs text-brand-muted md:col-span-1">
                            IVA
                            <input
                              value={line.vatRate}
                              onChange={(event) =>
                                updateInvoiceLine(line.id, {
                                  vatRate: event.target.value,
                                })
                              }
                              className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            />
                          </label>
                          <div className="flex items-end justify-between gap-2 md:col-span-2">
                            <p className="pb-2 text-sm font-semibold text-brand-text">
                              {formatCents(
                                calculateInvoiceLineBaseCents(
                                  invoicePreviewLineItems.find(
                                    (item) => item.id === line.id,
                                  ) ?? {
                                    quantity: 0,
                                    unitPriceCents: 0,
                                    discountPercent: 0,
                                  },
                                ).taxableBaseCents,
                                invoiceForm.currency,
                              )}
                            </p>
                            <button
                              type="button"
                              onClick={() => removeInvoiceLine(line.id)}
                              className="rounded-lg border border-red-400/35 p-2 text-red-100 transition hover:bg-red-500/10"
                              aria-label="Eliminar linea"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <label className="block text-sm text-brand-muted">
                        IRPF (%)
                        <input
                          value={invoiceForm.irpfRate}
                          onChange={(event) =>
                            updateInvoiceForm("irpfRate", event.target.value)
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-2">
                        Metodo de pago
                        <input
                          value={invoiceForm.paymentMethod}
                          onChange={(event) =>
                            updateInvoiceForm(
                              "paymentMethod",
                              event.target.value,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted md:col-span-3">
                        Notas de factura
                        <textarea
                          value={invoiceForm.notes}
                          onChange={(event) =>
                            updateInvoiceForm("notes", event.target.value)
                          }
                          rows={2}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-2 rounded-xl border border-brand-accent/20 bg-brand-accent/10 p-3 text-sm">
                      <div className="flex justify-between gap-3 text-brand-muted">
                        <span>Base imponible</span>
                        <strong className="text-brand-text">
                          {formatCents(
                            invoicePreviewTotals.taxableBaseCents,
                            invoiceForm.currency,
                          )}
                        </strong>
                      </div>
                      <div className="flex justify-between gap-3 text-brand-muted">
                        <span>IVA</span>
                        <strong className="text-brand-text">
                          {formatCents(
                            invoicePreviewTotals.vatCents,
                            invoiceForm.currency,
                          )}
                        </strong>
                      </div>
                      {invoicePreviewTotals.irpfCents > 0 ? (
                        <div className="flex justify-between gap-3 text-brand-muted">
                          <span>IRPF</span>
                          <strong className="text-brand-text">
                            -
                            {formatCents(
                              invoicePreviewTotals.irpfCents,
                              invoiceForm.currency,
                            )}
                          </strong>
                        </div>
                      ) : null}
                      <div className="flex justify-between gap-3 border-t border-white/10 pt-2 text-base text-brand-text">
                        <span className="font-semibold">Total</span>
                        <strong>
                          {formatCents(
                            invoicePreviewTotals.totalCents,
                            invoiceForm.currency,
                          )}
                        </strong>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <BrandButton
                        onClick={handleCreateInvoice}
                        disabled={savingInvoice}
                      >
                        <FileText className="mr-2 h-4 w-4" />
                        {savingInvoice ? "Generando..." : "Emitir y abrir PDF"}
                      </BrandButton>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center gap-2">
                  <ReceiptText className="h-5 w-5 text-brand-accent" />
                  <h2 className="text-lg font-semibold text-brand-text">
                    Facturas emitidas
                  </h2>
                </div>
                <div className="mt-4 space-y-2">
                  {data.invoices.slice(0, 10).map((invoice) => (
                    <article
                      key={invoice.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-brand-text">
                            {invoice.invoiceNumber}
                          </p>
                          <p className="mt-1 text-xs text-brand-muted">
                            {invoice.client.name} -{" "}
                            {formatDate(invoice.issueDate)}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-brand-text">
                          {formatCents(
                            invoice.totals.totalCents,
                            invoice.currency,
                          )}
                        </p>
                      </div>
                      <div className="mt-3 flex justify-end">
                        <a
                          href={`/api/admin/finance/invoices/${invoice.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                        >
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </a>
                      </div>
                    </article>
                  ))}
                  {!data.invoices.length ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                      Sin facturas emitidas.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-brand-accent" />
                  <h2 className="text-lg font-semibold text-brand-text">
                    Previsto vs cobrado
                  </h2>
                </div>
                <ExpectedVsPaidChart points={data.dashboard.monthlySeries} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-brand-accent" />
                  <h2 className="text-lg font-semibold text-brand-text">
                    Evolucion cobrada
                  </h2>
                </div>
                <EvolutionChart points={data.dashboard.monthlySeries} />
                <p className="mt-3 text-sm text-brand-muted">
                  Variacion mensual:{" "}
                  <span className="font-semibold text-brand-text">
                    {data.dashboard.monthlyVariationPercent === null
                      ? "Sin datos previos"
                      : `${data.dashboard.monthlyVariationPercent > 0 ? "+" : ""}${data.dashboard.monthlyVariationPercent}%`}
                  </span>
                </p>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">
                      Calendario financiero
                    </h2>
                    <p className="text-sm text-brand-muted">
                      Pagos previstos y gastos registrados por dia.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setCalendarMonth(
                          addMonths(`${calendarMonth}-01`, -1).slice(0, 7),
                        )
                      }
                      className="rounded-xl border border-white/15 p-2 text-brand-text transition hover:bg-white/10"
                      aria-label="Mes anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <p className="min-w-36 text-center text-sm font-semibold text-brand-text">
                      {formatMonthLabel(calendarMonth)}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setCalendarMonth(
                          addMonths(`${calendarMonth}-01`, 1).slice(0, 7),
                        )
                      }
                      className="rounded-xl border border-white/15 p-2 text-brand-text transition hover:bg-white/10"
                      aria-label="Mes siguiente"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs uppercase tracking-[0.12em] text-brand-muted">
                  {["L", "M", "X", "J", "V", "S", "D"].map((day) => (
                    <div key={day} className="py-2">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {calendarCells.map((cell) => {
                    const payments = (paymentsByDate.get(cell.date) ?? [])
                      .filter(
                        (payment) =>
                          !athleteFilter ||
                          payment.athleteUsername === athleteFilter,
                      )
                      .slice(0, 3);
                    const expenses = (
                      expensesByDate.get(cell.date) ?? []
                    ).slice(0, 3);
                    return (
                      <div
                        key={cell.date}
                        className={`min-h-28 rounded-xl border p-2 ${
                          cell.inMonth
                            ? "border-white/10 bg-black/20"
                            : "border-white/5 bg-black/10 opacity-60"
                        }`}
                      >
                        <p className="text-xs font-semibold text-brand-text">
                          {Number(cell.date.slice(-2))}
                        </p>
                        <div className="mt-2 space-y-1">
                          {payments.map((payment) => {
                            const computed = getComputedPaymentStatus(
                              payment,
                              today,
                            );
                            return (
                              <button
                                key={payment.id}
                                type="button"
                                onClick={() => startPaymentEdit(payment)}
                                className={`block w-full truncate rounded-md border px-1.5 py-1 text-left text-[11px] ${statusClass(computed)}`}
                                title={`${payment.athleteName} - ${formatCents(payment.expectedAmountCents)}`}
                              >
                                {payment.athleteName} -{" "}
                                {formatCents(payment.expectedAmountCents)}
                              </button>
                            );
                          })}
                          {expenses.map((expense) => (
                            <div
                              key={expense.id}
                              className="block w-full truncate rounded-md border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-left text-[11px] text-red-100"
                              title={`${expense.description} - ${formatCents(expense.amountCents)}`}
                            >
                              {expense.description} -{" "}
                              {formatCents(expense.amountCents)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">
                  Ficha financiera
                </h2>
                <label className="mt-3 block text-sm text-brand-muted">
                  Atleta
                  <select
                    value={selectedAthlete}
                    onChange={(event) => setSelectedAthlete(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="">Seleccionar atleta</option>
                    {data.athletes.map((athlete) => (
                      <option key={athlete.username} value={athlete.username}>
                        {athlete.name} ({athlete.username})
                      </option>
                    ))}
                  </select>
                </label>
                {selectedAthleteData ? (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-base font-semibold text-brand-text">
                        {selectedAthleteData.athlete.name}
                      </p>
                      <p className="text-sm text-brand-muted">
                        {selectedAthleteData.athlete.username}
                      </p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-brand-text">
                        Contratos
                      </h3>
                      <div className="mt-2 space-y-2">
                        {selectedAthleteData.contracts.length ? (
                          selectedAthleteData.contracts.map((contract) => (
                            <article
                              key={contract.id}
                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-brand-text">
                                    {contract.planLabel}
                                  </p>
                                  <p className="text-xs text-brand-muted">
                                    {formatDate(contract.startDate)} -{" "}
                                    {formatDate(contract.endDate)}
                                  </p>
                                </div>
                                <span className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-brand-muted">
                                  {contractStatusLabel(contract.status)}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-brand-text">
                                {formatCents(
                                  contract.totalAmountCents,
                                  contract.currency,
                                )}
                              </p>
                              <p className="mt-1 text-xs text-brand-muted">
                                Renovacion:{" "}
                                {formatDate(contract.renewalDueDate)}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => renewContract(contract, true)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Mismas condiciones
                                </button>
                                <button
                                  type="button"
                                  onClick={() => renewContract(contract, false)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-brand-muted transition hover:bg-white/10"
                                >
                                  Renovar distinto
                                </button>
                                {contract.status === "active" ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleContractStatus(
                                          contract,
                                          "finished",
                                        )
                                      }
                                      disabled={
                                        contractActionId === contract.id
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 px-2.5 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-60"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Finalizar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleContractStatus(
                                          contract,
                                          "cancelled",
                                          true,
                                        )
                                      }
                                      disabled={
                                        contractActionId === contract.id
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-red-400/35 px-2.5 py-1.5 text-xs text-red-200 transition hover:bg-red-500/10 disabled:opacity-60"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                      Cancelar
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </article>
                          ))
                        ) : (
                          <p className="text-sm text-brand-muted">
                            Sin contratos registrados.
                          </p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-brand-text">
                        Ultimos pagos
                      </h3>
                      <div className="mt-2 space-y-2">
                        {selectedAthleteData.payments
                          .slice(0, 6)
                          .map((payment) => {
                            const computed = getComputedPaymentStatus(
                              payment,
                              today,
                            );
                            return (
                              <button
                                key={payment.id}
                                type="button"
                                onClick={() => startPaymentEdit(payment)}
                                className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-brand-accent/40"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm text-brand-text">
                                    {formatDate(payment.dueDate)}
                                  </span>
                                  <span
                                    className={`rounded-full border px-2 py-1 text-[11px] ${statusClass(computed)}`}
                                  >
                                    {statusLabel(computed)}
                                  </span>
                                </div>
                                <p className="mt-1 text-sm font-semibold text-brand-text">
                                  {formatCents(payment.expectedAmountCents)}
                                </p>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-brand-muted">
                    Selecciona un atleta para ver sus contratos, pagos e
                    historico.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-brand-accent" />
                <h2 className="text-lg font-semibold text-brand-text">
                  Gastos registrados
                </h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.expenses.slice(0, 9).map((expense) => (
                  <article
                    key={expense.id}
                    className="rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-brand-text">
                          {expense.description}
                        </p>
                        <p className="mt-1 text-xs text-brand-muted">
                          {expense.category} - {formatDate(expense.date)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-red-100">
                        {formatCents(expense.amountCents, expense.currency)}
                      </p>
                    </div>
                    {expense.notes ? (
                      <p className="mt-2 text-xs text-brand-muted">
                        {expense.notes}
                      </p>
                    ) : null}
                  </article>
                ))}
                {!data.expenses.length ? (
                  <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                    Sin gastos registrados.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-brand-text">
                    Listado de pagos
                  </h2>
                  <p className="text-sm text-brand-muted">
                    Buscar, filtrar y registrar cobros.
                  </p>
                </div>
                <div className="grid gap-2 md:grid-cols-5 xl:min-w-[860px]">
                  <label className="relative md:col-span-2">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar atleta o plan"
                      className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <select
                    value={athleteFilter}
                    onChange={(event) => setAthleteFilter(event.target.value)}
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="">Todos los atletas</option>
                    {data.athletes.map((athlete) => (
                      <option key={athlete.username} value={athlete.username}>
                        {athlete.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(
                        event.target.value as
                          "all" | FinanceComputedPaymentStatus,
                      )
                    }
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="all">Todos</option>
                    <option value="pending">Pendiente</option>
                    <option value="overdue">Vencido</option>
                    <option value="paid">Cobrado</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                  <select
                    value={periodFilter}
                    onChange={(event) =>
                      setPeriodFilter(
                        event.target.value as
                          "all" | "month" | "next30" | "overdue",
                      )
                    }
                    className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="all">Todo el periodo</option>
                    <option value="month">Mes actual</option>
                    <option value="next30">Prox. 30 dias</option>
                    <option value="overdue">Solo vencidos</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Atleta</th>
                      <th className="px-3 py-2 text-left">Plan</th>
                      <th className="px-3 py-2 text-left">Fecha prevista</th>
                      <th className="px-3 py-2 text-left">Importe</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-left">Fecha cobro</th>
                      <th className="px-3 py-2 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.length ? (
                      filteredPayments.map((payment) => {
                        const computed = getComputedPaymentStatus(
                          payment,
                          today,
                        );
                        return (
                          <tr
                            key={payment.id}
                            className="border-t border-white/10"
                          >
                            <td className="px-3 py-2 text-brand-text">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedAthlete(payment.athleteUsername)
                                }
                                className="text-left font-medium transition hover:text-brand-accent"
                              >
                                {payment.athleteName ||
                                  getAthleteName(
                                    data.athletes,
                                    payment.athleteUsername,
                                  )}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-brand-muted">
                              {payment.planLabel}{" "}
                              {payment.sequenceCount > 1
                                ? `(${payment.sequenceIndex}/${payment.sequenceCount})`
                                : ""}
                            </td>
                            <td className="px-3 py-2 text-brand-text">
                              {formatDate(payment.dueDate)}
                            </td>
                            <td className="px-3 py-2 text-brand-text">
                              {formatCents(payment.expectedAmountCents)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full border px-2 py-1 text-xs ${statusClass(computed)}`}
                              >
                                {statusLabel(computed)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-brand-muted">
                              {formatDate(payment.paidAt)}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => startPaymentEdit(payment)}
                                className="inline-flex items-center gap-2 rounded-lg border border-brand-accent/35 px-3 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                              >
                                <CreditCard className="h-3.5 w-3.5" />
                                Gestionar
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="px-3 py-8 text-center text-brand-muted"
                        >
                          No hay pagos para los filtros seleccionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {paymentEdit ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center"
          >
            <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-brand-surface p-5 shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-brand-text">
                    Gestionar pago
                  </h2>
                  <p className="text-sm text-brand-muted">
                    Puedes marcarlo como cobrado o ajustar fecha e importe
                    previsto.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentEdit(null)}
                  className="rounded-xl border border-white/15 p-2 text-brand-text transition hover:bg-white/10"
                >
                  <XCircle className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="block text-sm text-brand-muted">
                  Estado
                  <select
                    value={paymentEdit.status}
                    onChange={(event) =>
                      setPaymentEdit((current) =>
                        current
                          ? {
                              ...current,
                              status: event.target
                                .value as FinancePaymentStatus,
                            }
                          : current,
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    <option value="paid">Cobrado</option>
                    <option value="pending">Pendiente</option>
                    <option value="cancelled">Cancelado</option>
                  </select>
                </label>
                <label className="block text-sm text-brand-muted">
                  Fecha prevista
                  <input
                    type="date"
                    value={paymentEdit.dueDate}
                    onChange={(event) =>
                      setPaymentEdit((current) =>
                        current
                          ? { ...current, dueDate: event.target.value }
                          : current,
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Importe previsto
                  <input
                    value={paymentEdit.expectedAmount}
                    onChange={(event) =>
                      setPaymentEdit((current) =>
                        current
                          ? { ...current, expectedAmount: event.target.value }
                          : current,
                      )
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                {paymentEdit.status === "paid" ? (
                  <>
                    <label className="block text-sm text-brand-muted">
                      Fecha real de cobro
                      <input
                        type="date"
                        value={paymentEdit.paidAt}
                        onChange={(event) =>
                          setPaymentEdit((current) =>
                            current
                              ? { ...current, paidAt: event.target.value }
                              : current,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                      />
                    </label>
                    <label className="block text-sm text-brand-muted">
                      Importe cobrado
                      <input
                        value={paymentEdit.paidAmount}
                        onChange={(event) =>
                          setPaymentEdit((current) =>
                            current
                              ? { ...current, paidAmount: event.target.value }
                              : current,
                          )
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                      />
                    </label>
                  </>
                ) : null}
                <label className="block text-sm text-brand-muted md:col-span-2">
                  Notas
                  <textarea
                    value={paymentEdit.notes}
                    onChange={(event) =>
                      setPaymentEdit((current) =>
                        current
                          ? { ...current, notes: event.target.value }
                          : current,
                      )
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <BrandButton
                  variant="ghost"
                  onClick={() => setPaymentEdit(null)}
                >
                  Cancelar
                </BrandButton>
                <BrandButton
                  onClick={handleSavePayment}
                  disabled={savingPayment}
                >
                  {savingPayment ? "Guardando..." : "Guardar pago"}
                </BrandButton>
              </div>
            </div>
          </motion.div>
        ) : null}
      </div>
    </MotionPage>
  );
}
