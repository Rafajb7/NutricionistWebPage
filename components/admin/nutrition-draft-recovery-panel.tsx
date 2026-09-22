"use client";

import type { NutritionDraftRecovery } from "@/lib/nutrition/draft-recovery";

export function NutritionDraftRecoveryPanel(props: {
  drafts: NutritionDraftRecovery[];
  disabled: boolean;
  canDownload: boolean;
  backupUnavailable: boolean;
  error: string | null;
  onRestore: (draft: NutritionDraftRecovery) => void;
  onDiscard: (draft: NutritionDraftRecovery) => void;
  onDownload: () => void;
  onImport: (file: File | undefined) => void;
}) {
  const buttonClass = "rounded-lg border border-white/20 px-3 py-2 text-sm text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <section aria-label="Recuperacion de borradores" className="space-y-3 rounded-2xl border border-white/10 bg-brand-surface/70 p-4">
      {props.error ? <p role="alert" className="text-sm text-amber-200">{props.error}</p> : null}
      {props.backupUnavailable ? (
        <p role="alert" className="text-sm text-amber-200">
          No se puede guardar una copia en este navegador. Descarga una copia antes de cerrar la pagina.
        </p>
      ) : null}
      {props.drafts.map((draft) => (
        <div key={`${draft.plan.id}:${draft.sessionId}`} className="rounded-xl border border-amber-300/25 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-brand-text">Hay un borrador pendiente de guardar. ¿Deseas recuperarlo?</p>
          <p className="mt-1 text-sm text-brand-muted">
            {draft.plan.name || "Plan sin nombre"} · {draft.plan.athleteName || draft.plan.athleteUsername}
            {" · "}{new Date(draft.savedAt).toLocaleString("es-ES")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={props.disabled} onClick={() => props.onRestore(draft)}>Recuperar borrador</button>
            <button type="button" className={buttonClass} disabled={props.disabled} onClick={() => {
              if (window.confirm("¿Descartar esta copia local del borrador? No se podra recuperar.")) props.onDiscard(draft);
            }}>Descartar copia</button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} disabled={!props.canDownload} onClick={props.onDownload}>Descargar copia del borrador</button>
        <label className={`${buttonClass} ${props.disabled ? "opacity-50" : "cursor-pointer"}`}>
          Importar copia
          <input type="file" accept=".json,application/json" className="sr-only" disabled={props.disabled}
            onChange={(event) => {
              props.onImport(event.target.files?.[0]);
              event.target.value = "";
            }} />
        </label>
        <p className="text-xs text-brand-muted">La recuperacion automatica esta disponible en este navegador. La copia descargada permite trasladar el borrador.</p>
      </div>
    </section>
  );
}
