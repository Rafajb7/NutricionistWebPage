"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  LogOut
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";

type SessionUser = {
  username: string;
  name: string;
};

type NutritionPlan = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};

type NutritionPlansShellProps = {
  user: SessionUser;
};

const CALENDAR_WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

function buildNutritionPlanViewerSrc(fileId: string): string {
  return `/api/nutrition-plans/${fileId}#toolbar=1&navpanes=0&statusbar=0&view=Fit&zoom=page-fit&pagemode=none`;
}

function toLocalDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-").map(Number);
  const parsed = new Date(yearRaw, monthRaw - 1, 1);
  if (Number.isNaN(parsed.getTime())) return monthKey;
  return parsed.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function getMonthKeyFromDate(value: string | null | undefined): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 7);
  return toLocalDateOnly(new Date()).slice(0, 7);
}

function shiftMonthKey(monthKey: string, offset: -1 | 1): string {
  const [yearRaw, monthRaw] = monthKey.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  const monthIndex = Number.isFinite(monthRaw) ? monthRaw - 1 : new Date().getMonth();
  const shifted = new Date(year, monthIndex + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function getCalendarCells(monthKey: string): Array<string | null> {
  const [yearRaw, monthRaw] = monthKey.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getFullYear();
  const monthIndex = Number.isFinite(monthRaw) ? monthRaw - 1 : new Date().getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const leadingEmptyCells = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: leadingEmptyCells }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toLocalDateOnly(new Date(year, monthIndex, day)));
  }

  return cells;
}

function getPlanTimestamp(plan: NutritionPlan): number | null {
  const modified = plan.modifiedTime ? Date.parse(plan.modifiedTime) : Number.NaN;
  const created = plan.createdTime ? Date.parse(plan.createdTime) : Number.NaN;
  const hasModified = !Number.isNaN(modified);
  const hasCreated = !Number.isNaN(created);

  if (!hasModified && !hasCreated) return null;
  if (!hasModified) return created;
  if (!hasCreated) return modified;
  return Math.max(modified, created);
}

function getPlanDateKey(plan: NutritionPlan): string | null {
  const timestamp = getPlanTimestamp(plan);
  if (timestamp === null) return null;
  return toLocalDateOnly(new Date(timestamp));
}

function getPlanDisplayDate(plan: NutritionPlan): string {
  const dateKey = getPlanDateKey(plan);
  return dateKey ? formatDateLabel(dateKey) : "Sin fecha";
}

function formatPlanSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Tamano desconocido";
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(sizeBytes / 1024)} KB`;
}

export function NutritionPlansShell({ user }: NutritionPlansShellProps) {
  const router = useRouter();
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    getMonthKeyFromDate(toLocalDateOnly(new Date()))
  );

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/tools");
    router.prefetch("/community");
  }, [router]);

  const orderedPlans = useMemo(() => {
    return [...plans].sort((a, b) => {
      const aTs = getPlanTimestamp(a) ?? 0;
      const bTs = getPlanTimestamp(b) ?? 0;
      return bTs - aTs;
    });
  }, [plans]);

  const selectedPlanIndex = useMemo(() => {
    if (!selectedPlanId) return -1;
    return orderedPlans.findIndex((plan) => plan.id === selectedPlanId);
  }, [orderedPlans, selectedPlanId]);

  const effectiveSelectedPlanIndex =
    selectedPlanIndex >= 0 ? selectedPlanIndex : orderedPlans.length ? 0 : -1;
  const selectedPlan =
    effectiveSelectedPlanIndex >= 0 ? orderedPlans[effectiveSelectedPlanIndex] : null;
  const selectedPlanDate = selectedPlan ? getPlanDateKey(selectedPlan) : null;
  const canGoToPreviousPlan =
    effectiveSelectedPlanIndex >= 0 && effectiveSelectedPlanIndex < orderedPlans.length - 1;
  const canGoToNextPlan = effectiveSelectedPlanIndex > 0;

  const planDates = useMemo(() => {
    const byDate = new Map<string, NutritionPlan[]>();
    for (const plan of orderedPlans) {
      const dateKey = getPlanDateKey(plan);
      if (!dateKey) continue;
      const list = byDate.get(dateKey) ?? [];
      list.push(plan);
      byDate.set(dateKey, list);
    }
    return byDate;
  }, [orderedPlans]);

  const calendarCells = useMemo(() => getCalendarCells(calendarMonth), [calendarMonth]);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/nutrition-plans", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as { plans?: NutritionPlan[]; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "No se pudieron cargar los planes nutricionales.");
      }

      const nextPlans = (Array.isArray(json.plans) ? json.plans : []).sort((a, b) => {
        const aTs = getPlanTimestamp(a) ?? 0;
        const bTs = getPlanTimestamp(b) ?? 0;
        return bTs - aTs;
      });
      setPlans(nextPlans);
      setSelectedPlanId((current) => {
        if (current && nextPlans.some((plan) => plan.id === current)) return current;
        return nextPlans[0]?.id ?? null;
      });
    } catch (error) {
      console.error(error);
      toast.error("Error al cargar los planes nutricionales.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!selectedPlanDate) return;
    setCalendarMonth(getMonthKeyFromDate(selectedPlanDate));
  }, [selectedPlanDate]);

  function movePlan(offset: -1 | 1) {
    if (effectiveSelectedPlanIndex < 0) return;
    const nextPlan = orderedPlans[effectiveSelectedPlanIndex + offset];
    if (!nextPlan) return;
    setSelectedPlanId(nextPlan.id);
    setCalendarOpen(false);
  }

  function selectPlanDate(date: string) {
    const plansForDate = planDates.get(date);
    if (!plansForDate?.length) return;
    setSelectedPlanId(plansForDate[0].id);
    setCalendarOpen(false);
  }

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/dashboard">
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  Dashboard
                </BrandButton>
              </Link>
              <Link href="/tools">
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  Herramientas
                </BrandButton>
              </Link>
              <Link href="/nutrition-plans">
                <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                  Planes nutricionales
                </BrandButton>
              </Link>
              <Link href="/community">
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  Comunidad
                </BrandButton>
              </Link>
              <div className="px-2 text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Usuario</p>
                <p className="text-sm font-semibold text-brand-text">{user.name}</p>
              </div>
              <BrandButton
                variant="ghost"
                className="w-full justify-center px-4 py-2 sm:w-auto"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.45 }}
          className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow"
        >
          <p className="text-xs uppercase tracking-[0.25em] text-brand-muted">
            Planes nutricionales
          </p>
          <h1 className="mt-2 text-3xl font-bold text-brand-text">Historico de planificacion</h1>
        </motion.section>

        {loading ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-3 h-4 w-2/3" />
            <Skeleton className="mt-4 h-[64vh] w-full rounded-xl" />
          </section>
        ) : !selectedPlan ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center text-sm text-brand-muted">
            Aun no hay PDFs en tu carpeta de planes nutricionales.
          </section>
        ) : (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/75">
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 px-4 py-4">
              <button
                type="button"
                onClick={() => movePlan(1)}
                disabled={!canGoToPreviousPlan}
                className="inline-flex aspect-square items-center justify-center rounded-xl border border-white/15 text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Plan anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 text-center">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                  Plan seleccionado
                </p>
                <h2 className="mt-1 truncate text-lg font-semibold text-brand-text">
                  {selectedPlan.name}
                </h2>
                <p className="mt-1 text-xs text-brand-muted">
                  {getPlanDisplayDate(selectedPlan)} | {formatPlanSize(selectedPlan.sizeBytes)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => movePlan(-1)}
                disabled={!canGoToNextPlan}
                className="inline-flex aspect-square items-center justify-center rounded-xl border border-white/15 text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Plan posterior"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            <div className="border-t border-white/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCalendarOpen((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-sm text-brand-text transition hover:border-brand-accent/50 hover:bg-black/30"
                    aria-label="Abrir calendario de planes nutricionales"
                  >
                    <Calendar className="h-4 w-4 text-brand-accent" />
                    {selectedPlanDate ? formatDateLabel(selectedPlanDate) : "Calendario"}
                  </button>

                  {calendarOpen ? (
                    <div className="absolute left-0 top-full z-30 mt-2 w-[min(92vw,22rem)] rounded-xl border border-white/10 bg-[#111114] p-3 shadow-glow">
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setCalendarMonth((current) => shiftMonthKey(current, -1))}
                          className="rounded-lg border border-white/15 p-2 text-brand-text transition hover:bg-white/10"
                          aria-label="Mes anterior"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <p className="text-sm font-semibold capitalize text-brand-text">
                          {formatMonthLabel(calendarMonth)}
                        </p>
                        <button
                          type="button"
                          onClick={() => setCalendarMonth((current) => shiftMonthKey(current, 1))}
                          className="rounded-lg border border-white/15 p-2 text-brand-text transition hover:bg-white/10"
                          aria-label="Mes siguiente"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] uppercase tracking-[0.14em] text-brand-muted">
                        {CALENDAR_WEEKDAYS.map((day) => (
                          <span key={day} className="py-1">
                            {day}
                          </span>
                        ))}
                      </div>
                      <div className="mt-1 grid grid-cols-7 gap-1">
                        {calendarCells.map((cell, index) => {
                          if (!cell) {
                            return <div key={`empty-${index}`} className="aspect-square" />;
                          }

                          const hasPlan = planDates.has(cell);
                          const isSelected = selectedPlanDate === cell;
                          return (
                            <button
                              key={cell}
                              type="button"
                              onClick={() => selectPlanDate(cell)}
                              disabled={!hasPlan}
                              className={
                                isSelected
                                  ? "aspect-square rounded-lg border border-brand-accent/70 bg-brand-accent/15 text-sm font-semibold text-brand-text"
                                  : hasPlan
                                    ? "aspect-square rounded-lg border border-red-400/35 bg-red-500/10 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                                    : "aspect-square rounded-lg border border-transparent text-sm text-brand-muted/45"
                              }
                            >
                              {Number(cell.slice(8))}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/nutrition-plans/${selectedPlan.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/40 px-3 py-2 text-xs text-brand-text transition hover:bg-brand-accent/10"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Abrir
                  </a>
                  <a
                    href={`/api/nutrition-plans/${selectedPlan.id}?download=1`}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-2 text-xs text-brand-text transition hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Descargar
                  </a>
                </div>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-white">
                <iframe
                  title={selectedPlan.name}
                  src={buildNutritionPlanViewerSrc(selectedPlan.id)}
                  className="h-[72vh] min-h-[520px] w-full border-0 bg-white"
                />
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-brand-muted">
                <FileText className="h-3.5 w-3.5 text-brand-accent" />
                <span className="truncate">{selectedPlan.name}</span>
              </div>
            </div>
          </section>
        )}
      </div>
    </MotionPage>
  );
}
