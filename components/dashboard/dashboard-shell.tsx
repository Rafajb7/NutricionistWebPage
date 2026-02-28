"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, LogOut, Calendar, FileText, Download, Eye, BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { Skeleton } from "@/components/ui/skeleton";
import { MotionPage } from "@/components/ui/motion-page";

type SessionUser = {
  username: string;
  name: string;
};

type RevisionEntry = {
  nombre: string;
  fecha: string;
  usuario: string;
  pregunta: string;
  respuesta: string;
  imageUrl: string | null;
};

type DashboardShellProps = {
  user: SessionUser;
};

type NutritionPlan = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};

type NewPlanPopupState = {
  latestPlan: NutritionPlan;
  latestSeenTimestamp: number;
  recentCount: number;
};

type MetricKey =
  | "CINTURA"
  | "CADERA"
  | "BRAZO_RELAJADO"
  | "BRAZO_FLEXIONADO"
  | "MUSLO";

type MetricPoint = {
  date: string;
  value: number;
};

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: "CINTURA", label: "CINTURA" },
  { key: "CADERA", label: "CADERA" },
  { key: "BRAZO_RELAJADO", label: "BRAZO RELAJADO" },
  { key: "BRAZO_FLEXIONADO", label: "BRAZO FLEXIONADO" },
  { key: "MUSLO", label: "MUSLO" }
];

const METRIC_QUESTION_KEY: Record<string, MetricKey> = {
  CINTURA: "CINTURA",
  CADERA: "CADERA",
  BRAZORELAJADO: "BRAZO_RELAJADO",
  BRAZOFLEXIONADO: "BRAZO_FLEXIONADO",
  MUSLO: "MUSLO"
};

const NEW_PLAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_CACHE_TTL_MS = 90 * 1000;
const DASHBOARD_CACHE_VERSION = 1;

type DashboardClientCache = {
  timestamp: number;
  revisions: RevisionEntry[];
  plans: NutritionPlan[];
};

function normalizeMetricQuestion(question: string): string {
  return question
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[:\s]/g, "");
}

function metricKeyFromQuestion(question: string): MetricKey | null {
  return METRIC_QUESTION_KEY[normalizeMetricQuestion(question)] ?? null;
}

function parseMetricValue(raw: string): number | null {
  const normalized = raw.replace(",", ".");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function formatMetricDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function EvolutionChart({ points }: { points: MetricPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/25 p-6 text-sm text-brand-muted">
        No hay datos para esta métrica.
      </div>
    );
  }

  const width = 900;
  const height = 320;
  const paddingX = 56;
  const paddingY = 36;

  const minValue = Math.min(...points.map((item) => item.value));
  const maxValue = Math.max(...points.map((item) => item.value));
  const range = Math.max(maxValue - minValue, 1);

  const x = (index: number) =>
    paddingX + (index * (width - paddingX * 2)) / Math.max(points.length - 1, 1);
  const y = (value: number) =>
    height - paddingY - ((value - minValue) * (height - paddingY * 2)) / range;

  const polyline = points.map((item, index) => `${x(index)},${y(item.value)}`).join(" ");

  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }).map((_, index) => {
    const value = minValue + ((maxValue - minValue) * index) / tickCount;
    return {
      value,
      y: y(value)
    };
  });
  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-4">
      <div className="min-w-0 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          {ticks.map((tick, index) => (
            <g key={`tick-${index}`}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="4 6"
              />
              <text
                x={paddingX - 10}
                y={tick.y + 4}
                textAnchor="end"
                fill="rgba(255,255,255,0.65)"
                fontSize={12}
              >
                {tick.value.toFixed(1)}
              </text>
            </g>
          ))}

          <polyline fill="none" stroke="#F7CC2F" strokeWidth={3} points={polyline} />

          {points.map((item, index) => (
            <g key={`${item.date}-${index}`}>
              <circle cx={x(index)} cy={y(item.value)} r={4.5} fill="#F7CC2F" />
              {index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  x={x(index)}
                  y={height - 10}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.7)"
                  fontSize={11}
                >
                  {formatMetricDate(item.date)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function formatPlanSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Tamaño desconocido";
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = sizeBytes / 1024;
  return `${kb.toFixed(0)} KB`;
}

function formatPlanDate(date: string | null): string {
  if (!date) return "Sin fecha";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES");
}

function getPlanModifiedTimestamp(plan: NutritionPlan): number | null {
  const modified = plan.modifiedTime ? Date.parse(plan.modifiedTime) : Number.NaN;
  const created = plan.createdTime ? Date.parse(plan.createdTime) : Number.NaN;

  const hasModified = !Number.isNaN(modified);
  const hasCreated = !Number.isNaN(created);
  if (!hasModified && !hasCreated) return null;
  if (!hasModified) return created;
  if (!hasCreated) return modified;
  return Math.max(modified, created);
}

function getPlanDisplayDate(plan: NutritionPlan): string {
  const ts = getPlanModifiedTimestamp(plan);
  if (ts === null) return "Sin fecha";
  return formatPlanDate(new Date(ts).toISOString());
}

export function DashboardShell({ user }: DashboardShellProps) {
  const router = useRouter();
  const [entries, setEntries] = useState<RevisionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plans, setPlans] = useState<NutritionPlan[]>([]);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState("");
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<NutritionPlan | null>(null);
  const [newPlanPopup, setNewPlanPopup] = useState<NewPlanPopupState | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("CINTURA");
  const dashboardCacheKey = useMemo(
    () =>
      `mat:dashboard-cache:v${DASHBOARD_CACHE_VERSION}:${user.username.trim().toLowerCase()}`,
    [user.username]
  );

  const groupedEntries = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (date && entry.fecha !== date) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        entry.pregunta.toLowerCase().includes(q) || entry.respuesta.toLowerCase().includes(q)
      );
    });

    const map = new Map<string, RevisionEntry[]>();
    for (const entry of filtered) {
      const list = map.get(entry.fecha) ?? [];
      list.push(entry);
      map.set(entry.fecha, list);
    }

    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [entries, query, date]);

  const metricSeriesByKey = useMemo(() => {
    const initial: Record<MetricKey, MetricPoint[]> = {
      CINTURA: [],
      CADERA: [],
      BRAZO_RELAJADO: [],
      BRAZO_FLEXIONADO: [],
      MUSLO: []
    };

    for (const entry of entries) {
      const metricKey = metricKeyFromQuestion(entry.pregunta);
      if (!metricKey) continue;
      const value = parseMetricValue(entry.respuesta);
      if (value === null) continue;
      initial[metricKey].push({ date: entry.fecha, value });
    }

    for (const key of Object.keys(initial) as MetricKey[]) {
      initial[key].sort((a, b) => a.date.localeCompare(b.date));
    }

    return initial;
  }, [entries]);

  const availableMetricOptions = useMemo(
    () => METRIC_OPTIONS.filter((option) => metricSeriesByKey[option.key].length > 0),
    [metricSeriesByKey]
  );

  const selectedMetricSeries = metricSeriesByKey[selectedMetric];

  useEffect(() => {
    router.prefetch("/tools");
    router.prefetch("/revision/new");
  }, [router]);

  useEffect(() => {
    let active = true;

    try {
      const cachedRaw = window.localStorage.getItem(dashboardCacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as DashboardClientCache;
        const isFresh =
          typeof cached?.timestamp === "number" &&
          Date.now() - cached.timestamp <= DASHBOARD_CACHE_TTL_MS;

        if (isFresh) {
          const cachedRevisions = Array.isArray(cached.revisions) ? cached.revisions : [];
          const cachedPlans = Array.isArray(cached.plans) ? cached.plans : [];
          setEntries(cachedRevisions);
          setPlans(cachedPlans);
          if (cachedRevisions.length) {
            setOpenDate(cachedRevisions[0].fecha);
          }
          setLoading(false);
          setPlansLoading(false);
        }
      }
    } catch {
      // ignore malformed local cache
    }

    async function load() {
      try {
        const [revisionsRes, plansRes] = await Promise.all([
          fetch("/api/revisions"),
          fetch("/api/nutrition-plans")
        ]);

        if (revisionsRes.status === 401 || plansRes.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!revisionsRes.ok) throw new Error("No se pudo cargar el historial.");
        if (!plansRes.ok) throw new Error("No se pudieron cargar los planes nutricionales.");

        const revisionsJson = (await revisionsRes.json()) as { revisions: RevisionEntry[] };
        const plansJson = (await plansRes.json()) as { plans: NutritionPlan[] };
        const nextEntries = revisionsJson.revisions ?? [];
        const nextPlans = plansJson.plans ?? [];

        if (!active) return;
        setEntries(nextEntries);
        setPlans(nextPlans);
        if (nextEntries.length) {
          setOpenDate(nextEntries[0].fecha);
        }

        try {
          const payload: DashboardClientCache = {
            timestamp: Date.now(),
            revisions: nextEntries,
            plans: nextPlans
          };
          window.localStorage.setItem(dashboardCacheKey, JSON.stringify(payload));
        } catch {
          // ignore local storage errors
        }
      } catch (error) {
        console.error(error);
        toast.error("Error al cargar el historial.");
      } finally {
        if (active) {
          setLoading(false);
          setPlansLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [dashboardCacheKey, router]);

  useEffect(() => {
    if (!availableMetricOptions.length) return;
    const selectedAvailable = availableMetricOptions.some((option) => option.key === selectedMetric);
    if (!selectedAvailable) {
      setSelectedMetric(availableMetricOptions[0].key);
    }
  }, [availableMetricOptions, selectedMetric]);

  useEffect(() => {
    if (plansLoading || !plans.length) return;

    const now = Date.now();
    const recentPlans = plans
      .flatMap((plan) => {
        const ts = getPlanModifiedTimestamp(plan);
        if (ts === null) return [];
        return [{ plan, ts }];
      })
      .filter((entry) => entry.ts <= now && now - entry.ts <= NEW_PLAN_WINDOW_MS)
      .sort((a, b) => b.ts - a.ts);

    if (!recentPlans.length) return;

    const latestEntry = recentPlans[0];

    const storageKey = `mat:last-seen-plan:${user.username.trim().toLowerCase()}`;
    const seenRaw = window.localStorage.getItem(storageKey);
    const seenTimestamp = seenRaw ? Date.parse(seenRaw) : Number.NaN;
    const shouldShow = Number.isNaN(seenTimestamp) || seenTimestamp < latestEntry.ts;

    if (!shouldShow) return;

    setNewPlanPopup({
      latestPlan: latestEntry.plan,
      latestSeenTimestamp: latestEntry.ts,
      recentCount: recentPlans.length
    });
  }, [plansLoading, plans, user.username]);

  function dismissNewPlanPopup() {
    if (!newPlanPopup) return;
    const storageKey = `mat:last-seen-plan:${user.username.trim().toLowerCase()}`;
    window.localStorage.setItem(storageKey, new Date(newPlanPopup.latestSeenTimestamp).toISOString());
    setNewPlanPopup(null);
  }

  function openLatestNewPlan() {
    if (!newPlanPopup) return;
    setSelectedPlan(newPlanPopup.latestPlan);
    const storageKey = `mat:last-seen-plan:${user.username.trim().toLowerCase()}`;
    window.localStorage.setItem(storageKey, new Date(newPlanPopup.latestSeenTimestamp).toISOString());
    setNewPlanPopup(null);
  }

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesión.");
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
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Link href="/dashboard">
                  <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                    Dashboard
                  </BrandButton>
                </Link>
                <Link href="/tools">
                  <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                    Herramientas
                  </BrandButton>
                </Link>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Hola</p>
                <p className="font-semibold text-brand-text">{user.name}</p>
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
          <p className="text-xs uppercase tracking-[0.25em] text-brand-muted">Seguimiento</p>
          <h1 className="mt-2 text-3xl font-bold text-brand-text">Control semanal de revisión</h1>
          <p className="mt-3 max-w-2xl text-sm text-brand-muted">
            Registra respuestas, sube fotos opcionales y consulta la evolución completa con filtros
            y búsqueda.
          </p>
          <div className="mt-6">
            <Link href="/revision/new">
              <BrandButton>Nueva revisión</BrandButton>
            </Link>
          </div>
        </motion.section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                  Planes nutricionales
                </p>
                <h2 className="mt-1 text-lg font-semibold text-brand-text">PDFs de planificación</h2>
              </div>
            </div>

            {plansLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-white/10 bg-black/25 p-3"
                  >
                    <Skeleton className="h-36 w-full rounded-lg" />
                    <Skeleton className="mt-3 h-4 w-4/5" />
                    <Skeleton className="mt-2 h-3 w-2/5" />
                  </div>
                ))}
              </div>
            ) : plans.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/25 p-6 text-sm text-brand-muted">
                Aún no hay PDFs en tu carpeta de planes nutricionales.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                  <article
                    key={plan.id}
                    className="overflow-hidden rounded-xl border border-white/10 bg-black/25"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPlan(plan)}
                      className="block w-full"
                    >
                      <img
                        src={`/api/nutrition-plans/${plan.id}/thumbnail`}
                        alt={plan.name}
                        className="h-32 w-full object-cover"
                      />
                    </button>
                    <div className="space-y-2 p-3">
                      <p className="min-h-10 text-sm font-medium text-brand-text">{plan.name}</p>
                      <p className="text-xs text-brand-muted">
                        {getPlanDisplayDate(plan)} · {formatPlanSize(plan.sizeBytes)}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedPlan(plan)}
                          className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/40 px-3 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </button>
                        <a
                          href={`/api/nutrition-plans/${plan.id}?download=1`}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-brand-text transition hover:bg-white/10"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Descargar
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Evolución</p>
                <h2 className="mt-1 text-lg font-semibold text-brand-text">Análisis de métricas (cm)</h2>
              </div>
              <label className="w-full max-w-sm text-sm text-brand-muted">
                Métrica
                <select
                  value={selectedMetric}
                  onChange={(event) => setSelectedMetric(event.target.value as MetricKey)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                >
                  {METRIC_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <EvolutionChart points={selectedMetricSeries} />
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <label className="relative min-w-0 w-full">
                <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por pregunta o respuesta"
                  className="min-w-0 w-full max-w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                />
              </label>
              <label className="relative min-w-0 w-full">
                <Calendar className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-muted" />
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="date-input-responsive block min-w-0 w-full max-w-full [min-inline-size:0] rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                />
              </label>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="mt-3 h-4 w-full" />
                  <Skeleton className="mt-2 h-4 w-4/5" />
                </div>
              ))}
            </div>
          ) : groupedEntries.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center text-brand-muted">
              No hay revisiones para los filtros actuales.
            </div>
          ) : (
            <div className="space-y-3">
              {groupedEntries.map(([fecha, items], index) => {
                const isOpen = openDate === fecha;
                const textItems = items.filter((item) => !item.imageUrl);
                const imageItems = items.filter((item) => item.imageUrl);
                return (
                  <motion.article
                    key={fecha}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="overflow-hidden rounded-2xl border border-white/10 bg-brand-surface/75 transition hover:border-brand-accent/40 hover:shadow-glow"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenDate(isOpen ? null : fecha)}
                      className="flex w-full items-center justify-between px-5 py-4 text-left"
                    >
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Fecha</p>
                        <h2 className="text-lg font-semibold text-brand-text">{fecha}</h2>
                      </div>
                      <p className="text-sm text-brand-muted">{items.length} registros</p>
                    </button>

                    <AnimatePresence initial={false}>
                      {isOpen ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25 }}
                          className="border-t border-white/10"
                        >
                          <div className="space-y-3 p-4">
                            {textItems.map((item, itemIndex) => (
                              <div
                                key={`${fecha}-${itemIndex}`}
                                className="rounded-xl border border-white/10 bg-black/25 p-4"
                              >
                                <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                                  {item.pregunta}
                                </p>
                                <p className="mt-2 whitespace-pre-wrap text-sm text-brand-text">
                                  {item.respuesta}
                                </p>
                              </div>
                            ))}

                            {imageItems.length ? (
                              <div className="rounded-xl border border-white/10 bg-black/25 p-4">
                                <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                                  Galeria de fotos
                                </p>
                                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                                  {imageItems.map((item, itemIndex) => (
                                    <button
                                      key={`${fecha}-img-${itemIndex}`}
                                      type="button"
                                      onClick={() => setLightboxImage(item.imageUrl)}
                                      className="overflow-hidden rounded-lg border border-white/15"
                                    >
                                      <img
                                        src={item.imageUrl ?? ""}
                                        alt={item.pregunta}
                                        className="h-28 w-full object-cover transition duration-300 hover:scale-[1.05]"
                                      />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {newPlanPopup ? (
          <motion.aside
            initial={{ opacity: 0, y: 26, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="fixed bottom-5 right-5 z-40 w-[min(92vw,380px)] rounded-2xl border border-brand-accent/40 bg-brand-surface/95 p-4 shadow-glow backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <BellRing className="mt-0.5 h-5 w-5 text-brand-accent" />
                <div>
                  <p className="text-sm font-semibold text-brand-text">
                    Nuevo plan nutricional disponible
                  </p>
                  <p className="mt-1 text-xs text-brand-muted">
                    Se detecto{" "}
                    <span className="font-semibold text-brand-text">{newPlanPopup.recentCount}</span>{" "}
                    documento
                    {newPlanPopup.recentCount > 1 ? "s" : ""} nuevo
                    {newPlanPopup.recentCount > 1 ? "s" : ""} en las ultimas 24h.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismissNewPlanPopup}
                className="rounded-md border border-white/15 p-1 text-brand-muted transition hover:bg-white/10 hover:text-brand-text"
                aria-label="Cerrar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={openLatestNewPlan}
                className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/45 bg-brand-accent/10 px-3 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand-accent/20"
              >
                <Eye className="h-3.5 w-3.5" />
                Ver ahora
              </button>
              <button
                type="button"
                onClick={dismissNewPlanPopup}
                className="inline-flex items-center rounded-lg border border-white/20 px-3 py-1.5 text-xs text-brand-text transition hover:bg-white/10"
              >
                Mas tarde
              </button>
            </div>
          </motion.aside>
        ) : null}

        {selectedPlan ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedPlan(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, opacity: 0 }}
              transition={{ type: "spring", stiffness: 210, damping: 24 }}
              className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-brand-accent/35 bg-[#0f0f11] sm:h-[86vh]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-brand-text">
                  <FileText className="h-4 w-4 text-brand-accent" />
                  <span className="truncate">{selectedPlan.name}</span>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                  <a
                    href={`/api/nutrition-plans/${selectedPlan.id}?download=1`}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-brand-text transition hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Descargar
                  </a>
                  <button
                    type="button"
                    onClick={() => setSelectedPlan(null)}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-brand-text transition hover:bg-white/10"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <iframe
                title={selectedPlan.name}
                src={`/api/nutrition-plans/${selectedPlan.id}`}
                className="h-full w-full bg-white"
              />
            </motion.div>
          </motion.div>
        ) : null}

        {lightboxImage ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightboxImage(null)}
          >
            <motion.img
              src={lightboxImage}
              alt="Revision"
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", stiffness: 220, damping: 24 }}
              className="max-h-[88vh] w-auto max-w-5xl rounded-xl border border-brand-accent/35"
              onClick={(event) => event.stopPropagation()}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </MotionPage>
  );
}
