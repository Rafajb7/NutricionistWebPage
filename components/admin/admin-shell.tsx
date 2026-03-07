"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Calendar, ChevronDown, ChevronUp, Download, Eye, Flame, LogOut, Search, Shield, Trophy, Upload, Users } from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import { getActiveCompetitionMode } from "@/lib/competition-mode";

type SessionUser = { username: string; name: string };
type AdminShellProps = { user: SessionUser };

type AdminUserItem = { username: string; name: string; permission: "user" | "admin" };

type RevisionEntry = {
  nombre: string;
  fecha: string;
  usuario: string;
  pregunta: string;
  respuesta: string;
  imageUrl: string | null;
};

type RoutineLog = {
  timestamp: string;
  nombre: string;
  usuario: string;
  fechaSesion: string;
  dia: string;
  grupoMuscular: string;
  ejercicio: string;
  series: number;
  repeticiones: number;
  pesoKg: number | null;
  erp: number;
  nivelFatiga: "alto" | "medio" | "bajo";
  molestiasGastrointestinales: "alto" | "medio" | "bajo";
  intraentreno: boolean;
  notas: string;
};

type CompetitionEvent = {
  id: string;
  title: string;
  date: string;
  location: string;
  description: string;
  createdAt: string;
};

type AchievementMark = { id: string; timestamp: string; exercise: string; date: string; weightKg: number };
type AchievementGoal = { id: string; timestamp: string; exercise: string; targetDate: string; targetWeightKg: number };

type NutritionPlan = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};

type PeakModeDailyLog = {
  timestamp: string;
  fecha: string;
  nombre: string;
  usuario: string;
  modo: "titan" | "diablo";
  pesoAyunasKg: number;
  pesoNocturnoKg: number;
  pasosDiarios: number;
  aguaLitros: number;
  frutaPiezas: number;
  verduraRaciones: number;
  cerealesIntegralesRaciones: number;
  hambreEscala: number;
  descansoEscala: number;
  horasSueno: number;
  estresEscala: number;
  molestiasDigestivasEscala: number;
  cumplimientoPlanEscala: number;
  tuvoEntreno: boolean;
  dobleSesion: boolean;
};

type AdminUserData = {
  user: AdminUserItem;
  dashboard: { revisions: RevisionEntry[] };
  tools: {
    routines: RoutineLog[];
    competitions: CompetitionEvent[];
    peakModeLogs: PeakModeDailyLog[];
    nutritionPlans: NutritionPlan[];
    achievements: { marks: AchievementMark[]; goals: AchievementGoal[] };
  };
};

type MetricKey =
  | "CINTURA"
  | "CADERA"
  | "BRAZO_RELAJADO"
  | "BRAZO_FLEXIONADO"
  | "MUSLO"
  | "PESO_MEDIO";
type MetricPoint = { date: string; value: number };

type PeakMetricKey =
  | "pesoAyunasKg"
  | "pesoNocturnoKg"
  | "pasosDiarios"
  | "aguaLitros"
  | "frutaPiezas"
  | "verduraRaciones"
  | "cerealesIntegralesRaciones"
  | "hambreEscala"
  | "descansoEscala"
  | "horasSueno"
  | "estresEscala"
  | "molestiasDigestivasEscala"
  | "cumplimientoPlanEscala"
  | "tuvoEntreno"
  | "dobleSesion";

const METRIC_OPTIONS: Array<{ key: MetricKey; label: string }> = [
  { key: "CINTURA", label: "Cintura" },
  { key: "CADERA", label: "Cadera" },
  { key: "BRAZO_RELAJADO", label: "Brazo relajado" },
  { key: "BRAZO_FLEXIONADO", label: "Brazo flexionado" },
  { key: "MUSLO", label: "Muslo" },
  { key: "PESO_MEDIO", label: "Peso medio" }
];

const PEAK_METRIC_OPTIONS: Array<{
  key: PeakMetricKey;
  label: string;
  unit: string;
  type: "number" | "boolean";
}> = [
  { key: "pesoAyunasKg", label: "Peso en ayunas", unit: "kg", type: "number" },
  { key: "pesoNocturnoKg", label: "Peso nocturno", unit: "kg", type: "number" },
  { key: "pasosDiarios", label: "Pasos diarios", unit: "pasos", type: "number" },
  { key: "aguaLitros", label: "Ingesta de agua", unit: "L", type: "number" },
  { key: "frutaPiezas", label: "Piezas de fruta", unit: "raciones", type: "number" },
  { key: "verduraRaciones", label: "Raciones de verdura", unit: "raciones", type: "number" },
  {
    key: "cerealesIntegralesRaciones",
    label: "Raciones de cereales integrales",
    unit: "raciones",
    type: "number"
  },
  { key: "hambreEscala", label: "Escala de hambre", unit: "pts", type: "number" },
  { key: "descansoEscala", label: "Escala de descanso", unit: "pts", type: "number" },
  { key: "horasSueno", label: "Horas de sueno", unit: "h", type: "number" },
  { key: "estresEscala", label: "Escala de estres", unit: "pts", type: "number" },
  {
    key: "molestiasDigestivasEscala",
    label: "Molestias digestivas",
    unit: "pts",
    type: "number"
  },
  {
    key: "cumplimientoPlanEscala",
    label: "Cumplimiento del plan",
    unit: "pts",
    type: "number"
  },
  { key: "tuvoEntreno", label: "Tuvo entreno", unit: "0-1", type: "boolean" },
  { key: "dobleSesion", label: "Doble sesion", unit: "0-1", type: "boolean" }
];

const METRIC_QUESTION_KEY: Record<string, MetricKey> = {
  CINTURA: "CINTURA",
  CINTURACM: "CINTURA",
  CADERA: "CADERA",
  CADERACM: "CADERA",
  BRAZORELAJADO: "BRAZO_RELAJADO",
  BRAZORELAJADOCM: "BRAZO_RELAJADO",
  BRAZOFLEXIONADO: "BRAZO_FLEXIONADO",
  BRAZOFLEXIONADOCM: "BRAZO_FLEXIONADO",
  MUSLO: "MUSLO",
  MUSLOCM: "MUSLO",
  PESOMEDIOSEMANALKG: "PESO_MEDIO",
  PESOMEDIOKG: "PESO_MEDIO",
  PESOMEDIO: "PESO_MEDIO"
};

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateTimeLabel(dateTime: string): string {
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) return dateTime;
  return parsed.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMetricDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
}

function normalizeMetricQuestion(question: string): string {
  return question.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function metricKeyFromQuestion(question: string): MetricKey | null {
  const normalized = normalizeMetricQuestion(question);
  const direct = METRIC_QUESTION_KEY[normalized];
  if (direct) return direct;
  const base = normalized.replace(/CM$/, "");
  if (base.includes("BRAZO") && base.includes("RELAJADO")) return "BRAZO_RELAJADO";
  if (base.includes("BRAZO") && base.includes("FLEXIONADO")) return "BRAZO_FLEXIONADO";
  if (base.includes("CINTURA")) return "CINTURA";
  if (base.includes("CADERA")) return "CADERA";
  if (base.includes("MUSLO")) return "MUSLO";
  if (base.includes("PESO") && (base.includes("MEDIO") || base.includes("PROMEDIO"))) {
    return "PESO_MEDIO";
  }
  return null;
}

function parseMetricValue(raw: string): number | null {
  const match = raw.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function formatPlanSize(sizeBytes: number | null): string {
  if (!sizeBytes || sizeBytes <= 0) return "Tamano desconocido";
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(sizeBytes / 1024)} KB`;
}

function getPlanDisplayDate(plan: NutritionPlan): string {
  const ts = Date.parse(plan.modifiedTime ?? plan.createdTime ?? "");
  if (!Number.isFinite(ts)) return "Sin fecha";
  return new Date(ts).toLocaleDateString("es-ES");
}

function getPeakMetricNumericValue(log: PeakModeDailyLog, key: PeakMetricKey): number {
  if (key === "tuvoEntreno") return log.tuvoEntreno ? 1 : 0;
  if (key === "dobleSesion") return log.dobleSesion ? 1 : 0;
  return Number(log[key] ?? 0);
}

function formatPeakModeLabel(mode: "titan" | "diablo"): string {
  return mode === "diablo" ? "Modo diablo" : "Modo titan";
}

function formatPeakModeBadgeClass(mode: "titan" | "diablo"): string {
  return mode === "diablo"
    ? "rounded-md border border-red-300/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-red-200"
    : "rounded-md border border-violet-300/35 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200";
}

function formatPeakModeDailyValue(
  log: PeakModeDailyLog,
  option: (typeof PEAK_METRIC_OPTIONS)[number]
): string {
  if (option.key === "tuvoEntreno") return log.tuvoEntreno ? "Si" : "No";
  if (option.key === "dobleSesion") return log.dobleSesion ? "Si" : "No";
  return `${getPeakMetricNumericValue(log, option.key)} ${option.unit}`;
}

function EvolutionChart({ points, unit }: { points: MetricPoint[]; unit: "cm" | "kg" }) {
  if (!points.length) {
    return <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-brand-muted">No hay datos para esta metrica.</div>;
  }

  const width = 840;
  const height = 280;
  const px = 56;
  const py = 36;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const range = Math.max(max - min, 1);
  const x = (i: number) => px + (i * (width - px * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => height - py - ((v - min) * (height - py * 2)) / range;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const yTicks = Array.from({ length: 5 }).map((_, index) => {
    const value = min + ((max - min) * index) / 4;
    return { value, y: y(value) };
  });
  const xLabelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="min-w-0 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          {yTicks.map((tick, index) => (
            <g key={`tick-${index}`}>
              <line
                x1={px}
                x2={width - px}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="4 6"
              />
              <text
                x={px - 10}
                y={tick.y + 4}
                textAnchor="end"
                fill="rgba(255,255,255,0.65)"
                fontSize={11}
              >
                {tick.value.toFixed(1)} {unit}
              </text>
            </g>
          ))}
          <polyline fill="none" stroke="#F7CC2F" strokeWidth={3} points={line} />
          {points.map((p, i) => (
            <g key={`${p.date}-${i}`}>
              <circle cx={x(i)} cy={y(p.value)} r={4} fill="#F7CC2F" />
              {i % xLabelStep === 0 || i === points.length - 1 ? (
                <text
                  x={x(i)}
                  y={height - 10}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.7)"
                  fontSize={11}
                >
                  {formatMetricDate(p.date)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function PeakModeChart(props: { points: MetricPoint[]; unit: string }) {
  const { points, unit } = props;

  if (!points.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-brand-muted">
        No hay datos para este campo.
      </div>
    );
  }

  const width = 840;
  const height = 280;
  const px = 56;
  const py = 36;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const range = Math.max(max - min, 1);
  const x = (i: number) => px + (i * (width - px * 2)) / Math.max(points.length - 1, 1);
  const y = (v: number) => height - py - ((v - min) * (height - py * 2)) / range;
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const yTicks = Array.from({ length: 5 }).map((_, index) => {
    const value = min + ((max - min) * index) / 4;
    return { value, y: y(value) };
  });
  const xLabelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="min-w-0 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          {yTicks.map((tick, index) => (
            <g key={`peak-tick-${index}`}>
              <line
                x1={px}
                x2={width - px}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="4 6"
              />
              <text
                x={px - 10}
                y={tick.y + 4}
                textAnchor="end"
                fill="rgba(255,255,255,0.65)"
                fontSize={11}
              >
                {tick.value.toFixed(1)} {unit}
              </text>
            </g>
          ))}
          <polyline fill="none" stroke="#A855F7" strokeWidth={3} points={line} />
          {points.map((p, i) => (
            <g key={`peak-${p.date}-${i}`}>
              <circle cx={x(i)} cy={y(p.value)} r={4} fill="#A855F7" />
              {i % xLabelStep === 0 || i === points.length - 1 ? (
                <text
                  x={x(i)}
                  y={height - 10}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.7)"
                  fontSize={11}
                >
                  {formatMetricDate(p.date)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export function AdminShell({ user }: AdminShellProps) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedUsername, setSelectedUsername] = useState("");
  const [selectedData, setSelectedData] = useState<AdminUserData | null>(null);
  const [openRevisionDates, setOpenRevisionDates] = useState<string[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("CINTURA");
  const [selectedPeakMetric, setSelectedPeakMetric] = useState<PeakMetricKey>("pesoAyunasKg");
  const [uploadingPlans, setUploadingPlans] = useState(false);
  const [planFiles, setPlanFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  }, [users, filter]);

  const groupedRevisions = useMemo(() => {
    const map = new Map<string, RevisionEntry[]>();
    for (const item of selectedData?.dashboard.revisions ?? []) {
      const list = map.get(item.fecha) ?? [];
      list.push(item);
      map.set(item.fecha, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [selectedData]);

  const metricSeriesByKey = useMemo(() => {
    const out: Record<MetricKey, MetricPoint[]> = {
      CINTURA: [],
      CADERA: [],
      BRAZO_RELAJADO: [],
      BRAZO_FLEXIONADO: [],
      MUSLO: [],
      PESO_MEDIO: []
    };
    for (const entry of selectedData?.dashboard.revisions ?? []) {
      const key = metricKeyFromQuestion(entry.pregunta);
      if (!key) continue;
      const value = parseMetricValue(entry.respuesta);
      if (value === null) continue;
      out[key].push({ date: entry.fecha, value });
    }
    for (const key of Object.keys(out) as MetricKey[]) {
      const byDate = new Map<string, number>();
      out[key].sort((a, b) => a.date.localeCompare(b.date)).forEach((p) => byDate.set(p.date, p.value));
      out[key] = Array.from(byDate.entries()).map(([date, value]) => ({ date, value }));
    }
    return out;
  }, [selectedData]);

  const availableMetricOptions = useMemo(
    () => METRIC_OPTIONS.filter((opt) => metricSeriesByKey[opt.key].length > 0),
    [metricSeriesByKey]
  );
  const selectedMetricUnit: "cm" | "kg" =
    selectedMetric === "PESO_MEDIO" ? "kg" : "cm";

  const peakModeLogs = useMemo(
    () =>
      [...(selectedData?.tools.peakModeLogs ?? [])].sort((a, b) => {
        const byDate = a.fecha.localeCompare(b.fecha);
        if (byDate !== 0) return byDate;
        return a.timestamp.localeCompare(b.timestamp);
      }),
    [selectedData]
  );

  const selectedPeakMetricOption = useMemo(
    () =>
      PEAK_METRIC_OPTIONS.find((option) => option.key === selectedPeakMetric) ??
      PEAK_METRIC_OPTIONS[0],
    [selectedPeakMetric]
  );

  const peakMetricSeries = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const log of peakModeLogs) {
      byDate.set(log.fecha, getPeakMetricNumericValue(log, selectedPeakMetric));
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, value]) => ({ date, value }));
  }, [peakModeLogs, selectedPeakMetric]);

  const loadSelectedUserData = useCallback(async (username: string) => {
    if (!username) { setSelectedData(null); return; }
    setDataLoading(true);
    try {
      const res = await fetch(`/api/admin/user-data?username=${encodeURIComponent(username)}`);
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 403) { toast.error("No tienes permisos de administrador."); window.location.href = "/dashboard"; return; }
      const json = (await res.json()) as AdminUserData & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar la informacion del usuario.");
      setSelectedData(json);
    } catch (error) {
      console.error(error);
      toast.error("Error cargando datos del usuario.");
      setSelectedData(null);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => { router.prefetch("/login"); }, [router]);

  useEffect(() => {
    let active = true;
    async function loadUsers() {
      try {
        const res = await fetch("/api/admin/users");
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (res.status === 403) { toast.error("No tienes permisos de administrador."); window.location.href = "/dashboard"; return; }
        const json = (await res.json()) as { users?: AdminUserItem[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "No se pudo cargar usuarios.");
        if (!active) return;
        const next = (json.users ?? []).sort((a, b) => a.username.localeCompare(b.username, "es"));
        setUsers(next);
        setSelectedUsername((current) => current || next[0]?.username || "");
      } catch (error) {
        console.error(error);
        toast.error("Error cargando usuarios.");
      } finally {
        if (active) setUsersLoading(false);
      }
    }
    loadUsers();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!filteredUsers.length) return;
    if (!filteredUsers.some((u) => u.username === selectedUsername)) {
      setSelectedUsername(filteredUsers[0].username);
    }
  }, [filteredUsers, selectedUsername]);

  useEffect(() => {
    if (!availableMetricOptions.length) return;
    if (!availableMetricOptions.some((o) => o.key === selectedMetric)) {
      setSelectedMetric(availableMetricOptions[0].key);
    }
  }, [availableMetricOptions, selectedMetric]);

  useEffect(() => {
    setOpenRevisionDates([]);
    loadSelectedUserData(selectedUsername);
  }, [selectedUsername, loadSelectedUserData]);

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  async function handleUploadPlans() {
    if (!selectedUsername) { toast.error("Selecciona un usuario."); return; }
    if (!planFiles.length) { toast.error("Selecciona al menos un PDF."); return; }

    setUploadingPlans(true);
    try {
      const form = new FormData();
      form.append("username", selectedUsername);
      planFiles.forEach((file) => form.append("plans", file));

      const res = await fetch("/api/admin/nutrition-plans/upload", { method: "POST", body: form });
      if (res.status === 401) { window.location.href = "/login"; return; }

      const json = (await res.json()) as { error?: string; uploaded?: NutritionPlan[] };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudieron subir los planes.");
        return;
      }

      toast.success(`Planes subidos: ${json.uploaded?.length ?? planFiles.length}.`);
      setPlanFiles([]);
      setFileInputKey((value) => value + 1);
      await loadSelectedUserData(selectedUsername);
    } catch (error) {
      console.error(error);
      toast.error("Error subiendo planes nutricionales.");
    } finally {
      setUploadingPlans(false);
    }
  }

  const summary = {
    revisions: groupedRevisions.length,
    routines: selectedData?.tools.routines.length ?? 0,
    competitions: selectedData?.tools.competitions.length ?? 0,
    peakModeLogs: selectedData?.tools.peakModeLogs.length ?? 0,
    plans: selectedData?.tools.nutritionPlans.length ?? 0,
    marks: selectedData?.tools.achievements.marks.length ?? 0,
    goals: selectedData?.tools.achievements.goals.length ?? 0
  };

  const selectedUserCompetitionMode = useMemo(
    () => getActiveCompetitionMode(selectedData?.tools.competitions ?? []),
    [selectedData]
  );

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
        {selectedUserCompetitionMode ? (
          <div
            className={
              selectedUserCompetitionMode.mode === "diablo"
                ? "fixed left-1/2 top-16 z-40 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-red-300/40 bg-red-800/90 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur"
                : "fixed left-1/2 top-16 z-40 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-violet-300/40 bg-violet-800/90 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur"
            }
          >
            <span className="inline-flex items-center justify-center gap-2">
              {selectedUserCompetitionMode.mode === "diablo" ? (
                <Flame className="h-4 w-4" />
              ) : (
                <Shield className="h-4 w-4" />
              )}
              {selectedUserCompetitionMode.mode === "diablo"
                ? "El modo diablo de este usuario esta activado"
                : "El modo titan de este usuario esta activado"}
            </span>
          </div>
        ) : null}

        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Link href="/dashboard"><BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">Panel admin</BrandButton></Link>
                <Link href="/tools"><BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">Herramientas admin</BrandButton></Link>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Administrador</p>
                <p className="font-semibold text-brand-text">{user.name}</p>
              </div>
              <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto" onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Vista global</p>
              <h1 className="mt-1 text-2xl font-bold text-brand-text">Seguimiento por usuario</h1>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl border border-brand-accent/35 bg-brand-accent/10 px-3 py-2 text-xs text-brand-text"><Shield className="h-4 w-4" />Modo administrador</div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 w-full text-sm text-brand-muted">
              <p>Filtrar</p>
              <label className="relative mt-2 block min-w-0 w-full">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar por usuario o nombre" className="min-w-0 w-full rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60" />
              </label>
            </div>
            <div className="min-w-0 w-full text-sm text-brand-muted">
              <p>Usuario</p>
              <select value={selectedUsername} onChange={(event) => setSelectedUsername(event.target.value)} className="mt-2 min-w-0 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60">
                {usersLoading ? <option>Cargando...</option> : null}
                {!usersLoading && filteredUsers.length === 0 ? <option value="">Sin resultados</option> : null}
                {!usersLoading ? filteredUsers.map((item) => <option key={item.username} value={item.username}>{`${item.name} (${item.username}) - ${item.permission}`}</option>) : null}
              </select>
            </div>
          </div>
        </motion.section>

        {dataLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4"><Skeleton className="h-5 w-48" /><Skeleton className="mt-3 h-4 w-full" /></div>)}</div>
        ) : selectedData ? (
          <section className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Revisiones (dias)</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.revisions}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Rutinas</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.routines}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Competiciones</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.competitions}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Registros pico</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.peakModeLogs}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Planes PDF</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.plans}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Marcas maximas</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.marks}</p></article>
              <article className="rounded-xl border border-white/10 bg-brand-surface/70 p-4"><p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Objetivos</p><p className="mt-2 text-2xl font-semibold text-brand-text">{summary.goals}</p></article>
            </div>

            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Usuario seleccionado</p><h2 className="mt-1 text-lg font-semibold text-brand-text">{selectedData.user.name} ({selectedData.user.username})</h2></div>
                <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-brand-muted"><Users className="h-3.5 w-3.5" />Permiso: {selectedData.user.permission}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold text-brand-text">Dashboard: revisiones</h3>
                <div className="flex gap-2">
                  <BrandButton variant="ghost" onClick={() => setOpenRevisionDates([])}>Minimizar todo</BrandButton>
                  <BrandButton variant="ghost" onClick={() => setOpenRevisionDates(groupedRevisions.map(([d]) => d))}>Expandir todo</BrandButton>
                </div>
              </div>
              {groupedRevisions.length === 0 ? <p className="mt-3 text-sm text-brand-muted">No hay revisiones registradas.</p> : (
                <div className="mt-4 space-y-3">
                  {groupedRevisions.map(([date, items]) => {
                    const textItems = items.filter((item) => !item.imageUrl);
                    const imageItems = items.filter((item) => item.imageUrl);
                    const isOpen = openRevisionDates.includes(date);
                    return (
                      <article key={date} className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
                        <button type="button" onClick={() => setOpenRevisionDates((prev) => prev.includes(date) ? prev.filter((d) => d !== date) : [...prev, date])} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                          <div><p className="text-sm font-semibold text-brand-text">{formatDateLabel(date)}</p><p className="text-xs text-brand-muted">{textItems.length} respuestas · {imageItems.length} fotos</p></div>
                          {isOpen ? <ChevronUp className="h-4 w-4 text-brand-muted" /> : <ChevronDown className="h-4 w-4 text-brand-muted" />}
                        </button>
                        {isOpen ? (
                          <div className="space-y-3 border-t border-white/10 p-4">
                            {textItems.map((item, index) => (
                              <div key={`${date}-text-${index}`} className="rounded-lg border border-white/10 p-3">
                                <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">{item.pregunta}</p>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-brand-text">{item.respuesta}</p>
                              </div>
                            ))}
                            {imageItems.length ? (
                              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                                {imageItems.map((item, index) => (
                                  <a key={`${date}-img-${index}`} href={item.imageUrl ?? "#"} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-white/15">
                                    <img src={item.imageUrl ?? ""} alt={item.pregunta} className="h-24 w-full object-cover" />
                                  </a>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <h3 className="text-lg font-semibold text-brand-text">Dashboard: metricas corporales</h3>
                <label className="w-full max-w-sm text-sm text-brand-muted">Metrica
                  <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value as MetricKey)} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60">
                    {(availableMetricOptions.length ? availableMetricOptions : METRIC_OPTIONS).map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-4"><EvolutionChart points={metricSeriesByKey[selectedMetric]} unit={selectedMetricUnit} /></div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-brand-text">
                    Seguimiento diario: modo titan y diablo
                  </h3>
                  <p className="mt-1 text-xs text-brand-muted">
                    Evolucion diaria del formulario obligatorio en semanas de precompeticion y
                    competition week.
                  </p>
                </div>
                <label className="w-full max-w-sm text-sm text-brand-muted">
                  Campo
                  <select
                    value={selectedPeakMetric}
                    onChange={(event) => setSelectedPeakMetric(event.target.value as PeakMetricKey)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  >
                    {PEAK_METRIC_OPTIONS.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <PeakModeChart points={peakMetricSeries} unit={selectedPeakMetricOption.unit} />
              </div>

              {peakModeLogs.length === 0 ? (
                <p className="mt-4 text-sm text-brand-muted">
                  Este usuario no tiene registros diarios de modo titan/diablo.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-[780px] w-full text-sm">
                    <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Modo</th>
                        <th className="px-3 py-2 text-left">{selectedPeakMetricOption.label}</th>
                        <th className="px-3 py-2 text-left">Entreno</th>
                        <th className="px-3 py-2 text-left">Registro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...peakModeLogs].reverse().map((log, index) => (
                        <tr key={`${log.fecha}-${log.timestamp}-${index}`} className="border-t border-white/10">
                          <td className="px-3 py-2 text-brand-text">{formatDateLabel(log.fecha)}</td>
                          <td className="px-3 py-2">
                            <span className={formatPeakModeBadgeClass(log.modo)}>
                              {formatPeakModeLabel(log.modo)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-brand-text">
                            {formatPeakModeDailyValue(log, selectedPeakMetricOption)}
                          </td>
                          <td className="px-3 py-2 text-brand-text">
                            {log.tuvoEntreno ? (log.dobleSesion ? "Si (doble)" : "Si") : "No"}
                          </td>
                          <td className="px-3 py-2 text-brand-muted">
                            {log.timestamp ? formatDateTimeLabel(log.timestamp) : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h3 className="text-lg font-semibold text-brand-text">Planes nutricionales (PDF)</h3>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/20 bg-black/25 px-3 py-2 text-sm text-brand-text hover:bg-black/35">
                    <Upload className="h-4 w-4" />Seleccionar PDF
                    <input key={fileInputKey} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(event) => setPlanFiles(Array.from(event.target.files ?? []))} />
                  </label>
                  <BrandButton onClick={handleUploadPlans} disabled={uploadingPlans || !planFiles.length}>{uploadingPlans ? "Subiendo..." : "Subir al usuario"}</BrandButton>
                </div>
              </div>
              {planFiles.length ? <p className="mt-2 text-xs text-brand-muted">Seleccionados: {planFiles.map((f) => f.name).join(", ")}</p> : null}

              {selectedData.tools.nutritionPlans.length === 0 ? <p className="mt-3 text-sm text-brand-muted">No hay planes nutricionales subidos.</p> : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedData.tools.nutritionPlans.map((plan) => (
                    <article key={plan.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/25">
                      <a href={`/api/nutrition-plans/${plan.id}`} target="_blank" rel="noreferrer"><img src={`/api/nutrition-plans/${plan.id}/thumbnail`} alt={plan.name} className="h-28 w-full object-cover" /></a>
                      <div className="space-y-2 p-3">
                        <p className="min-h-10 text-sm font-medium text-brand-text">{plan.name}</p>
                        <p className="text-xs text-brand-muted">{getPlanDisplayDate(plan)} · {formatPlanSize(plan.sizeBytes)}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={`/api/nutrition-plans/${plan.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/40 px-3 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/10"><Eye className="h-3.5 w-3.5" />Ver</a>
                          <a href={`/api/nutrition-plans/${plan.id}?download=1`} className="inline-flex items-center gap-1 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-brand-text transition hover:bg-white/10"><Download className="h-3.5 w-3.5" />Descargar</a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h3 className="text-lg font-semibold text-brand-text">Herramienta: Gestion de entreno</h3>
                {selectedData.tools.routines.length === 0 ? <p className="mt-3 text-sm text-brand-muted">No hay sesiones registradas.</p> : (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                    <table className="min-w-[1180px] w-full text-sm">
                      <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                        <tr>
                          <th className="px-3 py-2 text-left">Fecha</th>
                          <th className="px-3 py-2 text-left">Dia</th>
                          <th className="px-3 py-2 text-left">Grupo</th>
                          <th className="px-3 py-2 text-left">Ejercicio</th>
                          <th className="px-3 py-2 text-left">Series</th>
                          <th className="px-3 py-2 text-left">Reps</th>
                          <th className="px-3 py-2 text-left">Peso</th>
                          <th className="px-3 py-2 text-left">RPE</th>
                          <th className="px-3 py-2 text-left">Fatiga</th>
                          <th className="px-3 py-2 text-left">Molestias GI</th>
                          <th className="px-3 py-2 text-left">Intraentreno</th>
                          <th className="px-3 py-2 text-left">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedData.tools.routines.map((item, index) => (
                          <tr key={`${item.timestamp}-${index}`} className="border-t border-white/10">
                            <td className="px-3 py-2 text-brand-text">{formatDateLabel(item.fechaSesion)}</td>
                            <td className="px-3 py-2 text-brand-text">{item.dia}</td>
                            <td className="px-3 py-2 text-brand-text">{item.grupoMuscular}</td>
                            <td className="px-3 py-2 text-brand-text">{item.ejercicio}</td>
                            <td className="px-3 py-2 text-brand-text">{item.series}</td>
                            <td className="px-3 py-2 text-brand-text">{item.repeticiones}</td>
                            <td className="px-3 py-2 text-brand-text">{item.pesoKg === null ? "-" : `${item.pesoKg} kg`}</td>
                            <td className="px-3 py-2 text-brand-text">{item.erp}</td>
                            <td className="px-3 py-2 text-brand-text">{item.nivelFatiga}</td>
                            <td className="px-3 py-2 text-brand-text">{item.molestiasGastrointestinales}</td>
                            <td className="px-3 py-2 text-brand-text">{item.intraentreno ? "Si" : "No"}</td>
                            <td className="px-3 py-2 text-brand-muted">{item.notas || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <h3 className="text-lg font-semibold text-brand-text">Herramienta: Competiciones</h3>
                {selectedData.tools.competitions.length === 0 ? <p className="mt-3 text-sm text-brand-muted">No hay competiciones registradas.</p> : (
                  <div className="mt-3 space-y-2">
                    {selectedData.tools.competitions.map((event) => (
                      <article key={event.id} className="rounded-lg border border-white/10 bg-black/25 p-3">
                        <p className="text-sm font-semibold text-brand-text">{event.title}</p>
                        <p className="mt-1 text-xs text-brand-muted"><Calendar className="mr-1 inline-block h-3.5 w-3.5" />{formatDateLabel(event.date)}</p>
                        <p className="mt-2 text-sm text-brand-text">{event.location || "Sin ubicacion"}</p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-brand-muted">{event.description || "Sin descripcion"}</p>
                        {event.createdAt ? <p className="mt-2 text-[11px] text-brand-muted">Creado: {formatDateTimeLabel(event.createdAt)}</p> : null}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <div className="flex items-center gap-2"><Trophy className="h-4 w-4 text-brand-accent" /><h3 className="text-lg font-semibold text-brand-text">Herramienta: Logros</h3></div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">Marcas maximas</p>
                  {selectedData.tools.achievements.marks.length === 0 ? <p className="mt-2 text-sm text-brand-muted">Sin marcas registradas.</p> : (
                    <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
                      <table className="min-w-[520px] w-full text-sm"><thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted"><tr><th className="px-3 py-2 text-left">Ejercicio</th><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Peso</th></tr></thead><tbody>{selectedData.tools.achievements.marks.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="px-3 py-2 text-brand-text">{item.exercise}</td><td className="px-3 py-2 text-brand-text">{formatDateLabel(item.date)}</td><td className="px-3 py-2 text-brand-text">{item.weightKg} kg</td></tr>)}</tbody></table>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">Objetivos</p>
                  {selectedData.tools.achievements.goals.length === 0 ? <p className="mt-2 text-sm text-brand-muted">Sin objetivos registrados.</p> : (
                    <div className="mt-2 overflow-x-auto rounded-xl border border-white/10">
                      <table className="min-w-[520px] w-full text-sm"><thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted"><tr><th className="px-3 py-2 text-left">Ejercicio</th><th className="px-3 py-2 text-left">Fecha objetivo</th><th className="px-3 py-2 text-left">Peso objetivo</th></tr></thead><tbody>{selectedData.tools.achievements.goals.map((item) => <tr key={item.id} className="border-t border-white/10"><td className="px-3 py-2 text-brand-text">{item.exercise}</td><td className="px-3 py-2 text-brand-text">{formatDateLabel(item.targetDate)}</td><td className="px-3 py-2 text-brand-text">{item.targetWeightKg} kg</td></tr>)}</tbody></table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center text-brand-muted">Selecciona un usuario para ver sus datos.</div>
        )}
      </div>
    </MotionPage>
  );
}

