"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";

type CompetitionEvent = {
  date: string;
};

type CompetitionsResponse = {
  events?: CompetitionEvent[];
};

function toDaysUntil(date: string): number | null {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function shouldEnableDiabloMode(events: CompetitionEvent[]): boolean {
  return events.some((event) => {
    const daysUntil = toDaysUntil(event.date);
    return daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;
  });
}

export function GlobalDiabloMode() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/tools/competitions", { cache: "no-store" });
      if (!res.ok) {
        setEnabled(false);
        return;
      }

      const json = (await res.json()) as CompetitionsResponse;
      const events = Array.isArray(json.events) ? json.events : [];
      setEnabled(shouldEnableDiabloMode(events));
    } catch {
      setEnabled(false);
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
    window.addEventListener("diablo-mode:refresh", handleRefresh);
    return () => {
      window.removeEventListener("diablo-mode:refresh", handleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    const root = document.documentElement;
    if (enabled) {
      root.dataset.brandTheme = "diablo";
      return;
    }
    delete root.dataset.brandTheme;
  }, [enabled]);

  useEffect(() => {
    return () => {
      delete document.documentElement.dataset.brandTheme;
    };
  }, []);

  if (!enabled) return null;

  return (
    <div className="fixed left-1/2 top-4 z-50 w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 rounded-xl border border-red-300/40 bg-red-800/90 px-4 py-3 text-center text-sm font-semibold text-white shadow-xl backdrop-blur">
      <span className="inline-flex items-center justify-center gap-2">
        <Flame className="h-4 w-4" />
        El modo diablo ha sido activado
      </span>
    </div>
  );
}

