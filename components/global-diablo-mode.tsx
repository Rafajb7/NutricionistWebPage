"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Flame, Shield } from "lucide-react";
import { getCompetitionMode, type CompetitionMode } from "@/lib/competition-mode";

type CompetitionEvent = {
  date: string;
};

type CompetitionsResponse = {
  events?: CompetitionEvent[];
};

export function GlobalDiabloMode() {
  const pathname = usePathname();
  const [mode, setMode] = useState<CompetitionMode>("none");

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
