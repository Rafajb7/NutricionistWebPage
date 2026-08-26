"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  FileClock,
  LineChart,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  WalletCards,
  XCircle
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  formatCents,
  getComputedPaymentStatus,
  getMonthRange,
  todayIsoDate
} from "@/lib/finance/calculations";
import type {
  FinanceAthlete,
  FinanceComputedPaymentStatus,
  FinanceContract,
  FinanceDashboard,
  FinanceManagementData,
  FinanceMonthlyPoint,
  FinancePayment,
  FinancePaymentStatus,
  FinancePlanOption
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

const EMPTY_DASHBOARD: FinanceDashboard = {
  paidThisMonthCents: 0,
  expectedThisMonthCents: 0,
  pendingCents: 0,
  next30DaysCents: 0,
  overdueCount: 0,
  activeAthletesCount: 0,
  activeContractValueCents: 0,
  monthlyVariationPercent: null,
  renewalAlerts: [],
  monthlySeries: []
};

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
    notes: ""
  };
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
    year: "numeric"
  });
}

function formatMonthLabel(value: string): string {
  const parsed = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    month: "short",
    year: "2-digit"
  });
}

function statusLabel(status: FinanceComputedPaymentStatus): string {
  if (status === "paid") return "Cobrado";
  if (status === "cancelled") return "Cancelado";
  if (status === "overdue") return "Vencido";
  return "Pendiente";
}

function statusClass(status: FinanceComputedPaymentStatus): string {
  if (status === "paid") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (status === "cancelled") return "border-zinc-400/30 bg-zinc-500/10 text-zinc-200";
  if (status === "overdue") return "border-red-400/40 bg-red-500/10 text-red-200";
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
  return athletes.find((athlete) => athlete.username === username)?.name ?? username;
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint
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
          <p className="text-xs uppercase tracking-[0.14em] text-brand-muted">{label}</p>
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
    ...data.flatMap((point) => [point.expectedCents, point.paidCents])
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
      </div>
      <svg viewBox={`0 0 ${width} 220`} className="h-56 w-full" role="img">
        <line x1="20" y1="170" x2={width - 8} y2="170" stroke="rgba(255,255,255,0.18)" />
        {data.map((point, index) => {
          const x = 28 + index * barSlot;
          const expectedHeight = (point.expectedCents / maxValue) * chartHeight;
          const paidHeight = (point.paidCents / maxValue) * chartHeight;
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
  const maxValue = Math.max(1, ...data.map((point) => point.paidCents));
  if (!data.length || maxValue <= 1) return <EmptyChart />;

  const width = 560;
  const height = 200;
  const graphHeight = 140;
  const step = data.length > 1 ? (width - 56) / (data.length - 1) : 0;
  const coords = data.map((point, index) => {
    const x = 28 + index * step;
    const y = 160 - (point.paidCents / maxValue) * graphHeight;
    return `${x},${y}`;
  });

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/20 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full" role="img">
        <line x1="24" y1="160" x2={width - 24} y2="160" stroke="rgba(255,255,255,0.18)" />
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
    planOptions: [],
    dashboard: EMPTY_DASHBOARD
  });
  const [loading, setLoading] = useState(true);
  const [savingContract, setSavingContract] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [contractActionId, setContractActionId] = useState<string | null>(null);

  const [athleteFilter, setAthleteFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FinanceComputedPaymentStatus>("all");
  const [periodFilter, setPeriodFilter] = useState<"all" | "month" | "next30" | "overdue">("all");
  const [search, setSearch] = useState("");
  const [selectedAthlete, setSelectedAthlete] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(todayIsoDate().slice(0, 7));

  const [form, setForm] = useState<FinanceFormState>(defaultFinanceForm);
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

      const json = (await res.json()) as Partial<FinanceManagementData> & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar Finanzas.");

      setData({
        athletes: json.athletes ?? [],
        contracts: json.contracts ?? [],
        payments: json.payments ?? [],
        planOptions: json.planOptions ?? [],
        dashboard: json.dashboard ?? EMPTY_DASHBOARD
      });
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
    [data.planOptions]
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

  const filteredPayments = useMemo(() => {
    const monthRange = getMonthRange(today);
    const next30 = addDays(today, 30);
    const q = normalizeText(search);
    return data.payments
      .filter((payment) => !athleteFilter || payment.athleteUsername === athleteFilter)
      .filter((payment) => {
        const computed = getComputedPaymentStatus(payment, today);
        return statusFilter === "all" || computed === statusFilter;
      })
      .filter((payment) => {
        if (periodFilter === "month") return payment.dueDate >= monthRange.start && payment.dueDate <= monthRange.end;
        if (periodFilter === "next30") return payment.dueDate >= today && payment.dueDate <= next30;
        if (periodFilter === "overdue") return getComputedPaymentStatus(payment, today) === "overdue";
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
    [data.payments, today]
  );

  const selectedAthleteData = useMemo(() => {
    if (!selectedAthlete) return null;
    const athlete = data.athletes.find((item) => item.username === selectedAthlete);
    if (!athlete) return null;
    const contracts = (contractsByAthlete.get(selectedAthlete) ?? []).sort((a, b) =>
      b.startDate.localeCompare(a.startDate)
    );
    const payments = data.payments
      .filter((payment) => payment.athleteUsername === selectedAthlete)
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    return { athlete, contracts, payments };
  }, [contractsByAthlete, data.athletes, data.payments, selectedAthlete]);

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  function updateForm<K extends keyof FinanceFormState>(key: K, value: FinanceFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
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
          idempotencyKey: crypto.randomUUID(),
          notes: form.notes
        })
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo crear el contrato.");
        return;
      }

      toast.success(form.previousContractId ? "Renovacion registrada." : "Contrato creado.");
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

  function startPaymentEdit(payment: FinancePayment) {
    setPaymentEdit({
      paymentId: payment.id,
      status: payment.status === "paid" ? "paid" : "paid",
      dueDate: payment.dueDate,
      expectedAmount: centsToInput(payment.expectedAmountCents),
      paidAt: payment.paidAt || today,
      paidAmount: centsToInput(payment.paidAmountCents || payment.expectedAmountCents),
      notes: payment.notes
    });
  }

  async function handleSavePayment() {
    if (!paymentEdit) return;

    setSavingPayment(true);
    try {
      const res = await fetch(`/api/admin/finance/payments/${paymentEdit.paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: paymentEdit.status,
          dueDate: paymentEdit.dueDate,
          expectedAmount: paymentEdit.expectedAmount,
          paidAt: paymentEdit.status === "paid" ? paymentEdit.paidAt : "",
          paidAmount: paymentEdit.status === "paid" ? paymentEdit.paidAmount : "",
          notes: paymentEdit.notes
        })
      });
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
    cancelFuture = false
  ) {
    if (status === "cancelled") {
      const confirmed = window.confirm(
        "Quieres cancelar este contrato? Los pagos futuros pendientes pueden marcarse como cancelados."
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
          cancelPendingFuturePayments: cancelFuture
        })
      });
      const json = (await res.json()) as { error?: string; cancelledPayments?: number };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo actualizar el contrato.");
        return;
      }

      toast.success(
        status === "cancelled"
          ? `Contrato cancelado. Pagos futuros cancelados: ${json.cancelledPayments ?? 0}.`
          : "Contrato actualizado."
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
      totalAmount: sameConditions ? centsToInput(contract.totalAmountCents) : "",
      startDate: contract.renewalDueDate,
      firstPaymentDate: contract.renewalDueDate,
      financed: sameConditions ? contract.financed : false,
      paymentCount: sameConditions ? String(contract.paymentCount) : "1",
      paymentAmount: sameConditions && contract.financed ? centsToInput(contract.paymentAmountCents) : "",
      paymentIntervalMonths: sameConditions ? String(contract.paymentIntervalMonths) : "1",
      previousContractId: contract.id,
      notes: sameConditions ? contract.notes : ""
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
      cells.push({ date: addDays(range.start, i - firstWeekday), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ date: `${calendarMonth}-${String(day).padStart(2, "0")}`, inMonth: true });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: addDays(range.end, cells.length % 7), inMonth: false });
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
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Herramientas admin
                </BrandButton>
              </Link>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Administrador</p>
                <p className="font-semibold text-brand-text">{user.name}</p>
              </div>
              <BrandButton variant="ghost" className="px-4 py-2" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <section className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Herramienta admin</p>
              <h1 className="mt-1 text-3xl font-semibold text-brand-text">Finanzas</h1>
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
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
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

            {data.dashboard.renewalAlerts.length || data.dashboard.overdueCount ? (
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
                          {alert.status === "overdue" ? "Renovacion vencida" : "Renovacion proxima"}
                        </p>
                        <p className="mt-1 text-sm text-brand-muted">
                          {alert.athleteName} - {alert.planLabel} - {formatDate(alert.renewalDueDate)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const contract = data.contracts.find((item) => item.id === alert.contractId);
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
                    <p className="text-sm font-semibold text-brand-text">Pagos vencidos</p>
                    <p className="mt-1 text-sm text-brand-muted">
                      Hay {data.dashboard.overdueCount} pagos pendientes fuera de plazo.
                    </p>
                  </article>
                ) : null}
              </section>
            ) : null}

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">Nuevo contrato</h2>
                    <p className="text-sm text-brand-muted">
                      Tambien sirve para configurar atletas existentes o renovar periodos.
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
                      onChange={(event) => updateForm("athleteUsername", event.target.value)}
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
                      onChange={(event) => updateForm("planKey", event.target.value)}
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
                      onChange={(event) => updateForm("totalAmount", event.target.value)}
                      placeholder="540,00"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Fecha inicio
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={(event) => updateForm("startDate", event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Fecha primer pago
                    <input
                      type="date"
                      value={form.firstPaymentDate}
                      onChange={(event) => updateForm("firstPaymentDate", event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Pago fraccionado
                    <select
                      value={form.financed ? "yes" : "no"}
                      onChange={(event) => updateForm("financed", event.target.value === "yes")}
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
                          onChange={(event) => updateForm("paymentCount", event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Importe por pago
                        <input
                          value={form.paymentAmount}
                          onChange={(event) => updateForm("paymentAmount", event.target.value)}
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
                          onChange={(event) => updateForm("paymentIntervalMonths", event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </>
                  ) : null}
                  <label className="block text-sm text-brand-muted md:col-span-2">
                    Notas
                    <textarea
                      value={form.notes}
                      onChange={(event) => updateForm("notes", event.target.value)}
                      rows={3}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <BrandButton onClick={handleCreateContract} disabled={savingContract}>
                    <Plus className="mr-2 h-4 w-4" />
                    {savingContract ? "Guardando..." : form.previousContractId ? "Registrar renovacion" : "Crear contrato"}
                  </BrandButton>
                  {form.previousContractId ? (
                    <BrandButton
                      variant="ghost"
                      onClick={() => setForm({ ...defaultFinanceForm(), athleteUsername: form.athleteUsername })}
                    >
                      Cancelar renovacion
                    </BrandButton>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">Proximos cobros</h2>
                <div className="mt-3 space-y-2">
                  {upcomingPayments.length ? (
                    upcomingPayments.map((payment) => {
                      const days = differenceInCalendarDays(payment.dueDate, today);
                      return (
                        <button
                          key={payment.id}
                          type="button"
                          onClick={() => startPaymentEdit(payment)}
                          className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-brand-accent/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-brand-text">{payment.athleteName}</p>
                              <p className="mt-1 text-xs text-brand-muted">
                                {payment.planLabel} - pago {payment.sequenceIndex}/{payment.sequenceCount}
                              </p>
                            </div>
                            <p className="text-sm font-semibold text-brand-text">
                              {formatCents(payment.expectedAmountCents)}
                            </p>
                          </div>
                          <p className="mt-2 text-xs text-brand-muted">
                            {formatDate(payment.dueDate)} - {days === 0 ? "hoy" : `en ${days} dias`}
                          </p>
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-brand-muted">No hay cobros proximos.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-brand-accent" />
                  <h2 className="text-lg font-semibold text-brand-text">Previsto vs cobrado</h2>
                </div>
                <ExpectedVsPaidChart points={data.dashboard.monthlySeries} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-brand-accent" />
                  <h2 className="text-lg font-semibold text-brand-text">Evolucion cobrada</h2>
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
                    <h2 className="text-lg font-semibold text-brand-text">Calendario financiero</h2>
                    <p className="text-sm text-brand-muted">Pagos previstos por dia.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCalendarMonth(addMonths(`${calendarMonth}-01`, -1).slice(0, 7))}
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
                      onClick={() => setCalendarMonth(addMonths(`${calendarMonth}-01`, 1).slice(0, 7))}
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
                      .filter((payment) => !athleteFilter || payment.athleteUsername === athleteFilter)
                      .slice(0, 3);
                    return (
                      <div
                        key={cell.date}
                        className={`min-h-28 rounded-xl border p-2 ${
                          cell.inMonth
                            ? "border-white/10 bg-black/20"
                            : "border-white/5 bg-black/10 opacity-60"
                        }`}
                      >
                        <p className="text-xs font-semibold text-brand-text">{Number(cell.date.slice(-2))}</p>
                        <div className="mt-2 space-y-1">
                          {payments.map((payment) => {
                            const computed = getComputedPaymentStatus(payment, today);
                            return (
                              <button
                                key={payment.id}
                                type="button"
                                onClick={() => startPaymentEdit(payment)}
                                className={`block w-full truncate rounded-md border px-1.5 py-1 text-left text-[11px] ${statusClass(computed)}`}
                                title={`${payment.athleteName} - ${formatCents(payment.expectedAmountCents)}`}
                              >
                                {payment.athleteName} - {formatCents(payment.expectedAmountCents)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h2 className="text-lg font-semibold text-brand-text">Ficha financiera</h2>
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
                      <p className="text-sm text-brand-muted">{selectedAthleteData.athlete.username}</p>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-brand-text">Contratos</h3>
                      <div className="mt-2 space-y-2">
                        {selectedAthleteData.contracts.length ? (
                          selectedAthleteData.contracts.map((contract) => (
                            <article key={contract.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-brand-text">{contract.planLabel}</p>
                                  <p className="text-xs text-brand-muted">
                                    {formatDate(contract.startDate)} - {formatDate(contract.endDate)}
                                  </p>
                                </div>
                                <span className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-brand-muted">
                                  {contractStatusLabel(contract.status)}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-brand-text">
                                {formatCents(contract.totalAmountCents, contract.currency)}
                              </p>
                              <p className="mt-1 text-xs text-brand-muted">
                                Renovacion: {formatDate(contract.renewalDueDate)}
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
                                      onClick={() => handleContractStatus(contract, "finished")}
                                      disabled={contractActionId === contract.id}
                                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 px-2.5 py-1.5 text-xs text-emerald-200 transition hover:bg-emerald-500/10 disabled:opacity-60"
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Finalizar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleContractStatus(contract, "cancelled", true)}
                                      disabled={contractActionId === contract.id}
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
                          <p className="text-sm text-brand-muted">Sin contratos registrados.</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-brand-text">Ultimos pagos</h3>
                      <div className="mt-2 space-y-2">
                        {selectedAthleteData.payments.slice(0, 6).map((payment) => {
                          const computed = getComputedPaymentStatus(payment, today);
                          return (
                            <button
                              key={payment.id}
                              type="button"
                              onClick={() => startPaymentEdit(payment)}
                              className="w-full rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-brand-accent/40"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm text-brand-text">{formatDate(payment.dueDate)}</span>
                                <span className={`rounded-full border px-2 py-1 text-[11px] ${statusClass(computed)}`}>
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
                    Selecciona un atleta para ver sus contratos, pagos e historico.
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-brand-text">Listado de pagos</h2>
                  <p className="text-sm text-brand-muted">Buscar, filtrar y registrar cobros.</p>
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
                      setStatusFilter(event.target.value as "all" | FinanceComputedPaymentStatus)
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
                      setPeriodFilter(event.target.value as "all" | "month" | "next30" | "overdue")
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
                        const computed = getComputedPaymentStatus(payment, today);
                        return (
                          <tr key={payment.id} className="border-t border-white/10">
                            <td className="px-3 py-2 text-brand-text">
                              <button
                                type="button"
                                onClick={() => setSelectedAthlete(payment.athleteUsername)}
                                className="text-left font-medium transition hover:text-brand-accent"
                              >
                                {payment.athleteName || getAthleteName(data.athletes, payment.athleteUsername)}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-brand-muted">
                              {payment.planLabel} {payment.sequenceCount > 1 ? `(${payment.sequenceIndex}/${payment.sequenceCount})` : ""}
                            </td>
                            <td className="px-3 py-2 text-brand-text">{formatDate(payment.dueDate)}</td>
                            <td className="px-3 py-2 text-brand-text">{formatCents(payment.expectedAmountCents)}</td>
                            <td className="px-3 py-2">
                              <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(computed)}`}>
                                {statusLabel(computed)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-brand-muted">{formatDate(payment.paidAt)}</td>
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
                        <td colSpan={7} className="px-3 py-8 text-center text-brand-muted">
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
                  <h2 className="text-lg font-semibold text-brand-text">Gestionar pago</h2>
                  <p className="text-sm text-brand-muted">
                    Puedes marcarlo como cobrado o ajustar fecha e importe previsto.
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
                          ? { ...current, status: event.target.value as FinancePaymentStatus }
                          : current
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
                      setPaymentEdit((current) => (current ? { ...current, dueDate: event.target.value } : current))
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
                        current ? { ...current, expectedAmount: event.target.value } : current
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
                            current ? { ...current, paidAt: event.target.value } : current
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
                            current ? { ...current, paidAmount: event.target.value } : current
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
                      setPaymentEdit((current) => (current ? { ...current, notes: event.target.value } : current))
                    }
                    rows={3}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <BrandButton variant="ghost" onClick={() => setPaymentEdit(null)}>
                  Cancelar
                </BrandButton>
                <BrandButton onClick={handleSavePayment} disabled={savingPayment}>
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
