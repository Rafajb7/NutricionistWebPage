"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  FileClock,
  FileUp,
  FileText,
  LineChart,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Search,
  Trash2,
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
import { FINANCE_CURRENCIES } from "@/lib/finance/currencies";
import { DEFAULT_EXCHANGE_RATES, convertToEuroCents, expenseEuroCents, type FinanceExchangeRates } from "@/lib/finance/exchange-rates";
import { MAX_FINANCE_INVOICE_BYTES } from "@/lib/finance/upload-limits";
import { buildAnnualCashReport, buildQuarterlyVatReport, cashCollected } from "@/lib/finance/reporting";
import { DEFAULT_FINANCE_INVOICE_SETTINGS } from "@/lib/finance/types";
import type {
  FinanceAthlete,
  FinanceComputedPaymentStatus,
  FinanceContract,
  FinanceDashboard,
  FinanceExpense,
  FinanceExpenseInvoiceFile,
  FinanceInvoice,
  FinanceInvoiceIssuerSettings,
  FinanceInvoiceLineItem,
  FinanceManagementData,
  FinancePayment,
  FinancePaymentStatus,
} from "@/lib/finance/types";

type SessionUser = {
  username: string;
  name: string;
};

type AdminFinanceShellProps = {
  user: SessionUser;
  section?: "overview" | "invoices";
};

type FinanceFormState = {
  athleteUsername: string;
  planKey: string;
  totalAmount: string;
  reservationAmount: string;
  startDate: string;
  firstPaymentDate: string;
  financed: boolean;
  paymentCount: string;
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
  vatRate: string;
  vatDeductible: boolean;
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
    reservationAmount: "",
    startDate: today,
    firstPaymentDate: today,
    financed: false,
    paymentCount: "1",
    paymentIntervalMonths: "1",
    previousContractId: "",
    notes: "",
  };
}

function defaultExpenseForm(): ExpenseFormState {
  return {
    vatRate: "0",
    vatDeductible: false,
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
    <article className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs leading-snug text-brand-muted">
            {label}
          </p>
          <p className="mt-1 text-lg font-semibold leading-tight tabular-nums text-brand-text">{value}</p>
        </div>
        <div className="shrink-0 rounded-lg bg-brand-accent/10 p-1.5 text-brand-accent">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </article>
  );
}

export function AdminFinanceShell({ user, section = "overview" }: AdminFinanceShellProps) {
  const [data, setData] = useState<FinanceManagementData>({
    athletes: [],
    contracts: [],
    payments: [],
    expenses: [],
    expenseInvoiceFiles: [],
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
  const [invoiceSettingsOpen, setInvoiceSettingsOpen] = useState(false);
  const [expenseAttachment, setExpenseAttachment] = useState<File | null>(null);
  const [reportYear, setReportYear] = useState(new Date().getFullYear());
  const [exchangeRates, setExchangeRates] = useState<FinanceExchangeRates>(DEFAULT_EXCHANGE_RATES);
  const [expenseInvoiceInputKey, setExpenseInvoiceInputKey] = useState(0);
  const [deletingExpenseInvoiceId, setDeletingExpenseInvoiceId] = useState<string | null>(null);

  const [athleteFilter, setAthleteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | FinanceComputedPaymentStatus
  >("all");
  const [periodFilter, setPeriodFilter] = useState<
    "all" | "month" | "next30" | "overdue"
  >("all");
  const [search, setSearch] = useState("");
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
  const annualReport = buildAnnualCashReport(data.payments, data.contracts, data.expenses, reportYear);
  const vatReport = buildQuarterlyVatReport(data.invoices, data.expenses, reportYear);
  const pendingThisMonth = data.payments.filter(payment => payment.status === "pending" && payment.dueDate.startsWith(today.slice(0, 7))).reduce((sum, payment) => sum + payment.expectedAmountCents, 0);
  const pendingThisYear = data.payments.filter(payment => payment.status === "pending" && payment.dueDate.startsWith(`${reportYear}-`)).reduce((sum, payment) => sum + payment.expectedAmountCents, 0);
  const reportYears = Array.from(new Set([...Array.from({ length: 5 }, (_, index) => Number(today.slice(0, 4)) - index), reportYear, ...data.payments.map(item => Number((item.paidAt || item.dueDate).slice(0, 4))), ...data.invoices.map(item => Number(item.issueDate.slice(0, 4))), ...data.expenses.map(item => Number(item.date.slice(0, 4)))])).filter(Number.isFinite).sort((a, b) => b - a);
  const remainingCents = (parseCurrencyToCents(form.totalAmount) ?? 0) - (parseCurrencyToCents(form.reservationAmount) ?? 0);
  const autoPaymentAmount = form.totalAmount && remainingCents >= 0 && Number(form.paymentCount) > 0 ? centsToInput(Math.ceil(remainingCents / Number(form.paymentCount))) : "";

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
        exchangeRates?: FinanceExchangeRates;
      };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar Finanzas.");
      setExchangeRates(json.exchangeRates ?? DEFAULT_EXCHANGE_RATES);
      const invoiceSettings =
        json.invoiceSettings ?? DEFAULT_FINANCE_INVOICE_SETTINGS;

      setData({
        athletes: json.athletes ?? [],
        contracts: json.contracts ?? [],
        payments: json.payments ?? [],
        expenses: json.expenses ?? [],
        expenseInvoiceFiles: json.expenseInvoiceFiles ?? [],
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

  const expenseInvoiceByExpenseId = useMemo(() => {
    const map = new Map<string, FinanceExpenseInvoiceFile>();
    data.expenseInvoiceFiles.forEach((file) => {
      map.set(file.expenseId, file);
    });
    return map;
  }, [data.expenseInvoiceFiles]);

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
        .filter((payment) => payment.dueDate >= today && payment.dueDate <= addDays(today, 30))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.payments, today],
  );

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

    if ((parseCurrencyToCents(form.reservationAmount) ?? 0) < 0 || remainingCents < 0) {
      toast.error("La reserva debe estar entre cero y el importe total.");
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
          reservationAmount: form.reservationAmount,
          currency: "EUR",
          financed: form.financed,
          paymentCount: Number(form.paymentCount || 1),
          paymentAmount: undefined,
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
      const formData = new FormData();
      Object.entries(expenseForm).forEach(([key, value]) => formData.append(key, String(value)));
      if (expenseAttachment) formData.append("invoice", expenseAttachment);
      const res = await fetch(expenseAttachment ? "/api/admin/finance/expense-invoices" : "/api/admin/finance/expenses", {
        method: "POST",
        ...(expenseAttachment ? { body: formData } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(expenseForm) })
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
      setExpenseAttachment(null);
      setExpenseInvoiceInputKey(current => current + 1);
      await loadData();
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

  async function handleDeleteExpenseInvoice(file: FinanceExpenseInvoiceFile) {
    setDeletingExpenseInvoiceId(file.id);
    try {
      const res = await fetch(`/api/admin/finance/expense-invoices/${file.id}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as {
        expenses?: FinanceExpense[];
        expenseInvoiceFiles?: FinanceExpenseInvoiceFile[];
        dashboard?: FinanceDashboard;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error ?? "No se pudo eliminar la factura.");
      }

      setData((current) => ({
        ...current,
        expenses:
          json.expenses ??
          current.expenses.filter((expense) => expense.id !== file.expenseId),
        expenseInvoiceFiles:
          json.expenseInvoiceFiles ??
          current.expenseInvoiceFiles.filter((item) => item.id !== file.id),
        dashboard: json.dashboard ?? current.dashboard,
      }));
      toast.success(
        file.expenseId
          ? "Factura y gasto asociado eliminados."
          : "Factura eliminada.",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error eliminando factura.",
      );
    } finally {
      setDeletingExpenseInvoiceId(null);
    }
  }

  function startPaymentEdit(payment: FinancePayment) {
    setPaymentEdit({
      paymentId: payment.id,
      status: payment.status,
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

  function renewContract(contract: FinanceContract, sameConditions: boolean) {
    setForm({
      ...defaultFinanceForm(),
      athleteUsername: contract.athleteUsername,
      planKey: sameConditions ? contract.planKey : "monthly",
      totalAmount: sameConditions ? centsToInput(contract.totalAmountCents) : "",
      startDate: contract.renewalDueDate,
      firstPaymentDate: contract.renewalDueDate,
      financed: sameConditions ? contract.financed : false,
      paymentCount: sameConditions ? String(contract.paymentCount) : "1",
      paymentIntervalMonths: sameConditions ? String(contract.paymentIntervalMonths) : "1",
      previousContractId: contract.id,
      notes: sameConditions ? contract.notes : ""
    });
    document.getElementById("new-contract")?.scrollIntoView({ behavior: "smooth" });
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
      <div className="app-page-container mx-auto w-full space-y-6 px-4 py-8 md:px-8">
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
                {section === "overview" ? "Finanzas" : "Facturas"}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-brand-muted">
              <Link href={section === "overview" ? "/tools/finance/invoices" : "/tools/finance"} className="inline-flex items-center gap-2 rounded-xl border border-brand-accent/35 px-3 py-2 text-brand-text hover:bg-brand-accent/10">
                <ReceiptText className="h-4 w-4" />
                {section === "overview" ? "Facturas" : "Volver a Finanzas"}
              </Link>
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
            {section === "overview" ? (
            <section aria-label="Resumen financiero" className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                <div className="mb-3 flex min-h-9 items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-brand-text">Mensual</h2>
                  <span className="text-xs capitalize text-brand-muted">{formatMonthLabel(today.slice(0, 7))}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SummaryCard icon={CircleDollarSign} label="Cash collector del mes" value={formatCents(cashCollected(data.payments, `${today.slice(0, 7)}-01`, today))} hint="Cobros registrados este mes hasta hoy" />
                  <SummaryCard icon={FileClock} label="Pendiente mes" value={formatCents(pendingThisMonth)} hint="Pagos pendientes con vencimiento este mes" />
                  <SummaryCard icon={ReceiptText} label="Gastos del mes" value={formatCents(data.dashboard.expensesThisMonthCents)} hint="Todos los gastos convertidos a euros" />
                  <SummaryCard icon={LineChart} label="Neto del mes" value={formatCents(data.dashboard.netThisMonthCents)} hint="Cobros menos gastos del mes" />
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-brand-text">Anual</h2>
                  <label className="flex items-center gap-2 text-xs text-brand-muted">Ejercicio
                    <select aria-label="Ejercicio" value={reportYear} onChange={event => setReportYear(Number(event.target.value))} className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60">
                      {reportYears.map(year => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SummaryCard icon={CircleDollarSign} label={`Cash collector ${today.slice(0, 4)}`} value={formatCents(cashCollected(data.payments, `${today.slice(0, 4)}-01-01`, today))} hint="Cobros desde el 1 de enero hasta hoy" />
                  <SummaryCard icon={Clock3} label={`Pendiente ${reportYear}`} value={formatCents(pendingThisYear)} hint="Pagos pendientes con vencimiento en el ejercicio seleccionado" />
                  <SummaryCard icon={ReceiptText} label={`Bruto anual ${reportYear}`} value={formatCents(annualReport.grossCents)} hint="Cobros registrados en el ejercicio seleccionado" />
                  <SummaryCard icon={LineChart} label={`Neta anual ${reportYear}`} value={formatCents(annualReport.netCents)} hint="Cobros menos gastos en euros del ejercicio seleccionado" />
                </div>
              </div>
            </section>
            ) : null}

            {section === "overview" && (data.dashboard.renewalAlerts.length ||
            data.dashboard.overdueCount) ? (
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

            {section === "overview" ? <>
            <section aria-label="Contratos y cobros" className="grid items-start gap-4 lg:grid-cols-3">
              <div className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 id="new-contract" className="text-lg font-semibold text-brand-text">
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
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
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
                    Reserva
                    <input value={form.reservationAmount} onChange={event => updateForm("reservationAmount", event.target.value)} placeholder="0,00" inputMode="decimal" className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-accent/60" />
                    <span className="mt-1 block text-xs">Cobrada en la fecha de inicio. Se descuenta del total.</span>
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
                        Importe por pago (automático)
                        <input
                          value={autoPaymentAmount}
                          readOnly
                          placeholder="Calculado automáticamente"
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
                  <label className="block text-sm text-brand-muted sm:col-span-2 lg:col-span-1">
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
                <h2 className="text-lg font-semibold text-brand-text">
                  Próximos cobros · 30 días
                </h2>
                <div className="mt-3 max-h-[640px] space-y-2 overflow-y-auto">
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
              </div>
            <section className="min-w-0 lg:col-span-2 rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-brand-text">
                    Listado de pagos
                  </h2>
                  <p className="text-sm text-brand-muted">
                    Buscar, filtrar y registrar cobros.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <label className="relative sm:col-span-2 xl:col-span-3">
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
                <table className="min-w-[680px] w-full text-sm">
                  <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Atleta</th>
                      <th className="px-3 py-2 text-left">Plan</th>
                      <th className="px-3 py-2 text-left">Fecha prevista</th>
                      <th className="px-3 py-2 text-left">Importe</th>
                      <th className="px-3 py-2 text-left">Estado</th>
                      <th className="px-3 py-2 text-left">Fecha cobro</th>
                      <th className="w-12 px-3 py-2"><span className="sr-only">Modificar pago</span></th>
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
                              <Link
                                href={`/tools/athlete-profile/${encodeURIComponent(payment.athleteUsername)}`}
                                className="text-left font-medium transition hover:text-brand-accent"
                              >
                                {payment.athleteName ||
                                  getAthleteName(
                                    data.athletes,
                                    payment.athleteUsername,
                                  )}
                              </Link>
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
                            <td className="px-3 py-2 text-right">
                              <button type="button" onClick={() => startPaymentEdit(payment)} aria-label={`Modificar pago de ${payment.athleteName}`} title="Modificar pago" className="inline-flex rounded-lg border border-brand-accent/35 p-2 text-brand-text hover:bg-brand-accent/10"><WalletCards className="h-4 w-4" /></button>
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
            </section></section>
            <section aria-label="Calendario financiero" className="w-full min-w-0">              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
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
                              title={`${expense.description} - ${formatCents(expenseEuroCents(expense))}`}
                            >
                              {expense.description} -{" "}
                              {formatCents(expenseEuroCents(expense))}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

</section>
            </> : <>
            <section>              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">
                      Nuevo gasto
                    </h2>
                    <p className="text-sm text-brand-muted">
                      Se registra en calendario y cuentas actuales.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-brand-accent/35 px-3 py-2 text-xs text-brand-text hover:bg-brand-accent/10">
                      <FileUp className="h-4 w-4" /> Adjuntar factura (PDF, máx. 4 MB)
                      <input key={expenseInvoiceInputKey} type="file" accept="application/pdf,.pdf" disabled={savingExpense} className="hidden" onChange={event => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && (file.size === 0 || file.size > MAX_FINANCE_INVOICE_BYTES)) { toast.error("Adjunta un PDF de hasta 4 MB que no esté vacío."); event.target.value = ""; return; }
                        if (file && file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) { toast.error("Selecciona un PDF."); return; }
                        setExpenseAttachment(file);
                      }} />
                    </label>
                    <ReceiptText className="h-5 w-5 text-brand-accent" />
                  </div>
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
                    Importe bruto (IVA incluido)
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
                  <label className="block text-sm text-brand-muted">IVA aplicado (%)
                    <input type="number" min="0" max="100" step="0.01" value={expenseForm.vatRate} onChange={event => setExpenseForm(current => ({ ...current, vatRate: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-accent/60" />
                  </label>
                  <label className="block text-sm text-brand-muted">Moneda
                    <select value={expenseForm.currency} onChange={event => setExpenseForm(current => ({ ...current, currency: event.target.value }))} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-accent/60">
                      {FINANCE_CURRENCIES.map(currency => <option key={currency.code} value={currency.code}>{currency.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-brand-muted md:col-span-2">
                    <input type="checkbox" checked={expenseForm.vatDeductible} onChange={event => setExpenseForm(current => ({ ...current, vatDeductible: event.target.checked }))} /> IVA deducible para la actividad
                  </label>
                  {expenseForm.currency !== "EUR" ? (
                    <div className="rounded-xl border border-brand-accent/25 bg-brand-accent/5 p-3 text-sm text-brand-text md:col-span-2">
                      <p>Equivalente en euros: <strong>{formatCents(convertToEuroCents(parseCurrencyToCents(expenseForm.amount) ?? 0, expenseForm.currency, exchangeRates))}</strong></p>
                      <p className="mt-1 text-xs text-brand-muted">1 {expenseForm.currency} = {new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 7 }).format(exchangeRates.rates[expenseForm.currency])} EUR · Cambio de referencia del {formatDate(exchangeRates.date)}. Se guarda con la factura.</p>
                    </div>
                  ) : null}
                  {expenseAttachment ? <p className="text-sm text-brand-muted md:col-span-2">{expenseAttachment.name} <button type="button" onClick={() => { setExpenseAttachment(null); setExpenseInvoiceInputKey(current => current + 1); }} className="underline">Quitar adjunto</button></p> : null}
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
                <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                  <summary className="cursor-pointer text-sm text-brand-muted">Tipos de cambio a euros · {formatDate(exchangeRates.date)}</summary>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {FINANCE_CURRENCIES.map(currency => <p key={currency.code} className="text-xs text-brand-muted">1 {currency.code} = {new Intl.NumberFormat("es-ES", { maximumSignificantDigits: 7 }).format(exchangeRates.rates[currency.code])} EUR</p>)}
                  </div>
                  <p className="mt-3 text-xs text-brand-muted">Se aplica el último cambio disponible al registrar el gasto. El importe original se conserva.</p>
                </details>
              </div>

</section>
            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-brand-text">IVA trimestral · {reportYear} · EUR</h2>
                <label className="flex items-center gap-2 text-xs text-brand-muted">Ejercicio
                  <select aria-label="Ejercicio del IVA" value={reportYear} onChange={event => setReportYear(Number(event.target.value))} className="w-24 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60">
                    {reportYears.map(year => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
              </div>
              <p className="mt-2 text-sm text-brand-muted">IVA de facturas emitidas menos IVA de gastos marcados como deducibles, por fecha de operación. Estimación sin compensaciones previas ni regímenes especiales. Los gastos en otras monedas se convierten a euros con el cambio guardado en la factura.</p>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {vatReport.map(quarter => <article key={quarter.quarter} className="rounded-xl border border-white/10 p-4 text-sm text-brand-muted">
                  <h3 className="font-semibold text-brand-text">Trimestre {quarter.quarter}</h3>
                  <p className="mt-2">Repercutido: {formatCents(quarter.outputVatCents)}</p>
                  <p>Deducible: {formatCents(quarter.deductibleVatCents)}</p>
                  <p className="mt-2 font-semibold text-brand-text">{quarter.balanceCents < 0 ? "Saldo a compensar" : "Saldo a ingresar"}: {formatCents(Math.abs(quarter.balanceCents))}</p>
                </article>)}
              </div>
            </section>            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
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

                <div className="mt-5 space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/20">
                    <button
                      type="button"
                      onClick={() =>
                        setInvoiceSettingsOpen((current) => !current)
                      }
                      className="flex w-full flex-col gap-2 p-3 text-left transition hover:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-brand-accent" />
                        <span className="text-sm font-semibold text-brand-text">
                          Datos fiscales por defecto
                        </span>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-brand-muted">
                        <span className="truncate">
                          {data.invoiceSettings.businessName ||
                            "Configurar emisor"}
                        </span>
                        {invoiceSettingsOpen ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </span>
                    </button>
                    {invoiceSettingsOpen ? (
                      <div className="border-t border-white/10 p-3">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <label className="block text-sm text-brand-muted md:col-span-2 xl:col-span-3">
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
                      <label className="block text-sm text-brand-muted md:col-span-2 xl:col-span-3">
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
                      <label className="block text-sm text-brand-muted md:col-span-2 xl:col-span-3">
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
                      <label className="block text-sm text-brand-muted md:col-span-2 xl:col-span-3">
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
                      <label className="block text-sm text-brand-muted md:col-span-2 xl:col-span-3">
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
                        <div className="mt-3 flex justify-end">
                          <button
                            type="button"
                            onClick={handleSaveInvoiceSettings}
                            disabled={savingInvoiceSettings}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10 disabled:opacity-60"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingInvoiceSettings
                              ? "Guardando..."
                              : "Guardar datos"}
                          </button>
                        </div>
                      </div>
                    ) : null}
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

                <div className="mt-5 border-t border-white/10 pt-4">
                  <div className="flex items-center gap-2">
                    <FileUp className="h-5 w-5 text-brand-accent" />
                    <h2 className="text-lg font-semibold text-brand-text">
                      Facturas PDF cargadas
                    </h2>
                  </div>
                  <div className="mt-4 space-y-2">
                    {data.expenseInvoiceFiles.map((file) => {
                      const expense = data.expenses.find(
                        (item) => item.id === file.expenseId,
                      );
                      return (
                        <article
                          key={file.id}
                          className="rounded-xl border border-white/10 bg-black/20 p-3"
                        >
                          <p
                            className="truncate text-sm font-semibold text-brand-text"
                            title={file.fileName}
                          >
                            {expense?.description ||
                              file.parsedSupplier ||
                              file.fileName}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                file.status === "expense-created"
                                  ? "bg-emerald-400/15 text-emerald-100"
                                  : "bg-amber-400/15 text-amber-100"
                              }`}
                            >
                              {file.status === "expense-created"
                                ? "Gasto registrado"
                                : "Pendiente de revisar"}
                            </span>
                            <span className="text-xs text-brand-muted">
                              {file.parsedDate
                                ? formatDate(file.parsedDate)
                                : "Fecha no detectada"}{" "}
                              -{" "}
                              {file.parsedAmountCents > 0
                                ? formatCents(expense ? expenseEuroCents(expense) : file.parsedAmountCents)
                                : "Importe no detectado"}
                            </span>
                          </div>
                          {expense && expense.currency !== "EUR" ? <p className="mt-2 text-xs text-brand-muted">Original: {formatCents(expense.amountCents, expense.currency)} · Cambio del {formatDate(expense.exchangeRateDate || DEFAULT_EXCHANGE_RATES.date)}</p> : null}
                          {file.parseError ? (
                            <p className="mt-2 text-xs text-amber-100/80">
                              {file.parseError}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            {file.driveFileId ? (
                              <a
                                href={`/api/admin/finance/expense-invoices/${file.id}/pdf`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                PDF
                              </a>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => void handleDeleteExpenseInvoice(file)}
                              disabled={deletingExpenseInvoiceId === file.id}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-400/35 px-2.5 py-1.5 text-xs text-red-100 transition hover:bg-red-500/10 disabled:opacity-60"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {deletingExpenseInvoiceId === file.id
                                ? "Eliminando..."
                                : "Eliminar"}
                            </button>
                          </div>
                        </article>
                      );
                    })}
                    {!data.expenseInvoiceFiles.length ? (
                      <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                        Sin facturas recibidas cargadas.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-brand-accent" />
                <h2 className="text-lg font-semibold text-brand-text">
                  Gastos registrados
                </h2>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {data.expenses.slice(0, 9).map((expense) => {
                  const invoiceFile = expenseInvoiceByExpenseId.get(expense.id);
                  return (
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
                          {formatCents(expenseEuroCents(expense))}
                        </p>
                      </div>
                      {expense.currency !== "EUR" ? <p className="mt-2 text-xs text-brand-muted">Original: {formatCents(expense.amountCents, expense.currency)} · Cambio del {formatDate(expense.exchangeRateDate || DEFAULT_EXCHANGE_RATES.date)}</p> : null}
                      {expense.notes ? (
                        <p className="mt-2 text-xs text-brand-muted">
                          {expense.notes}
                        </p>
                      ) : null}
                      {invoiceFile ? (
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                          {invoiceFile.driveFileId ? (
                            <a
                              href={`/api/admin/finance/expense-invoices/${invoiceFile.id}/pdf`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              PDF
                            </a>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => void handleDeleteExpenseInvoice(invoiceFile)}
                            disabled={deletingExpenseInvoiceId === invoiceFile.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-400/35 px-2.5 py-1.5 text-xs text-red-100 transition hover:bg-red-500/10 disabled:opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {deletingExpenseInvoiceId === invoiceFile.id
                              ? "Eliminando..."
                              : "Eliminar"}
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
                {!data.expenses.length ? (
                  <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                    Sin gastos registrados.
                  </p>
                ) : null}
              </div>
            </section>
            </>}
            <p className="text-center text-xs text-brand-muted">Importes contables en EUR · <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer" className="underline underline-offset-2">Tipos de cambio de ExchangeRate-API</a></p>

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
