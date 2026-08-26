"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Camera,
  ClipboardList,
  FileText,
  LogOut,
  Pencil,
  Save,
  ShieldAlert,
  Utensils,
  WalletCards
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import { calculatePlanTotals } from "@/lib/nutrition/calculations";
import { formatCents, getComputedPaymentStatus, todayIsoDate } from "@/lib/finance/calculations";
import type { CompetitionCalendarEvent } from "@/lib/google/calendar";
import type { PeakModeDailyLogRow, RoutineLogRow } from "@/lib/google/sheets";
import type { RevisionEntry } from "@/lib/google/types";
import type { StrengthGoal, StrengthMark } from "@/lib/google/achievements";
import type { FinanceContract, FinancePayment } from "@/lib/finance/types";
import type {
  AthletePrivateNote,
  NutritionAthleteRestriction,
  NutritionPlanFull
} from "@/lib/nutrition/types";

type SessionUser = {
  username: string;
  name: string;
};

type AthleteProfileShellProps = {
  user: SessionUser;
  athleteUsername: string;
};

type NutritionPdf = {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string | null;
  modifiedTime: string | null;
  sizeBytes: number | null;
};

type AthleteProfile = {
  user: {
    username: string;
    name: string;
    email: string;
    permission: "user" | "admin";
  };
  dashboard: {
    revisions: RevisionEntry[];
  };
  nutrition: {
    plans: NutritionPlanFull[];
    restrictions: NutritionAthleteRestriction[];
    pdfs: NutritionPdf[];
  };
  tools: {
    routines: RoutineLogRow[];
    competitions: CompetitionCalendarEvent[];
    peakModeLogs: PeakModeDailyLogRow[];
    achievements: {
      marks: StrengthMark[];
      goals: StrengthGoal[];
    };
  };
  finance: {
    contracts: FinanceContract[];
    payments: FinancePayment[];
    summary: {
      activeContractsCount: number;
      pendingCents: number;
      overdueCount: number;
      paidCents: number;
      nextPayment: FinancePayment | null;
    };
  };
  privateNotes: AthletePrivateNote;
};

type ProfileResponse = {
  profile?: AthleteProfile;
  error?: string;
};

function formatDateLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const hasTime = value.includes("T");
  const parsed = new Date(hasTime ? value : `${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatDateTimeLabel(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatDateLabel(value);
  return parsed.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function formatNumber(value: number, suffix = ""): string {
  if (!Number.isFinite(value)) return `0${suffix}`;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function getRevisionQuestionValue(entries: RevisionEntry[], terms: string[]): string {
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const item = entries.find((entry) => {
    const question = entry.pregunta
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    return normalizedTerms.some((term) => question.includes(term));
  });
  return item?.respuesta ?? "-";
}

function groupByDate<T extends { fecha?: string; date?: string }>(items: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const date = item.fecha ?? item.date ?? "";
    if (!date) continue;
    const list = map.get(date) ?? [];
    list.push(item);
    map.set(date, list);
  }
  return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-brand-muted">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-semibold text-brand-text">{title}</h2>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="rounded-xl border border-white/10 bg-black/20 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-brand-text">{value}</p>
      {detail ? <p className="mt-1 text-xs text-brand-muted">{detail}</p> : null}
    </article>
  );
}

export function AthleteProfileShell({ user, athleteUsername }: AthleteProfileShellProps) {
  const router = useRouter();
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [permissionDraft, setPermissionDraft] = useState<"user" | "admin">("user");
  const [notesDraft, setNotesDraft] = useState("");

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/athlete-profile/${encodeURIComponent(normalizeUsername(athleteUsername))}`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        window.location.href = "/dashboard";
        return;
      }

      const json = (await res.json()) as ProfileResponse;
      if (!res.ok || !json.profile) {
        throw new Error(json.error ?? "No se pudo cargar la ficha 360.");
      }
      setProfile(json.profile);
      setNameDraft(json.profile.user.name);
      setEmailDraft(json.profile.user.email);
      setPermissionDraft(json.profile.user.permission);
      setNotesDraft(json.profile.privateNotes.notes);
    } catch (error) {
      console.error(error);
      toast.error("Error cargando la ficha 360.");
    } finally {
      setLoading(false);
    }
  }, [athleteUsername]);

  useEffect(() => {
    router.prefetch("/tools");
    router.prefetch("/tools/nutrition-management");
    router.prefetch("/tools/finance");
    void loadProfile();
  }, [loadProfile, router]);

  const revisionGroups = useMemo(
    () => groupByDate(profile?.dashboard.revisions ?? []),
    [profile?.dashboard.revisions]
  );
  const latestRevision = revisionGroups[0]?.[1] ?? [];
  const latestPhotos = useMemo(
    () =>
      (profile?.dashboard.revisions ?? [])
        .filter((item) => item.imageUrl)
        .slice(0, 8),
    [profile?.dashboard.revisions]
  );
  const orderedPeakLogs = useMemo(
    () => [...(profile?.tools.peakModeLogs ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    [profile?.tools.peakModeLogs]
  );
  const latestPeakLog = orderedPeakLogs[0] ?? null;
  const orderedRoutines = useMemo(
    () =>
      [...(profile?.tools.routines ?? [])].sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp)
      ),
    [profile?.tools.routines]
  );
  const today = todayIsoDate();
  const nextCompetition = useMemo(
    () =>
      [...(profile?.tools.competitions ?? [])]
        .filter((item) => item.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [profile?.tools.competitions, today]
  );
  const nutritionPlans = useMemo(
    () =>
      [...(profile?.nutrition.plans ?? [])].sort((a, b) => {
        const statusOrder = { published: 0, review: 1, draft: 2 } as const;
        const byStatus = statusOrder[a.status] - statusOrder[b.status];
        if (byStatus !== 0) return byStatus;
        return a.name.localeCompare(b.name, "es");
      }),
    [profile?.nutrition.plans]
  );

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  async function saveUserProfile() {
    if (!profile) return;
    setSavingUser(true);
    try {
      const res = await fetch(`/api/admin/athlete-profile/${profile.user.username}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: {
            name: nameDraft,
            email: emailDraft,
            permission: permissionDraft
          }
        })
      });
      const json = (await res.json()) as ProfileResponse;
      if (!res.ok || !json.profile) {
        throw new Error(json.error ?? "No se pudo guardar el perfil.");
      }
      setProfile(json.profile);
      setNameDraft(json.profile.user.name);
      setEmailDraft(json.profile.user.email);
      setPermissionDraft(json.profile.user.permission);
      toast.success("Perfil actualizado.");
    } catch (error) {
      console.error(error);
      toast.error("Error guardando el perfil.");
    } finally {
      setSavingUser(false);
    }
  }

  async function savePrivateNotes() {
    if (!profile) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`/api/admin/athlete-profile/${profile.user.username}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privateNotes: notesDraft })
      });
      const json = (await res.json()) as ProfileResponse;
      if (!res.ok || !json.profile) {
        throw new Error(json.error ?? "No se pudieron guardar las notas.");
      }
      setProfile(json.profile);
      setNotesDraft(json.profile.privateNotes.notes);
      toast.success("Notas privadas guardadas.");
    } catch (error) {
      console.error(error);
      toast.error("Error guardando notas privadas.");
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4 backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/tools">
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Control de usuarios
                </BrandButton>
              </Link>
              <Link href={`/tools/nutrition-management?athlete=${encodeURIComponent(normalizeUsername(athleteUsername))}`}>
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  <Utensils className="mr-2 h-4 w-4" />
                  Gestion nutricional
                </BrandButton>
              </Link>
              <Link href="/tools/finance">
                <BrandButton variant="ghost" className="w-full justify-center px-4 py-2 sm:w-auto">
                  <WalletCards className="mr-2 h-4 w-4" />
                  Finanzas
                </BrandButton>
              </Link>
              <div className="px-2 text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">Administrador</p>
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

        {loading ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-5">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="mt-4 h-28 w-full" />
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
              ))}
            </div>
          </section>
        ) : !profile ? (
          <section className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center text-sm text-brand-muted">
            No se pudo cargar este perfil.
          </section>
        ) : (
          <>
            <motion.section
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl border border-brand-accent/25 bg-brand-surface p-6 shadow-glow"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-brand-muted">
                    Ficha 360 del atleta
                  </p>
                  <h1 className="mt-2 text-3xl font-bold text-brand-text">{profile.user.name}</h1>
                  <p className="mt-2 text-sm text-brand-muted">@{profile.user.username}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[20rem]">
                  <MetricCard
                    label="Planes"
                    value={String(profile.nutrition.plans.length)}
                    detail="Modalidades definidas"
                  />
                  <MetricCard
                    label="Peso actual"
                    value={
                      latestPeakLog
                        ? `${formatNumber(latestPeakLog.pesoAyunasKg, " kg")}`
                        : getRevisionQuestionValue(latestRevision, ["peso"])
                    }
                    detail={latestPeakLog ? formatDateLabel(latestPeakLog.fecha) : "Ultima revision"}
                  />
                </div>
              </div>
            </motion.section>

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle eyebrow="Datos personales" title="Perfil editable" />
                  <Pencil className="h-5 w-5 text-brand-accent" />
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="block text-sm text-brand-muted">
                    Nombre
                    <input
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Email
                    <input
                      value={emailDraft}
                      onChange={(event) => setEmailDraft(event.target.value)}
                      type="email"
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Usuario
                    <input
                      value={profile.user.username}
                      disabled
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-brand-muted outline-none"
                    />
                  </label>
                  <label className="block text-sm text-brand-muted">
                    Permiso
                    <select
                      value={permissionDraft}
                      onChange={(event) =>
                        setPermissionDraft(event.target.value as "user" | "admin")
                      }
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </label>
                </div>
                <div className="mt-4">
                  <BrandButton onClick={saveUserProfile} disabled={savingUser}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingUser ? "Guardando..." : "Guardar perfil"}
                  </BrandButton>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <SectionTitle eyebrow="Notas privadas" title="Contexto del nutricionista" />
                <textarea
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  className="mt-4 h-44 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  placeholder="Notas internas del seguimiento"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-xs text-brand-muted">
                    Actualizado: {formatDateTimeLabel(profile.privateNotes.updatedAt)}
                  </p>
                  <BrandButton onClick={savePrivateNotes} disabled={savingNotes}>
                    <Save className="mr-2 h-4 w-4" />
                    {savingNotes ? "Guardando..." : "Guardar notas"}
                  </BrandButton>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionTitle eyebrow="Nutricion" title="Plan actual y restricciones" />
                  <Link
                    href={`/tools/nutrition-management?athlete=${encodeURIComponent(profile.user.username)}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-brand-text transition hover:bg-white/10"
                  >
                    <Utensils className="h-3.5 w-3.5" />
                    Gestionar
                  </Link>
                </div>

                {nutritionPlans.length ? (
                  <div className="mt-4 space-y-3">
                    {nutritionPlans.map((nutritionPlan) => {
                      const totals = calculatePlanTotals(nutritionPlan);
                      return (
                        <div key={nutritionPlan.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-brand-text">
                                {nutritionPlan.name}
                              </p>
                              <p className="mt-1 text-xs text-brand-muted">
                                Estado: {nutritionPlan.status} | Version {nutritionPlan.versionNumber} |{" "}
                                {nutritionPlan.meals.length} comidas
                              </p>
                            </div>
                            <span className="rounded-lg border border-brand-accent/35 bg-brand-accent/10 px-2 py-1 text-[11px] text-brand-text">
                              {formatNumber(totals.caloriesKcal)} kcal
                            </span>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <MetricCard label="Proteinas" value={formatNumber(totals.proteinG, " g")} />
                            <MetricCard label="Carbos" value={formatNumber(totals.carbsG, " g")} />
                            <MetricCard label="Grasas" value={formatNumber(totals.fatG, " g")} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {nutritionPlan.meals.map((meal) => (
                              <span
                                key={meal.id}
                                className="rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-xs text-brand-muted"
                              >
                                {meal.name}: {meal.entries.length}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-4 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                    No hay planes nutricionales registrados.
                  </p>
                )}

                <div className="mt-4">
                  <p className="text-sm font-semibold text-brand-text">Intolerancias y rechazos</p>
                  {profile.nutrition.restrictions.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {profile.nutrition.restrictions.map((restriction) => (
                        <span
                          key={restriction.id}
                          className="inline-flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-xs text-red-100"
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                          {restriction.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-brand-muted">Sin restricciones registradas.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <SectionTitle eyebrow="Evolucion" title="Peso, medidas y fotos" />
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricCard
                    label="Cintura"
                    value={getRevisionQuestionValue(latestRevision, ["cintura"])}
                    detail="Ultima revision"
                  />
                  <MetricCard
                    label="Cadera"
                    value={getRevisionQuestionValue(latestRevision, ["cadera"])}
                    detail="Ultima revision"
                  />
                  <MetricCard
                    label="Revisiones"
                    value={String(revisionGroups.length)}
                    detail={revisionGroups[0] ? formatDateLabel(revisionGroups[0][0]) : undefined}
                  />
                </div>
                {latestPhotos.length ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                    {latestPhotos.map((item, index) => (
                      <a
                        key={`${item.fecha}-${index}`}
                        href={item.imageUrl ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="overflow-hidden rounded-xl border border-white/10 bg-black/20"
                      >
                        <img
                          src={item.imageUrl ?? ""}
                          alt="Revision"
                          className="aspect-square w-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                    <Camera className="h-4 w-4 text-brand-accent" />
                    Sin fotos registradas.
                  </div>
                )}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <SectionTitle eyebrow="Entreno" title="Rutinas y rendimiento" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MetricCard label="Sesiones" value={String(orderedRoutines.length)} />
                  <MetricCard
                    label="Marcas"
                    value={String(profile.tools.achievements.marks.length)}
                    detail={`${profile.tools.achievements.goals.length} objetivos`}
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {orderedRoutines.slice(0, 5).map((item, index) => (
                    <div
                      key={`${item.timestamp}-${index}`}
                      className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                    >
                      <p className="font-semibold text-brand-text">{item.ejercicio}</p>
                      <p className="mt-1 text-xs text-brand-muted">
                        {formatDateLabel(item.fechaSesion)} | {item.series}x{item.repeticiones} |{" "}
                        {item.pesoKg === null ? "-" : `${item.pesoKg} kg`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <SectionTitle eyebrow="Agenda" title="Competiciones" />
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <MetricCard
                    label="Proxima"
                    value={nextCompetition?.title ?? "-"}
                    detail={nextCompetition ? formatDateLabel(nextCompetition.date) : "Sin fecha"}
                  />
                  <MetricCard
                    label="Total"
                    value={String(profile.tools.competitions.length)}
                    detail="Eventos registrados"
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {profile.tools.competitions
                    .slice()
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .slice(0, 5)
                    .map((item) => (
                      <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-sm font-semibold text-brand-text">{item.title}</p>
                        <p className="mt-1 text-xs text-brand-muted">
                          {formatDateLabel(item.date)} {item.location ? `| ${item.location}` : ""}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionTitle eyebrow="Finanzas" title="Estado financiero" />
                  <Link
                    href="/tools/finance"
                    className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs text-brand-text transition hover:bg-white/10"
                  >
                    <WalletCards className="h-3.5 w-3.5" />
                    Gestionar
                  </Link>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <MetricCard
                    label="Contratos activos"
                    value={String(profile.finance.summary.activeContractsCount)}
                  />
                  <MetricCard
                    label="Pendiente"
                    value={formatCents(profile.finance.summary.pendingCents)}
                    detail={`${profile.finance.summary.overdueCount} vencidos`}
                  />
                  <MetricCard label="Pagado" value={formatCents(profile.finance.summary.paidCents)} />
                  <MetricCard
                    label="Proximo pago"
                    value={
                      profile.finance.summary.nextPayment
                        ? formatCents(profile.finance.summary.nextPayment.expectedAmountCents)
                        : "-"
                    }
                    detail={
                      profile.finance.summary.nextPayment
                        ? formatDateLabel(profile.finance.summary.nextPayment.dueDate)
                        : undefined
                    }
                  />
                </div>
                <div className="mt-4 space-y-2">
                  {profile.finance.payments
                    .slice()
                    .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
                    .slice(0, 5)
                    .map((payment) => {
                      const status = getComputedPaymentStatus(payment, today);
                      return (
                        <div
                          key={payment.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
                        >
                          <span className="text-brand-muted">{formatDateLabel(payment.dueDate)}</span>
                          <span className="font-semibold text-brand-text">
                            {formatCents(payment.expectedAmountCents)}
                          </span>
                          <span
                            className={
                              status === "paid"
                                ? "text-emerald-200"
                                : status === "overdue"
                                  ? "text-red-200"
                                  : "text-brand-muted"
                            }
                          >
                            {status}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
                <SectionTitle eyebrow="Documentos" title="PDFs y planes definidos" />
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {profile.nutrition.plans.slice(0, 6).map((plan) => (
                    <div key={plan.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-brand-text">{plan.name}</p>
                          <p className="mt-1 text-xs text-brand-muted">
                            {plan.status} | {plan.meals.length} comidas
                          </p>
                        </div>
                        <ClipboardList className="h-4 w-4 shrink-0 text-brand-accent" />
                      </div>
                    </div>
                  ))}
                  {profile.nutrition.pdfs.slice(0, 6).map((pdf) => (
                    <a
                      key={pdf.id}
                      href={`/api/nutrition-plans/${pdf.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-white/10 bg-black/20 p-3 transition hover:bg-white/10"
                    >
                      <div className="flex items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-brand-accent" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-brand-text">{pdf.name}</p>
                          <p className="mt-1 text-xs text-brand-muted">
                            {formatDateLabel(pdf.modifiedTime ?? pdf.createdTime)}
                          </p>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </MotionPage>
  );
}
