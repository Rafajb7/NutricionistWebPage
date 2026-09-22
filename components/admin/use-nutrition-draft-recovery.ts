"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getBrowserNutritionDraftStorage,
  listNutritionDraftRecoveries,
  readNutritionDraftRecovery,
  removeNutritionDraftRecovery,
  writeNutritionDraftRecovery,
  type NutritionDraftRecovery,
} from "@/lib/nutrition/draft-recovery";
import type { NutritionPlanFull } from "@/lib/nutrition/types";

export function useNutritionDraftRecovery(adminUsername: string) {
  const sessionId = useRef("");
  const warned = useRef(false);
  const [drafts, setDrafts] = useState<NutritionDraftRecovery[]>([]);
  const [backupUnavailable, setBackupUnavailable] = useState(false);

  const refreshDrafts = useCallback(() => {
    const result = listNutritionDraftRecoveries(getBrowserNutritionDraftStorage(), adminUsername);
    setDrafts(result.drafts);
    if (!result.available) setBackupUnavailable(true);
  }, [adminUsername]);

  useEffect(() => {
    refreshDrafts();
    window.addEventListener("storage", refreshDrafts);
    window.addEventListener("focus", refreshDrafts);
    return () => {
      window.removeEventListener("storage", refreshDrafts);
      window.removeEventListener("focus", refreshDrafts);
    };
  }, [refreshDrafts]);

  const protectDraft = useCallback((plan: NutritionPlanFull): NutritionDraftRecovery | null => {
    if (!sessionId.current) sessionId.current = crypto.randomUUID();
    const storage = getBrowserNutritionDraftStorage();
    const existing = readNutritionDraftRecovery(storage, adminUsername, plan.id, sessionId.current);
    if (existing && JSON.stringify(existing.plan) === JSON.stringify(plan)) {
      setBackupUnavailable(false);
      return existing;
    }
    const result = writeNutritionDraftRecovery(storage, adminUsername, sessionId.current, plan);
    if (!result.ok) {
      setBackupUnavailable(true);
      if (!warned.current) {
        warned.current = true;
        toast.error("No se pudo crear la copia local. Descarga una copia del borrador antes de cerrar esta pagina.");
      }
      return null;
    }
    warned.current = false;
    setBackupUnavailable(false);
    refreshDrafts();
    return result.draft;
  }, [adminUsername, refreshDrafts]);

  const removeDraft = useCallback((draft: NutritionDraftRecovery) => {
    removeNutritionDraftRecovery(getBrowserNutritionDraftStorage(), draft);
    refreshDrafts();
  }, [refreshDrafts]);

  const removePlanDrafts = useCallback((planId: string) => {
    const storage = getBrowserNutritionDraftStorage();
    for (const draft of listNutritionDraftRecoveries(storage, adminUsername).drafts) {
      if (draft.plan.id === planId) removeNutritionDraftRecovery(storage, draft);
    }
    refreshDrafts();
  }, [adminUsername, refreshDrafts]);

  return { drafts, backupUnavailable, sessionId, protectDraft, removeDraft, removePlanDrafts };
}
