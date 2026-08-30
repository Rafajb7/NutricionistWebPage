"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ExternalLink, Flame, Shield } from "lucide-react";
import { toast } from "sonner";
import { getCompetitionMode, type CompetitionMode } from "@/lib/competition-mode";

type CompetitionEvent = {
  date: string;
};

type CompetitionsResponse = {
  events?: CompetitionEvent[];
};

type SessionResponse = {
  authenticated?: boolean;
  user?: {
    permission?: "user" | "admin";
  };
};

type MakingWeightResponse = {
  status?: {
    risk: "critical" | "moderate" | "none";
    cutRatioPercent: number | null;
    competition: {
      id: string;
      title: string;
    };
  } | null;
};

type AdminMakingWeightAlert = {
  username: string;
  athleteName: string;
  competitionId: string;
  competitionTitle: string;
  weighInDate: string;
  daysUntilWeighIn: number | null;
  cutRatioPercent: number | null;
};

type AdminMakingWeightAlertsResponse = {
  alerts?: AdminMakingWeightAlert[];
  today?: string;
};

const ADMIN_MAKING_WEIGHT_ALERTS_SUPPRESSED_KEY = "mat:admin-making-weight-alerts-opened";

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatDaysUntilWeighIn(value: number | null): string {
  if (value === null) return "fecha no disponible";
  if (value > 0) return `${value} dias`;
  if (value === 0) return "hoy";
  return `hace ${Math.abs(value)} dias`;
}

function truncateLabel(value: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function hasAdminMakingWeightAlertSuppression(): boolean {
  try {
    return window.localStorage.getItem(ADMIN_MAKING_WEIGHT_ALERTS_SUPPRESSED_KEY) === "1";
  } catch {
    return false;
  }
}

function suppressAdminMakingWeightAlerts(): void {
  try {
    window.localStorage.setItem(ADMIN_MAKING_WEIGHT_ALERTS_SUPPRESSED_KEY, "1");
  } catch {
    // ignore local storage errors
  }
}

export function GlobalDiabloMode() {
  const pathname = usePathname();
  const [sessionPermission, setSessionPermission] = useState<"user" | "admin" | null>(null);
  const [mode, setMode] = useState<CompetitionMode>("none");
  const [lastMakingWeightToastKey, setLastMakingWeightToastKey] = useState("");
  const lastAdminMakingWeightToastKeyRef = useRef("");

  const refresh = useCallback(async () => {
    if (sessionPermission !== "user") {
      setMode("none");
      return;
    }
    try {
      const res = await fetch("/api/tools/competitions", { cache: "no-store" });
      if (!res.ok) {
        setMode("none");
        return;
      }

      const json = (await res.json()) as CompetitionsResponse;
      const events = Array.isArray(json.events) ? json.events : [];
      setMode(getCompetitionMode(events));
    } catch {
      setMode("none");
    }
  }, [sessionPermission]);

  useEffect(() => {
    let active = true;
    async function loadSession() {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (!res.ok) {
          if (active) setSessionPermission(null);
          return;
        }
        const json = (await res.json()) as SessionResponse;
        if (!active) return;
        setSessionPermission(json.user?.permission === "admin" ? "admin" : "user");
      } catch {
        if (active) setSessionPermission(null);
      }
    }
    void loadSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    let active = true;
    async function refreshMakingWeight() {
      if (sessionPermission !== "user") return;
      try {
        const res = await fetch("/api/tools/making-weight", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as MakingWeightResponse;
        const status = json.status;
        if (!active || !status || status.risk === "none") return;
        const key = `${pathname}:${status.competition.id}:${status.risk}:${status.cutRatioPercent ?? 0}`;
        if (key === lastMakingWeightToastKey) return;
        setLastMakingWeightToastKey(key);
        const message = `Making Weight: ${
          status.risk === "critical" ? "riesgo critico" : "riesgo moderado"
        } para ${status.competition.title} (${formatPercent(status.cutRatioPercent)} de corte).`;
        if (status.risk === "critical") {
          toast.error(message);
        } else {
          toast.warning(message);
        }
      } catch {
        // The visual competition mode should remain independent from this advisory alert.
      }
    }
    void refreshMakingWeight();
    return () => {
      active = false;
    };
  }, [lastMakingWeightToastKey, pathname, sessionPermission]);

  useEffect(() => {
    if (sessionPermission !== "admin") return;
    let active = true;

    async function refreshAdminMakingWeightAlerts() {
      if (hasAdminMakingWeightAlertSuppression()) return;

      try {
        const res = await fetch("/api/admin/making-weight-alerts", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as AdminMakingWeightAlertsResponse;
        const alerts = Array.isArray(json.alerts) ? json.alerts : [];
        if (!active || !alerts.length) return;

        const key = `${json.today ?? ""}:${alerts
          .map((alert) => `${alert.username}:${alert.competitionId}:${alert.cutRatioPercent ?? 0}`)
          .join("|")}`;
        if (lastAdminMakingWeightToastKeyRef.current === key) return;
        lastAdminMakingWeightToastKeyRef.current = key;

        const visibleAlerts = alerts.slice(0, 3);
        const hiddenCount = alerts.length - visibleAlerts.length;
        const description = [
          ...visibleAlerts.map(
            (alert) =>
              `${truncateLabel(alert.athleteName, 24)}: ${formatPercent(alert.cutRatioPercent)} | ${formatDaysUntilWeighIn(
                alert.daysUntilWeighIn
              )} | ${truncateLabel(alert.competitionTitle, 22)}`
          ),
          hiddenCount > 0 ? `+${hiddenCount} atletas mas en estado critico.` : ""
        ]
          .filter(Boolean)
          .join("\n");

        toast.custom(
          (toastId) => (
            <div className="w-[min(330px,calc(100vw-1.25rem))] rounded-xl border border-red-400/35 bg-brand-surface p-3 text-brand-text shadow-[0_14px_32px_-20px_rgba(248,113,113,0.75)]">
              <div className="flex items-start gap-2.5">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-300/35 bg-red-500/15 text-red-100">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-red-100">
                    {alerts.length === 1
                      ? "Atleta critico en Making Weight"
                      : "Atletas criticos en Making Weight"}
                  </p>
                  <p className="mt-1.5 max-h-24 overflow-hidden whitespace-pre-line break-words text-[11px] leading-4 text-brand-muted">
                    {description}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    suppressAdminMakingWeightAlerts();
                    toast.dismiss(toastId);
                    window.location.href = `/tools/athlete-profile/${encodeURIComponent(
                      alerts[0].username
                    )}`;
                  }}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-brand-accent px-3 py-1.5 text-[11px] font-semibold text-black shadow-[0_8px_25px_-12px_rgba(247,204,47,0.75)] transition-colors hover:bg-[#ffe169] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/70"
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  {alerts.length === 1 ? "Abrir ficha" : "Abrir primero"}
                </button>
              </div>
            </div>
          ),
          {
            duration: 15_000
          }
        );
      } catch {
        // This advisory alert should never block the rest of the application.
      }
    }

    void refreshAdminMakingWeightAlerts();
    return () => {
      active = false;
    };
  }, [sessionPermission]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 60_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refresh]);

  useEffect(() => {
    const handleRefresh = () => {
      void refresh();
    };
    window.addEventListener("competition-mode:refresh", handleRefresh);
    window.addEventListener("diablo-mode:refresh", handleRefresh);
    return () => {
      window.removeEventListener("competition-mode:refresh", handleRefresh);
      window.removeEventListener("diablo-mode:refresh", handleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    const root = document.documentElement;
    if (mode !== "none") {
      root.dataset.brandTheme = mode;
      return;
    }
    delete root.dataset.brandTheme;
  }, [mode]);

  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.brandTheme;
    };
  }, []);

  if (mode === "none") return null;

  const isDiablo = mode === "diablo";

  return (
    <div
      className={
        isDiablo
          ? "fixed left-1/2 top-4 z-50 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-red-300/40 bg-red-800/90 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur"
          : "fixed left-1/2 top-4 z-50 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-violet-300/40 bg-violet-800/90 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur"
      }
    >
      <span className="inline-flex items-center justify-center gap-2">
        {isDiablo ? <Flame className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
        {isDiablo ? "El modo diablo ha sido activado" : "El modo titan ha sido activado"}
      </span>
    </div>
  );
}
