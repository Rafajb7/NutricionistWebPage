"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Calendar,
  Dumbbell,
  LineChart,
  LogOut,
  Pencil,
  Plus,
  Save,
  Trash2,
  Trophy
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

type ToolsShellProps = {
  user: SessionUser;
};

type ToolSection = "routine" | "competitions";

type ExerciseGroup = {
  muscleGroup: string;
  exercises: string[];
};

type RoutineLog = {
  timestamp: string;
  nombre: string;
  usuario: string;
  fechaSesion: string;
  dia: string;
  grupoMuscular: string;
  ejercicio: string;
  repeticiones: number;
  pesoKg: number | null;
  notas: string;
};

type RoutineSessionTarget = {
  timestamp: string;
  sessionDate: string;
  day: string;
};

type RoutineEntryForm = {
  id: string;
  muscleGroup: string;
  exercise: string;
  reps: string;
  weightKg: string;
  notes: string;
};

type RoutineDayForm = {
  id: string;
  label: string;
  entries: RoutineEntryForm[];
};

type ProgressPoint = {
  date: string;
  value: number;
};

type HistorySession = {
  id: string;
  timestamp: string;
  fechaSesion: string;
  dia: string;
  items: RoutineLog[];
};

type HistoryDateBucket = {
  date: string;
  sessions: HistorySession[];
};

type CompetitionEvent = {
  id: string;
  title: string;
  date: string;
  location: string;
  description: string;
  createdAt: string;
};

type CompetitionsResponse = {
  events?: CompetitionEvent[];
  warning?: string;
  error?: string;
};

const TOOLS_CACHE_TTL_MS = 90 * 1000;
const TOOLS_CACHE_VERSION = 1;

type ToolsClientCache = {
  timestamp: number;
  catalog: ExerciseGroup[];
  totalExercises: number;
  logs: RoutineLog[];
};

function createClientId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function formatDateForInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit"
  });
}

function formatTimeLabel(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toRoutineEntry(groups: ExerciseGroup[]): RoutineEntryForm {
  const firstGroup = groups[0]?.muscleGroup ?? "";
  const firstExercise = groups[0]?.exercises[0] ?? "";
  return {
    id: createClientId("entry"),
    muscleGroup: firstGroup,
    exercise: firstExercise,
    reps: "",
    weightKg: "",
    notes: ""
  };
}

function toRoutineDay(groups: ExerciseGroup[], index: number): RoutineDayForm {
  return {
    id: createClientId("day"),
    label: `Dia ${index}`,
    entries: [toRoutineEntry(groups)]
  };
}

function toHistorySessionId(item: { timestamp: string; fechaSesion: string; dia: string }): string {
  return `${item.timestamp}||${item.fechaSesion}||${item.dia}`;
}

function parseEntryNumber(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function toDaysUntil(date: string): number | null {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function formatDaysUntilLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Hoy";
  if (daysUntil === 1) return "Mañana";
  if (daysUntil > 1) return `En ${daysUntil} días`;
  return "Evento pasado";
}

function ProgressChart(props: {
  title: string;
  points: ProgressPoint[];
  color: string;
  unit: string;
}) {
  const { title, points, color, unit } = props;

  if (!points.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
        No hay datos todavia para {title.toLowerCase()}.
      </div>
    );
  }

  const width = 760;
  const height = 260;
  const paddingX = 52;
  const paddingY = 34;

  const minValue = Math.min(...points.map((item) => item.value));
  const maxValue = Math.max(...points.map((item) => item.value));
  const range = Math.max(maxValue - minValue, 1);

  const x = (index: number) =>
    paddingX + (index * (width - paddingX * 2)) / Math.max(points.length - 1, 1);
  const y = (value: number) =>
    height - paddingY - ((value - minValue) * (height - paddingY * 2)) / range;

  const polyline = points.map((item, index) => `${x(index)},${y(item.value)}`).join(" ");

  const ticks = Array.from({ length: 5 }).map((_, index) => {
    const value = minValue + ((maxValue - minValue) * index) / 4;
    return {
      value,
      y: y(value)
    };
  });

  const labelStep = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="mb-2 text-xs uppercase tracking-[0.16em] text-brand-muted">{title}</p>
      <div className="min-w-0 overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          {ticks.map((tick, index) => (
            <g key={`${title}-tick-${index}`}>
              <line
                x1={paddingX}
                x2={width - paddingX}
                y1={tick.y}
                y2={tick.y}
                stroke="rgba(255,255,255,0.12)"
                strokeDasharray="4 5"
              />
              <text
                x={paddingX - 8}
                y={tick.y + 4}
                textAnchor="end"
                fill="rgba(255,255,255,0.65)"
                fontSize={11}
              >
                {tick.value.toFixed(1)}
                {unit}
              </text>
            </g>
          ))}

          <polyline fill="none" stroke={color} strokeWidth={3} points={polyline} />

          {points.map((item, index) => (
            <g key={`${title}-${item.date}-${index}`}>
              <circle cx={x(index)} cy={y(item.value)} r={4} fill={color} />
              {index % labelStep === 0 || index === points.length - 1 ? (
                <text
                  x={x(index)}
                  y={height - 8}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.66)"
                  fontSize={11}
                >
                  {formatDateLabel(item.date)}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export function ToolsShell({ user }: ToolsShellProps) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<ExerciseGroup[]>([]);
  const [totalExercises, setTotalExercises] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [historyActionLoading, setHistoryActionLoading] = useState(false);
  const [sessionDate, setSessionDate] = useState(() => formatDateForInput(new Date()));
  const [days, setDays] = useState<RoutineDayForm[]>([]);
  const [logs, setLogs] = useState<RoutineLog[]>([]);
  const [selectedExercise, setSelectedExercise] = useState("");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState("");
  const [selectedHistorySessionId, setSelectedHistorySessionId] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionDate, setEditingSessionDate] = useState("");
  const [editingDayLabel, setEditingDayLabel] = useState("");
  const [editingEntries, setEditingEntries] = useState<RoutineEntryForm[]>([]);
  const [activeTool, setActiveTool] = useState<ToolSection>("routine");
  const [competitions, setCompetitions] = useState<CompetitionEvent[]>([]);
  const [competitionsLoading, setCompetitionsLoading] = useState(true);
  const [competitionSaving, setCompetitionSaving] = useState(false);
  const [competitionDate, setCompetitionDate] = useState("");
  const [competitionWeighInTime, setCompetitionWeighInTime] = useState("");
  const [competitionName, setCompetitionName] = useState("");
  const [competitionLocation, setCompetitionLocation] = useState("");
  const [competitionDescription, setCompetitionDescription] = useState("");
  const toolsCacheKey = useMemo(
    () => `mat:tools-cache:v${TOOLS_CACHE_VERSION}:${user.username.trim().toLowerCase()}`,
    [user.username]
  );

  const exercisesByGroup = useMemo(
    () => new Map(catalog.map((group) => [group.muscleGroup, group.exercises])),
    [catalog]
  );

  const chartExerciseOptions = useMemo(() => {
    return Array.from(new Set(logs.map((entry) => entry.ejercicio))).sort((a, b) =>
      a.localeCompare(b, "es")
    );
  }, [logs]);

  const chartLogs = useMemo(() => {
    const filtered = logs
      .filter((entry) => entry.ejercicio === selectedExercise)
      .sort((a, b) => {
        const byDate = a.fechaSesion.localeCompare(b.fechaSesion);
        if (byDate !== 0) return byDate;
        return a.timestamp.localeCompare(b.timestamp);
      });

    const weight: ProgressPoint[] = [];
    const reps: ProgressPoint[] = [];

    for (const item of filtered) {
      reps.push({
        date: item.fechaSesion,
        value: item.repeticiones
      });

      if (item.pesoKg !== null) {
        weight.push({
          date: item.fechaSesion,
          value: item.pesoKg
        });
      }
    }

    return { weight, reps };
  }, [logs, selectedExercise]);

  const historyByDate = useMemo<HistoryDateBucket[]>(() => {
    const sessionMap = new Map<string, HistorySession>();

    for (const item of logs) {
      const id = toHistorySessionId(item);
      const existing = sessionMap.get(id);
      if (existing) {
        existing.items.push(item);
      } else {
        sessionMap.set(id, {
          id,
          timestamp: item.timestamp,
          fechaSesion: item.fechaSesion,
          dia: item.dia,
          items: [item]
        });
      }
    }

    const grouped = new Map<string, HistorySession[]>();
    for (const session of sessionMap.values()) {
      const list = grouped.get(session.fechaSesion) ?? [];
      list.push(session);
      grouped.set(session.fechaSesion, list);
    }

    return Array.from(grouped.entries())
      .map(([date, sessions]) => ({
        date,
        sessions: [...sessions].sort((a, b) => {
          const byTimestamp = b.timestamp.localeCompare(a.timestamp);
          if (byTimestamp !== 0) return byTimestamp;
          return a.dia.localeCompare(b.dia, "es");
        })
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [logs]);

  const sessionsForSelectedDate = useMemo(() => {
    return historyByDate.find((item) => item.date === selectedHistoryDate)?.sessions ?? [];
  }, [historyByDate, selectedHistoryDate]);

  const selectedHistorySession = useMemo(() => {
    return sessionsForSelectedDate.find((item) => item.id === selectedHistorySessionId) ?? null;
  }, [sessionsForSelectedDate, selectedHistorySessionId]);

  const nextCompetition = useMemo(() => {
    const upcoming = competitions
      .map((item) => ({
        ...item,
        daysUntil: toDaysUntil(item.date)
      }))
      .filter((item) => item.daysUntil !== null && item.daysUntil >= 0)
      .sort((a, b) => {
        if (a.daysUntil === b.daysUntil) return a.date.localeCompare(b.date);
        return (a.daysUntil ?? 0) - (b.daysUntil ?? 0);
      });

    return upcoming[0] ?? null;
  }, [competitions]);

  useEffect(() => {
    router.prefetch("/dashboard");
    router.prefetch("/revision/new");
  }, [router]);

  useEffect(() => {
    let active = true;

    try {
      const cachedRaw = window.localStorage.getItem(toolsCacheKey);
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw) as ToolsClientCache;
        const isFresh =
          typeof cached?.timestamp === "number" &&
          Date.now() - cached.timestamp <= TOOLS_CACHE_TTL_MS;

        if (isFresh) {
          const cachedCatalog = Array.isArray(cached.catalog) ? cached.catalog : [];
          const cachedLogs = Array.isArray(cached.logs) ? cached.logs : [];
          setCatalog(cachedCatalog);
          setTotalExercises(cached.totalExercises ?? 0);
          setLogs(cachedLogs);
          setCatalogLoading(false);
          setHistoryLoading(false);
        }
      }
    } catch {
      // ignore malformed local cache
    }

    async function load() {
      try {
        const [catalogRes, historyRes] = await Promise.all([
          fetch("/api/tools/exercises"),
          fetch("/api/tools/routines")
        ]);

        if (catalogRes.status === 401 || historyRes.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!catalogRes.ok) throw new Error("No se pudo cargar el catalogo de ejercicios.");
        if (!historyRes.ok) throw new Error("No se pudo cargar el historial de rutinas.");

        const catalogJson = (await catalogRes.json()) as {
          groups: ExerciseGroup[];
          totalExercises: number;
        };
        const historyJson = (await historyRes.json()) as { logs: RoutineLog[] };

        if (!active) return;
        const nextCatalog = catalogJson.groups ?? [];
        const nextTotal = catalogJson.totalExercises ?? 0;
        const nextLogs = historyJson.logs ?? [];
        setCatalog(nextCatalog);
        setTotalExercises(nextTotal);
        setLogs(nextLogs);

        try {
          const payload: ToolsClientCache = {
            timestamp: Date.now(),
            catalog: nextCatalog,
            totalExercises: nextTotal,
            logs: nextLogs
          };
          window.localStorage.setItem(toolsCacheKey, JSON.stringify(payload));
        } catch {
          // ignore local storage errors
        }
      } catch (error) {
        console.error(error);
        toast.error("Error cargando datos de herramientas.");
      } finally {
        if (active) {
          setCatalogLoading(false);
          setHistoryLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [router, toolsCacheKey]);

  useEffect(() => {
    if (!catalog.length) return;
    setDays((prev) => (prev.length ? prev : [toRoutineDay(catalog, 1)]));
  }, [catalog]);

  useEffect(() => {
    if (!chartExerciseOptions.length) {
      setSelectedExercise("");
      return;
    }
    if (!chartExerciseOptions.includes(selectedExercise)) {
      setSelectedExercise(chartExerciseOptions[0]);
    }
  }, [chartExerciseOptions, selectedExercise]);

  useEffect(() => {
    if (!historyByDate.length) {
      setSelectedHistoryDate("");
      setSelectedHistorySessionId("");
      setEditingSessionId(null);
      return;
    }

    if (!historyByDate.some((item) => item.date === selectedHistoryDate)) {
      setSelectedHistoryDate(historyByDate[0].date);
    }
  }, [historyByDate, selectedHistoryDate]);

  useEffect(() => {
    if (!sessionsForSelectedDate.length) {
      setSelectedHistorySessionId("");
      setEditingSessionId(null);
      return;
    }

    if (!sessionsForSelectedDate.some((item) => item.id === selectedHistorySessionId)) {
      setSelectedHistorySessionId(sessionsForSelectedDate[0].id);
    }

    if (editingSessionId && !sessionsForSelectedDate.some((item) => item.id === editingSessionId)) {
      setEditingSessionId(null);
    }
  }, [sessionsForSelectedDate, selectedHistorySessionId, editingSessionId]);

  async function reloadCompetitions() {
    setCompetitionsLoading(true);
    try {
      const res = await fetch("/api/tools/competitions");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = (await res.json()) as CompetitionsResponse;
      if (!res.ok) {
        toast.error(json.error ?? "No se pudieron cargar las competiciones.");
        return;
      }
      if (json.warning) {
        toast.warning(json.warning);
      }
      setCompetitions(json.events ?? []);
    } catch (error) {
      console.error(error);
      toast.error("No se pudieron cargar las competiciones.");
    } finally {
      setCompetitionsLoading(false);
    }
  }

  useEffect(() => {
    reloadCompetitions();
  }, []);

  async function reloadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/tools/routines");
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("No se pudo cargar el historial de rutinas.");
      const json = (await res.json()) as { logs: RoutineLog[] };
      const nextLogs = json.logs ?? [];
      setLogs(nextLogs);
      try {
        const payload: ToolsClientCache = {
          timestamp: Date.now(),
          catalog,
          totalExercises,
          logs: nextLogs
        };
        window.localStorage.setItem(toolsCacheKey, JSON.stringify(payload));
      } catch {
        // ignore local storage errors
      }
    } catch (error) {
      console.error(error);
      toast.error("No se pudo refrescar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  }

  function normalizeFormEntries(entries: RoutineEntryForm[]) {
    return entries
      .map((entry) => {
        const reps = parseEntryNumber(entry.reps);
        const weightKg = entry.weightKg.trim() ? parseEntryNumber(entry.weightKg) : null;

        if (!entry.muscleGroup.trim() || !entry.exercise.trim()) return null;
        if (reps === null || !Number.isInteger(reps) || reps <= 0 || reps > 300) return null;
        if (weightKg !== null && (weightKg < 0 || weightKg > 1500)) return null;

        return {
          muscleGroup: entry.muscleGroup.trim(),
          exercise: entry.exercise.trim(),
          reps,
          weightKg,
          notes: entry.notes.trim()
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }

  function updateDayLabel(dayId: string, label: string) {
    setDays((prev) => prev.map((day) => (day.id === dayId ? { ...day, label } : day)));
  }

  function addDay() {
    if (!catalog.length) return;
    setDays((prev) => [...prev, toRoutineDay(catalog, prev.length + 1)]);
  }

  function removeDay(dayId: string) {
    setDays((prev) => {
      if (prev.length === 1) {
        toast.error("Debe existir al menos un dia.");
        return prev;
      }
      return prev.filter((day) => day.id !== dayId);
    });
  }

  function addEntry(dayId: string) {
    if (!catalog.length) return;
    setDays((prev) =>
      prev.map((day) =>
        day.id === dayId
          ? {
              ...day,
              entries: [...day.entries, toRoutineEntry(catalog)]
            }
          : day
      )
    );
  }

  function removeEntry(dayId: string, entryId: string) {
    setDays((prev) =>
      prev.map((day) => {
        if (day.id !== dayId) return day;
        if (day.entries.length === 1) {
          toast.error("Cada dia debe tener al menos un ejercicio.");
          return day;
        }
        return {
          ...day,
          entries: day.entries.filter((entry) => entry.id !== entryId)
        };
      })
    );
  }

  function updateEntry(
    dayId: string,
    entryId: string,
    field: keyof RoutineEntryForm,
    value: string
  ) {
    setDays((prev) =>
      prev.map((day) => {
        if (day.id !== dayId) return day;
        return {
          ...day,
          entries: day.entries.map((entry) => {
            if (entry.id !== entryId) return entry;
            if (field === "muscleGroup") {
              const groupExercises = exercisesByGroup.get(value) ?? [];
              return {
                ...entry,
                muscleGroup: value,
                exercise: groupExercises[0] ?? ""
              };
            }
            return {
              ...entry,
              [field]: value
            };
          })
        };
      })
    );
  }

  function updateEditingEntry(entryId: string, field: keyof RoutineEntryForm, value: string) {
    setEditingEntries((prev) =>
      prev.map((entry) => {
        if (entry.id !== entryId) return entry;
        if (field === "muscleGroup") {
          const groupExercises = exercisesByGroup.get(value) ?? [];
          return {
            ...entry,
            muscleGroup: value,
            exercise: groupExercises[0] ?? ""
          };
        }
        return {
          ...entry,
          [field]: value
        };
      })
    );
  }

  function addEditingEntry() {
    if (!catalog.length) return;
    setEditingEntries((prev) => [...prev, toRoutineEntry(catalog)]);
  }

  function removeEditingEntry(entryId: string) {
    setEditingEntries((prev) => {
      if (prev.length === 1) {
        toast.error("Debe quedar al menos un ejercicio en la sesion.");
        return prev;
      }
      return prev.filter((entry) => entry.id !== entryId);
    });
  }

  function startEditingSelectedSession() {
    if (!selectedHistorySession) return;
    setEditingSessionId(selectedHistorySession.id);
    setEditingSessionDate(selectedHistorySession.fechaSesion);
    setEditingDayLabel(selectedHistorySession.dia);
    setEditingEntries(
      selectedHistorySession.items.map((item) => ({
        id: createClientId("edit-entry"),
        muscleGroup: item.grupoMuscular,
        exercise: item.ejercicio,
        reps: String(item.repeticiones),
        weightKg: item.pesoKg === null ? "" : String(item.pesoKg),
        notes: item.notas ?? ""
      }))
    );
  }

  function cancelEditingSession() {
    setEditingSessionId(null);
    setEditingSessionDate("");
    setEditingDayLabel("");
    setEditingEntries([]);
  }

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  async function registerRoutine() {
    if (!sessionDate) {
      toast.error("Debes indicar una fecha de sesion.");
      return;
    }

    const parsedDays = days
      .map((day) => ({
        label: day.label.trim() || "Dia sin nombre",
        entries: normalizeFormEntries(day.entries)
      }))
      .filter((day) => day.entries.length > 0);

    if (!parsedDays.length) {
      toast.error("Completa al menos un ejercicio valido para registrar.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/tools/routines", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionDate,
          days: parsedDays
        })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo registrar la rutina.");
        return;
      }

      toast.success(`Registro guardado (${json.count ?? 0} ejercicios).`);
      await reloadHistory();
    } catch (error) {
      console.error(error);
      toast.error("Error al guardar el registro.");
    } finally {
      setSaving(false);
    }
  }

  async function registerCompetition() {
    if (!competitionDate) {
      toast.error("Debes indicar la fecha de la competición.");
      return;
    }
    if (!competitionName.trim()) {
      toast.error("Debes indicar el nombre de la competición.");
      return;
    }
    if (!competitionWeighInTime) {
      toast.error("Debes indicar la hora de pesaje.");
      return;
    }
    if (!competitionLocation.trim()) {
      toast.error("Debes indicar la ubicación.");
      return;
    }

    setCompetitionSaving(true);
    try {
      const res = await fetch("/api/tools/competitions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          competitionDate,
          competitionName: competitionName.trim(),
          weighInTime: competitionWeighInTime,
          location: competitionLocation.trim(),
          description: competitionDescription.trim()
        })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo registrar la competición.");
        return;
      }

      toast.success("Competición registrada en el calendario.");
      setCompetitionWeighInTime("");
      setCompetitionName("");
      setCompetitionLocation("");
      setCompetitionDescription("");
      await reloadCompetitions();
      window.dispatchEvent(new Event("diablo-mode:refresh"));
    } catch (error) {
      console.error(error);
      toast.error("Error al registrar la competición.");
    } finally {
      setCompetitionSaving(false);
    }
  }

  async function deleteSelectedSession() {
    if (!selectedHistorySession) return;

    const confirmed = window.confirm(
      `Vas a eliminar la sesion "${selectedHistorySession.dia}" del ${formatDateLabel(selectedHistorySession.fechaSesion)}. Esta accion no se puede deshacer.`
    );
    if (!confirmed) return;

    const target: RoutineSessionTarget = {
      timestamp: selectedHistorySession.timestamp,
      sessionDate: selectedHistorySession.fechaSesion,
      day: selectedHistorySession.dia
    };

    setHistoryActionLoading(true);
    try {
      const res = await fetch("/api/tools/routines", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ target })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo eliminar la sesion.");
        return;
      }

      if (editingSessionId === selectedHistorySession.id) {
        cancelEditingSession();
      }
      toast.success(`Sesion eliminada (${json.count ?? 0} ejercicios).`);
      await reloadHistory();
    } catch (error) {
      console.error(error);
      toast.error("Error eliminando la sesion.");
    } finally {
      setHistoryActionLoading(false);
    }
  }

  async function saveEditedSession() {
    if (!selectedHistorySession) return;
    if (!editingSessionDate) {
      toast.error("La fecha de sesion es obligatoria.");
      return;
    }

    const entries = normalizeFormEntries(editingEntries);
    if (!entries.length) {
      toast.error("Debes dejar al menos un ejercicio valido.");
      return;
    }

    const target: RoutineSessionTarget = {
      timestamp: selectedHistorySession.timestamp,
      sessionDate: selectedHistorySession.fechaSesion,
      day: selectedHistorySession.dia
    };

    setHistoryActionLoading(true);
    try {
      const res = await fetch("/api/tools/routines", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          target,
          sessionDate: editingSessionDate,
          dayLabel: editingDayLabel.trim() || "Dia sin nombre",
          entries
        })
      });

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      const json = (await res.json()) as { error?: string; count?: number };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo modificar la sesion.");
        return;
      }

      toast.success(`Sesion modificada (${json.count ?? 0} ejercicios).`);
      cancelEditingSession();
      await reloadHistory();
      setSelectedHistoryDate(editingSessionDate);
    } catch (error) {
      console.error(error);
      toast.error("Error actualizando la sesion.");
    } finally {
      setHistoryActionLoading(false);
    }
  }

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-7 px-4 py-8 md:px-8">
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
                <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                  Herramientas
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

        <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Menu de herramientas</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <BrandButton
              variant={activeTool === "routine" ? "accent" : "ghost"}
              className="w-full justify-center px-4 py-2 sm:w-auto"
              onClick={() => setActiveTool("routine")}
            >
              <Dumbbell className="mr-2 h-4 w-4" />
              Gestion de rutina
            </BrandButton>
            <BrandButton
              variant={activeTool === "competitions" ? "accent" : "ghost"}
              className="w-full justify-center px-4 py-2 sm:w-auto"
              onClick={() => setActiveTool("competitions")}
            >
              <Trophy className="mr-2 h-4 w-4" />
              Competiciones
            </BrandButton>
          </div>
        </section>

        {activeTool === "routine" ? (
          <>
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="rounded-3xl border border-brand-accent/20 bg-brand-surface/80 p-6 shadow-glow"
        >
          <p className="text-xs uppercase tracking-[0.24em] text-brand-muted">Herramientas</p>
          <h1 className="mt-2 text-3xl font-bold text-brand-text">Gestion de rutina</h1>
          <p className="mt-3 max-w-3xl text-sm text-brand-muted">
            Define rutinas para todos los dias que necesites, registra repeticiones y peso por
            ejercicio, y revisa tu evolucion historica.
          </p>

          <div className="mt-5 grid gap-3 md:grid-cols-[220px,auto,auto] md:items-end">
            <label className="min-w-0 text-sm text-brand-muted">
              Fecha de sesion
              <div className="relative mt-2 min-w-0">
                <Calendar className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-muted" />
                <input
                  type="date"
                  value={sessionDate}
                  onChange={(event) => setSessionDate(event.target.value)}
                  className="block min-w-0 w-full max-w-full [min-inline-size:0] rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                />
              </div>
            </label>
            <div className="flex flex-wrap gap-2">
              <BrandButton variant="ghost" onClick={addDay} disabled={!catalog.length}>
                <Plus className="mr-1 h-4 w-4" />
                Anadir dia
              </BrandButton>
              <BrandButton onClick={registerRoutine} disabled={saving || !days.length}>
                <Save className="mr-1 h-4 w-4" />
                {saving ? "Guardando..." : "Registro"}
              </BrandButton>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-brand-muted">
              {catalogLoading ? (
                "Cargando catalogo..."
              ) : (
                <span>
                  {catalog.length} grupos musculares, {totalExercises} ejercicios base
                </span>
              )}
            </div>
          </div>
        </motion.section>

        <section className="space-y-4">
          {catalogLoading ? (
            <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="mt-3 h-20 w-full" />
              <Skeleton className="mt-3 h-20 w-full" />
            </div>
          ) : (
            days.map((day, dayIndex) => (
              <article
                key={day.id}
                className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="h-4 w-4 text-brand-accent" />
                    <p className="text-sm text-brand-muted">Dia {dayIndex + 1}</p>
                  </div>
                  <BrandButton
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    onClick={() => removeDay(day.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Eliminar dia
                  </BrandButton>
                </div>

                <label className="mb-4 block text-sm text-brand-muted">
                  Nombre del dia
                  <input
                    value={day.label}
                    onChange={(event) => updateDayLabel(day.id, event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    placeholder="Ejemplo: Dia 1 - Tiron"
                  />
                </label>

                <div className="space-y-3">
                  {day.entries.map((entry) => {
                    const exercises = exercisesByGroup.get(entry.muscleGroup) ?? [];
                    return (
                      <div
                        key={entry.id}
                        className="grid gap-2 rounded-xl border border-white/10 bg-black/25 p-3 md:grid-cols-[1fr,1.2fr,0.5fr,0.5fr,1fr,auto]"
                      >
                        <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                          Grupo
                          <select
                            value={entry.muscleGroup}
                            onChange={(event) =>
                              updateEntry(day.id, entry.id, "muscleGroup", event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                          >
                            {catalog.map((group) => (
                              <option key={group.muscleGroup} value={group.muscleGroup}>
                                {group.muscleGroup}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                          Ejercicio
                          <select
                            value={entry.exercise}
                            onChange={(event) =>
                              updateEntry(day.id, entry.id, "exercise", event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                          >
                            {exercises.map((exercise) => (
                              <option key={`${entry.muscleGroup}-${exercise}`} value={exercise}>
                                {exercise}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                          Reps
                          <input
                            type="number"
                            min={1}
                            value={entry.reps}
                            onChange={(event) =>
                              updateEntry(day.id, entry.id, "reps", event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                          />
                        </label>

                        <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                          Peso kg
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            value={entry.weightKg}
                            onChange={(event) =>
                              updateEntry(day.id, entry.id, "weightKg", event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                          />
                        </label>

                        <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                          Notas
                          <input
                            value={entry.notes}
                            onChange={(event) =>
                              updateEntry(day.id, entry.id, "notes", event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                            placeholder="Opcional"
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeEntry(day.id, entry.id)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 text-brand-text transition hover:bg-white/10"
                            aria-label="Eliminar ejercicio"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3">
                  <BrandButton
                    variant="ghost"
                    className="px-3 py-2 text-xs"
                    onClick={() => addEntry(day.id)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Anadir ejercicio
                  </BrandButton>
                </div>
              </article>
            ))
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">Evolucion</p>
              <h2 className="mt-1 text-lg font-semibold text-brand-text">
                Historico de rutinas y progreso
              </h2>
            </div>
            <label className="w-full max-w-sm text-sm text-brand-muted">
              Ejercicio para grafica
              <select
                value={selectedExercise}
                onChange={(event) => setSelectedExercise(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
              >
                {chartExerciseOptions.map((exercise) => (
                  <option key={exercise} value={exercise}>
                    {exercise}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ProgressChart
              title={`Peso - ${selectedExercise || "sin seleccion"}`}
              points={chartLogs.weight}
              color="#F7CC2F"
              unit="kg"
            />
            <ProgressChart
              title={`Repeticiones - ${selectedExercise || "sin seleccion"}`}
              points={chartLogs.reps}
              color="#6fe7b5"
              unit=""
            />
          </div>

          <div className="mt-4 space-y-3">
            {historyLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : historyByDate.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                Aun no hay registros de rutinas.
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-brand-muted">
                    Fecha registrada
                    <select
                      value={selectedHistoryDate}
                      onChange={(event) => setSelectedHistoryDate(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      {historyByDate.map((bucket) => (
                        <option key={bucket.date} value={bucket.date}>
                          {formatDateLabel(bucket.date)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-brand-muted">
                    Dia registrado
                    <select
                      value={selectedHistorySessionId}
                      onChange={(event) => setSelectedHistorySessionId(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      {sessionsForSelectedDate.map((session) => {
                        const time = formatTimeLabel(session.timestamp);
                        const optionLabel = time ? `${session.dia} (${time})` : session.dia;
                        return (
                          <option key={session.id} value={session.id}>
                            {optionLabel}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
                {selectedHistorySession ? (
                  <article className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-brand-text">
                          {formatDateLabel(selectedHistorySession.fechaSesion)} · {selectedHistorySession.dia}
                        </p>
                        <p className="text-xs text-brand-muted">
                          {selectedHistorySession.items.length} ejercicios registrados
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <BrandButton
                          variant="ghost"
                          className="px-3 py-2 text-xs"
                          onClick={startEditingSelectedSession}
                          disabled={historyActionLoading}
                        >
                          <Pencil className="mr-1 h-3.5 w-3.5" />
                          Modificar
                        </BrandButton>
                        <BrandButton
                          variant="ghost"
                          className="px-3 py-2 text-xs"
                          onClick={deleteSelectedSession}
                          disabled={historyActionLoading}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Eliminar
                        </BrandButton>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {selectedHistorySession.items.map((item, index) => (
                        <div
                          key={`${selectedHistorySession.id}-${item.ejercicio}-${index}`}
                          className="grid gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm md:grid-cols-[1fr,0.3fr,0.3fr]"
                        >
                          <div>
                            <p className="font-medium text-brand-text">{item.ejercicio}</p>
                            <p className="text-xs text-brand-muted">{item.grupoMuscular}</p>
                          </div>
                          <p className="text-left text-brand-text md:text-center">{item.repeticiones} reps</p>
                          <p className="text-left text-brand-text md:text-center">
                            {item.pesoKg === null ? "-" : `${item.pesoKg} kg`}
                          </p>
                        </div>
                      ))}
                    </div>
                  </article>
                ) : null}

                {selectedHistorySession && editingSessionId === selectedHistorySession.id ? (
                  <article className="rounded-xl border border-brand-accent/30 bg-black/25 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                      Edicion de sesion
                    </p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="min-w-0 text-sm text-brand-muted">
                        Fecha de sesion
                        <input
                          type="date"
                          value={editingSessionDate}
                          onChange={(event) => setEditingSessionDate(event.target.value)}
                          className="mt-2 block min-w-0 w-full max-w-full [min-inline-size:0] rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                      <label className="text-sm text-brand-muted">
                        Nombre del dia
                        <input
                          value={editingDayLabel}
                          onChange={(event) => setEditingDayLabel(event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                      </label>
                    </div>

                    <div className="mt-3 space-y-2">
                      {editingEntries.map((entry) => {
                        const exercises = exercisesByGroup.get(entry.muscleGroup) ?? [];
                        return (
                          <div
                            key={entry.id}
                            className="grid gap-2 rounded-xl border border-white/10 bg-black/30 p-3 md:grid-cols-[1fr,1.2fr,0.5fr,0.5fr,1fr,auto]"
                          >
                            <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                              Grupo
                              <select
                                value={entry.muscleGroup}
                                onChange={(event) =>
                                  updateEditingEntry(entry.id, "muscleGroup", event.target.value)
                                }
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                              >
                                {catalog.map((group) => (
                                  <option key={group.muscleGroup} value={group.muscleGroup}>
                                    {group.muscleGroup}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                              Ejercicio
                              <select
                                value={entry.exercise}
                                onChange={(event) =>
                                  updateEditingEntry(entry.id, "exercise", event.target.value)
                                }
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                              >
                                {exercises.map((exercise) => (
                                  <option key={`${entry.muscleGroup}-${exercise}`} value={exercise}>
                                    {exercise}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                              Reps
                              <input
                                type="number"
                                min={1}
                                value={entry.reps}
                                onChange={(event) => updateEditingEntry(entry.id, "reps", event.target.value)}
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                              />
                            </label>

                            <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                              Peso kg
                              <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={entry.weightKg}
                                onChange={(event) =>
                                  updateEditingEntry(entry.id, "weightKg", event.target.value)
                                }
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                              />
                            </label>

                            <label className="text-xs uppercase tracking-[0.12em] text-brand-muted">
                              Notas
                              <input
                                value={entry.notes}
                                onChange={(event) => updateEditingEntry(entry.id, "notes", event.target.value)}
                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                              />
                            </label>

                            <div className="flex items-end">
                              <button
                                type="button"
                                onClick={() => removeEditingEntry(entry.id)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/20 text-brand-text transition hover:bg-white/10"
                                aria-label="Eliminar ejercicio editado"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <BrandButton variant="ghost" className="px-3 py-2 text-xs" onClick={addEditingEntry}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Anadir ejercicio
                      </BrandButton>
                      <BrandButton
                        className="px-3 py-2 text-xs"
                        onClick={saveEditedSession}
                        disabled={historyActionLoading}
                      >
                        <Save className="mr-1 h-3.5 w-3.5" />
                        Guardar cambios
                      </BrandButton>
                      <BrandButton
                        variant="ghost"
                        className="px-3 py-2 text-xs"
                        onClick={cancelEditingSession}
                        disabled={historyActionLoading}
                      >
                        Cancelar
                      </BrandButton>
                    </div>
                  </article>
                ) : null}
              </>
            )}
          </div>
        </section>
          </>
        ) : (
          <>
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45 }}
              className="rounded-3xl border border-brand-accent/20 bg-brand-surface/80 p-6 shadow-glow"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-brand-muted">Herramientas</p>
              <h1 className="mt-2 text-3xl font-bold text-brand-text">Competiciones</h1>
              <p className="mt-3 max-w-3xl text-sm text-brand-muted">
                Registra tu proxima competicion para que Manuel Angel Trenas tenga visibilidad del
                evento y pueda ajustar tu plan nutricional con antelacion.
              </p>

              {nextCompetition ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-brand-muted">
                  <p className="font-semibold text-brand-text">
                    Proxima competicion: {nextCompetition.title}
                  </p>
                  <p className="mt-1">
                    {formatDateLabel(nextCompetition.date)} ·{" "}
                    {formatDaysUntilLabel(nextCompetition.daysUntil ?? 0)}
                  </p>
                </div>
              ) : null}

              <div className="mt-5">
                <label className="min-w-0 text-sm text-brand-muted">
                  Fecha de inicio
                  <div className="relative mt-2 min-w-0">
                    <Calendar className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-brand-muted" />
                    <input
                      type="date"
                      value={competitionDate}
                      onChange={(event) => setCompetitionDate(event.target.value)}
                      className="block min-w-0 w-full max-w-full [min-inline-size:0] rounded-xl border border-white/10 bg-black/20 py-3 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </div>
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm text-brand-muted">
                  Nombre de la competicion
                  <input
                    value={competitionName}
                    onChange={(event) => setCompetitionName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    placeholder="Ejemplo: Campeonato Regional"
                  />
                </label>

                <label className="text-sm text-brand-muted">
                  Hora de pesaje
                  <input
                    type="time"
                    value={competitionWeighInTime}
                    onChange={(event) => setCompetitionWeighInTime(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>

                <label className="text-sm text-brand-muted">
                  Ubicacion
                  <input
                    value={competitionLocation}
                    onChange={(event) => setCompetitionLocation(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    placeholder="Ciudad y recinto"
                  />
                </label>

                <label className="text-sm text-brand-muted md:col-span-2">
                  Descripcion
                  <textarea
                    value={competitionDescription}
                    onChange={(event) => setCompetitionDescription(event.target.value)}
                    className="mt-2 h-[90px] w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    placeholder="Detalles relevantes para el nutricionista"
                  />
                </label>
              </div>

              <div className="mt-4">
                <BrandButton onClick={registerCompetition} disabled={competitionSaving}>
                  <Save className="mr-1 h-4 w-4" />
                  {competitionSaving ? "Registrando..." : "Registrar competicion"}
                </BrandButton>
              </div>
            </motion.section>

            <section
              className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4"
            >
              <div className="mb-3">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">
                  Calendario del atleta
                </p>
                <h2 className="mt-1 text-lg font-semibold text-brand-text">
                  Competiciones registradas
                </h2>
              </div>

              {competitionsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : competitions.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                  Todavia no hay competiciones registradas.
                </div>
              ) : (
                <div className="space-y-2">
                  {competitions.map((competition) => {
                    const daysUntil = toDaysUntil(competition.date);
                    return (
                      <article
                        key={competition.id}
                        className="rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-brand-text">{competition.title}</p>
                          <p className="text-xs text-brand-muted">
                            {formatDateLabel(competition.date)}
                            {daysUntil !== null ? ` · ${formatDaysUntilLabel(daysUntil)}` : ""}
                          </p>
                        </div>
                        <p className="mt-1 text-sm text-brand-muted">{competition.location}</p>
                        {competition.description ? (
                          <p className="mt-2 text-sm text-brand-muted">{competition.description}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}

        <div className="flex items-center justify-end">
          <Link href="/dashboard">
            <BrandButton variant="ghost">
              <LineChart className="mr-1 h-4 w-4" />
              Volver al dashboard
            </BrandButton>
          </Link>
        </div>
      </div>
    </MotionPage>
  );
}

