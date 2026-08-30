"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Flame, Shield } from "lucide-react";
import { toast } from "sonner";
import { getCompetitionMode, type CompetitionMode } from "@/lib/competition-mode";

type CompetitionEvent = {
  date: string;
};

type CompetitionsResponse = {
  events?: CompetitionEvent[];
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

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function GlobalDiabloMode() {
  const pathname = usePathname();
  const [mode, setMode] = useState<CompetitionMode>("none");
  const [lastMakingWeightToastKey, setLastMakingWeightToastKey] = useState("");

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    let active = true;
    async function refreshMakingWeight() {
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
  }, [lastMakingWeightToastKey, pathname]);

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
