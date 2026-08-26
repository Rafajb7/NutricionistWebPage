"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  FileText,
  LogOut,
  ThumbsDown,
  ThumbsUp,
  Utensils
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  calculateEntryTotals,
  calculateMealTotals,
  calculatePlanTotals
} from "@/lib/nutrition/calculations";
import { getRestrictionConflict } from "@/lib/nutrition/restrictions";
import type {
  NutritionAthleteRestriction,
  NutritionChangeRequest,
  NutritionFood,
  NutritionMealCompletion,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionPlanFull,
  NutritionTotals
} from "@/lib/nutrition/types";

type SessionUser = {
  username: string;
  name: string;
};

type InteractiveNutritionShellProps = {
  user: SessionUser;
};

type InteractiveNutritionResponse = {
  date?: string;
  plans?: NutritionPlanFull[];
  foods?: NutritionFood[];
  restrictions?: NutritionAthleteRestriction[];
  completions?: NutritionMealCompletion[];
  changeRequests?: NutritionChangeRequest[];
  error?: string;
};

function toLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value: string): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatNumber(value: number, suffix = ""): string {
  if (!Number.isFinite(value)) return `0${suffix}`;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function formatTotals(totals: NutritionTotals): string {
  return `${formatNumber(totals.caloriesKcal, " kcal")} | P ${formatNumber(
    totals.proteinG,
    " g"
  )} | C ${formatNumber(totals.carbsG, " g")} | G ${formatNumber(totals.fatG, " g")}`;
}

function completionKey(planId: string, mealId: string): string {
  return `${planId}__${mealId}`;
}

function toEntryLike(alternative: NutritionPlanFoodAlternative): Pick<
  NutritionPlanFoodEntry,
  | "quantityG"
  | "proteinPer100g"
  | "carbsPer100g"
  | "fatPer100g"
  | "sodiumPer100g"
  | "waterPer100g"
> {
  return {
    quantityG: alternative.quantityG,
    proteinPer100g: alternative.proteinPer100g,
    carbsPer100g: alternative.carbsPer100g,
    fatPer100g: alternative.fatPer100g,
    sodiumPer100g: alternative.sodiumPer100g,
    waterPer100g: alternative.waterPer100g
  };
}

function getFoodCaloriesPer100g(food: Pick<NutritionFood, "proteinPer100g" | "carbsPer100g" | "fatPer100g">): number {
  return food.proteinPer100g * 4 + food.carbsPer100g * 4 + food.fatPer100g * 9;
}

function getEquivalentQuantityG(food: NutritionFood, originalCaloriesKcal: number): number {
  const kcalPer100g = getFoodCaloriesPer100g(food);
  if (!Number.isFinite(kcalPer100g) || kcalPer100g <= 0) return 100;
  return Math.min(10000, Math.max(1, Math.round((originalCaloriesKcal / kcalPer100g) * 100)));
}

function MacroPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-brand-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-brand-text">{value}</p>
    </div>
  );
}

export function InteractiveNutritionShell({ user }: InteractiveNutritionShellProps) {
  const router = useRouter();
  const [date, setDate] = useState(() => toLocalDateOnly(new Date()));
  const [plans, setPlans] = useState<NutritionPlanFull[]>([]);
  const [foods, setFoods] = useState<NutritionFood[]>([]);
  const [restrictions, setRestrictions] = useState<NutritionAthleteRestriction[]>([]);
  const [completions, setCompletions] = useState<NutritionMealCompletion[]>([]);
  const [changeRequests, setChangeRequests] = useState<NutritionChangeRequest[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingMeals, setSavingMeals] = useState<Set<string>>(() => new Set());
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(() => new Set());
  const [requestingEntryId, setRequestingEntryId] = useState<string | null>(null);
  const [requestFoodSearch, setRequestFoodSearch] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [submittingRequest, setSubmittingRequest] = useState(false);

  const loadNutrition = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nutrition-interactive?date=${encodeURIComponent(date)}`, {
        cache: "no-store"
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as InteractiveNutritionResponse;
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la dieta.");

      const nextPlans = json.plans ?? [];
      setPlans(nextPlans);
      setFoods(json.foods ?? []);
      setRestrictions(json.restrictions ?? []);
      setCompletions(json.completions ?? []);
      setChangeRequests(json.changeRequests ?? []);
      setSelectedPlanId((current) => {
        if (current && nextPlans.some((plan) => plan.id === current)) return current;
        return nextPlans[0]?.id ?? "";
      });
      setExpandedMeals((current) => {
        if (current.size) return current;
        const firstMeal = nextPlans[0]?.meals.find((meal) => meal.included);
        return firstMeal ? new Set([firstMeal.id]) : new Set();
      });
    } catch (error) {
      console.error(error);
      toast.error("Error cargando la dieta interactiva.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/tools");
    router.prefetch("/nutrition-plans");
  }, [router]);

  useEffect(() => {
    void loadNutrition();
  }, [loadNutrition]);

  const foodsById = useMemo(() => {
    const map = new Map<string, NutritionFood>();
    foods.forEach((food) => map.set(food.id, food));
    return map;
  }, [foods]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );
  const selectedPlanTotals = selectedPlan ? calculatePlanTotals(selectedPlan) : null;
  const completionsByMeal = useMemo(() => {
    const map = new Map<string, NutritionMealCompletion>();
    completions.forEach((item) => {
      map.set(completionKey(item.planId, item.mealId), item);
    });
    return map;
  }, [completions]);
  const pendingRequestsByEntry = useMemo(() => {
    const map = new Map<string, NutritionChangeRequest>();
    changeRequests
      .filter((request) => request.status === "pending")
      .forEach((request) => map.set(request.entryId, request));
    return map;
  }, [changeRequests]);
  const includedMeals = selectedPlan?.meals.filter((meal) => meal.included) ?? [];
  const completedIncludedMeals = includedMeals.filter(
    (meal) => completionsByMeal.get(completionKey(selectedPlan?.id ?? "", meal.id))?.completed
  ).length;
  const completedPercent = includedMeals.length
    ? Math.round((completedIncludedMeals / includedMeals.length) * 100)
    : 0;

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  function toggleMealExpansion(mealId: string) {
    setExpandedMeals((current) => {
      const next = new Set(current);
      if (next.has(mealId)) next.delete(mealId);
      else next.add(mealId);
      return next;
    });
  }

  async function toggleMealCompletion(planId: string, mealId: string, completed: boolean) {
    const key = completionKey(planId, mealId);
    setSavingMeals((current) => new Set(current).add(key));
    try {
      const res = await fetch("/api/nutrition-interactive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, planId, mealId, completed })
      });
      const json = (await res.json()) as {
        completion?: NutritionMealCompletion;
        error?: string;
      };
      if (!res.ok || !json.completion) {
        throw new Error(json.error ?? "No se pudo guardar la comida.");
      }
      setCompletions((current) => {
        const next = current.filter((item) => item.id !== json.completion?.id);
        return [...next, json.completion as NutritionMealCompletion];
      });
    } catch (error) {
      console.error(error);
      toast.error("No se pudo guardar esta comida.");
    } finally {
      setSavingMeals((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function getFoodConflict(foodId: string) {
    const food = foodsById.get(foodId);
    if (!food) return null;
    return getRestrictionConflict(food, restrictions);
  }

  function getRequestFoodOptions(entry: NutritionPlanFoodEntry) {
    const q = requestFoodSearch.trim().toLowerCase();
    return foods
      .filter((food) => food.active && food.id !== entry.foodId)
      .filter((food) => !getRestrictionConflict(food, restrictions))
      .filter((food) => {
        if (!q) return true;
        return (
          food.name.toLowerCase().includes(q) ||
          food.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .slice(0, 8);
  }

  async function submitChangeRequest(input: {
    planId: string;
    mealId: string;
    entry: NutritionPlanFoodEntry;
    food: NutritionFood;
  }) {
    setSubmittingRequest(true);
    try {
      const res = await fetch("/api/nutrition-change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: input.planId,
          mealId: input.mealId,
          entryId: input.entry.id,
          requestedFoodId: input.food.id,
          athleteNotes: requestNotes
        })
      });
      const json = (await res.json()) as {
        request?: NutritionChangeRequest;
        error?: string;
      };
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "No se pudo enviar la solicitud.");
      }
      setChangeRequests((current) => [json.request!, ...current]);
      setRequestingEntryId(null);
      setRequestFoodSearch("");
      setRequestNotes("");
      toast.success("Solicitud enviada al nutricionista.");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Error enviando solicitud.");
    } finally {
      setSubmittingRequest(false);
    }
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
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  Planes PDF
                </BrandButton>
              </Link>
              <Link href="/nutrition">
                <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                  Dieta interactiva
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
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-brand-muted">
                Plan nutricional interactivo
              </p>
              <h1 className="mt-2 text-3xl font-bold text-brand-text">Dieta del dia</h1>
              <p className="mt-2 text-sm text-brand-muted">{formatDateLabel(date)}</p>
            </div>
            <label className="block text-sm text-brand-muted">
              Fecha
              <div className="relative mt-2">
                <Calendar className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-muted" />
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 lg:w-56"
                />
              </div>
            </label>
          </div>
        </motion.section>

        {loading ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="mt-4 h-24 w-full" />
            <Skeleton className="mt-4 h-44 w-full" />
            <Skeleton className="mt-4 h-44 w-full" />
          </section>
        ) : !selectedPlan ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center">
            <Utensils className="mx-auto h-8 w-8 text-brand-accent" />
            <p className="mt-3 text-sm text-brand-muted">
              Todavia no hay ningun plan publicado para mostrar en la web.
            </p>
            <Link
              href="/nutrition-plans"
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-brand-text transition hover:bg-white/10"
            >
              <FileText className="h-4 w-4" />
              Ver PDFs disponibles
            </Link>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                    Modalidad seleccionada
                  </p>
                  <h2 className="mt-1 truncate text-xl font-semibold text-brand-text">
                    {selectedPlan.name}
                  </h2>
                  {selectedPlan.notes ? (
                    <p className="mt-2 max-w-3xl text-sm text-brand-muted">{selectedPlan.notes}</p>
                  ) : null}
                </div>
                <div className="grid min-w-0 gap-2 sm:grid-cols-4 lg:min-w-[32rem]">
                  {selectedPlanTotals ? (
                    <>
                      <MacroPill label="Kcal" value={formatNumber(selectedPlanTotals.caloriesKcal)} />
                      <MacroPill label="Proteinas" value={formatNumber(selectedPlanTotals.proteinG, " g")} />
                      <MacroPill label="Carbos" value={formatNumber(selectedPlanTotals.carbsG, " g")} />
                      <MacroPill label="Grasas" value={formatNumber(selectedPlanTotals.fatG, " g")} />
                    </>
                  ) : null}
                </div>
              </div>

              {plans.length > 1 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={
                        plan.id === selectedPlan.id
                          ? "rounded-xl border border-brand-accent/60 bg-brand-accent/15 px-4 py-2 text-sm font-semibold text-brand-text"
                          : "rounded-xl border border-white/15 bg-black/20 px-4 py-2 text-sm text-brand-muted transition hover:bg-white/10"
                      }
                    >
                      {plan.name}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-brand-text">Progreso del dia</p>
                    <p className="mt-1 text-xs text-brand-muted">
                      {completedIncludedMeals}/{includedMeals.length} comidas realizadas
                    </p>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 sm:w-64">
                    <div
                      className="h-full rounded-full bg-brand-accent transition-all"
                      style={{ width: `${completedPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              {includedMeals.map((meal) => {
                const totals = calculateMealTotals(meal.entries);
                const mealKey = completionKey(selectedPlan.id, meal.id);
                const completion = completionsByMeal.get(mealKey);
                const completed = Boolean(completion?.completed);
                const saving = savingMeals.has(mealKey);
                const expanded = expandedMeals.has(meal.id);

                return (
                  <article
                    key={meal.id}
                    className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            void toggleMealCompletion(selectedPlan.id, meal.id, !completed)
                          }
                          disabled={saving}
                          className={
                            completed
                              ? "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/40 bg-emerald-500/15 text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-60"
                              : "mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-black/20 text-brand-muted transition hover:bg-white/10 disabled:opacity-60"
                          }
                          aria-label={completed ? "Marcar comida pendiente" : "Marcar comida realizada"}
                        >
                          <CheckCircle2 className="h-5 w-5" />
                        </button>
                        <div className="min-w-0">
                          <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                            {completed ? "Comida realizada" : "Pendiente"}
                          </p>
                          <h3 className="mt-1 text-xl font-semibold text-brand-text">{meal.name}</h3>
                          <p className="mt-1 text-sm text-brand-muted">{formatTotals(totals)}</p>
                          {meal.notes ? (
                            <p className="mt-2 text-sm text-brand-muted">{meal.notes}</p>
                          ) : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleMealExpansion(meal.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-2 text-sm text-brand-text transition hover:bg-white/10"
                      >
                        {expanded ? "Ocultar" : "Ver comida"}
                        <ChevronDown
                          className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`}
                        />
                      </button>
                    </div>

                    {expanded ? (
                      <div className="mt-4 space-y-3">
                        {meal.entries.map((entry) => {
                          const entryTotals = calculateEntryTotals(entry);
                          const conflict = getFoodConflict(entry.foodId);
                          const pendingRequest = pendingRequestsByEntry.get(entry.id);
                          const requestOptions = getRequestFoodOptions(entry);

                          return (
                            <div
                              key={entry.id}
                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                            >
                              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold text-brand-text">
                                      {entry.foodName}
                                    </p>
                                    {conflict ? (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-red-400/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-100">
                                        <ThumbsDown className="h-3 w-3" />
                                        {conflict.label}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                                        <ThumbsUp className="h-3 w-3" />
                                        Compatible
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-sm text-brand-muted">
                                    {entry.quantityG} g | {formatTotals(entryTotals)}
                                  </p>
                                  {entry.customText ? (
                                    <p className="mt-2 text-sm text-brand-muted">{entry.customText}</p>
                                  ) : null}
                                  {pendingRequest ? (
                                    <p className="mt-2 text-xs text-brand-muted">
                                      Solicitud pendiente: {pendingRequest.requestedFoodName} (
                                      {pendingRequest.requestedQuantityG} g)
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex justify-start md:justify-end">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRequestingEntryId((current) =>
                                        current === entry.id ? null : entry.id
                                      );
                                      setRequestFoodSearch("");
                                      setRequestNotes("");
                                    }}
                                    disabled={Boolean(pendingRequest)}
                                    className="inline-flex items-center justify-center rounded-lg border border-brand-accent/35 px-3 py-2 text-xs text-brand-text transition hover:bg-brand-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    Solicitar cambio
                                  </button>
                                </div>
                              </div>

                              {requestingEntryId === entry.id && !pendingRequest ? (
                                <div className="mt-3 rounded-lg border border-brand-accent/25 bg-brand-accent/10 p-3">
                                  <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">
                                    Proponer sustitucion
                                  </p>
                                  <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                    <input
                                      value={requestFoodSearch}
                                      onChange={(event) => setRequestFoodSearch(event.target.value)}
                                      placeholder="Buscar alimento de la base de datos"
                                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                                    />
                                    <input
                                      value={requestNotes}
                                      onChange={(event) => setRequestNotes(event.target.value)}
                                      placeholder="Nota opcional para el nutricionista"
                                      className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                                    />
                                  </div>
                                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                                    {requestOptions.map((food) => {
                                      const suggestedQuantity = getEquivalentQuantityG(
                                        food,
                                        entryTotals.caloriesKcal
                                      );
                                      return (
                                        <button
                                          key={food.id}
                                          type="button"
                                          onClick={() =>
                                            void submitChangeRequest({
                                              planId: selectedPlan.id,
                                              mealId: meal.id,
                                              entry,
                                              food
                                            })
                                          }
                                          disabled={submittingRequest}
                                          className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-left transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          <p className="text-sm font-semibold text-brand-text">
                                            {food.name}
                                          </p>
                                          <p className="mt-1 text-xs text-brand-muted">
                                            {suggestedQuantity} g aprox. |{" "}
                                            {formatNumber(entryTotals.caloriesKcal, " kcal")}
                                          </p>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {!requestOptions.length ? (
                                    <p className="mt-3 text-sm text-brand-muted">
                                      No hay alimentos compatibles para esa busqueda.
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}

                              {entry.alternatives.length ? (
                                <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
                                  <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">
                                    Alternativas equivalentes
                                  </p>
                                  <div className="mt-2 space-y-2">
                                    {entry.alternatives.map((alternative) => {
                                      const alternativeTotals = calculateEntryTotals(
                                        toEntryLike(alternative)
                                      );
                                      const alternativeConflict = getFoodConflict(alternative.foodId);

                                      return (
                                        <div
                                          key={alternative.id}
                                          className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                          <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                              <p className="text-sm font-semibold text-brand-text">
                                                {alternative.foodName}
                                              </p>
                                              {alternativeConflict ? (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-red-400/35 bg-red-500/10 px-2 py-1 text-[11px] text-red-100">
                                                  <ThumbsDown className="h-3 w-3" />
                                                  {alternativeConflict.label}
                                                </span>
                                              ) : (
                                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-100">
                                                  <ThumbsUp className="h-3 w-3" />
                                                  Compatible
                                                </span>
                                              )}
                                            </div>
                                            {alternative.customText ? (
                                              <p className="mt-1 text-xs text-brand-muted">
                                                {alternative.customText}
                                              </p>
                                            ) : null}
                                          </div>
                                          <p className="shrink-0 text-sm text-brand-muted">
                                            {alternative.quantityG} g |{" "}
                                            {formatNumber(alternativeTotals.caloriesKcal, " kcal")}
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>

            {restrictions.length ? (
              <section className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-200" />
                  <div>
                    <p className="font-semibold text-red-100">Restricciones registradas</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {restrictions.map((restriction) => (
                        <span
                          key={restriction.id}
                          className="rounded-full border border-red-300/30 bg-red-500/10 px-3 py-1 text-xs text-red-100"
                        >
                          {restriction.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </MotionPage>
  );
}
