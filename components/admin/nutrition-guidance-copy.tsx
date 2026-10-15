"use client";

import { useId, useMemo, useState } from "react";
import { Copy, X } from "lucide-react";
import { parseGuidanceEntries, serializeGuidanceEntries } from "@/lib/nutrition/guidance";
import type { NutritionPlanSummary } from "@/lib/nutrition/types";

export type NutritionGuidanceCopySource = {
  field: "notes" | "supplementation" | "recommendations";
  athleteUsername: string;
  plans: NutritionPlanSummary[];
};

function usernameKey(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function NutritionGuidanceCopy({
  title,
  source,
  hasContent,
  disabled,
  onCopy
}: {
  title: string;
  source: NutritionGuidanceCopySource;
  hasContent: boolean;
  disabled: boolean;
  onCopy: (value: string) => void;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [copied, setCopied] = useState(false);
  const { plans, field, athleteUsername } = source;
  const availablePlans = useMemo(
    () =>
      plans
        .filter(
          (plan) =>
            usernameKey(plan.athleteUsername) &&
            usernameKey(plan.athleteUsername) !== usernameKey(athleteUsername) &&
            parseGuidanceEntries(plan[field] ?? "").length > 0
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [plans, field, athleteUsername]
  );
  const users = useMemo(() => {
    const grouped = new Map<string, string>();
    for (const plan of availablePlans) {
      const key = usernameKey(plan.athleteUsername);
      if (!grouped.has(key)) grouped.set(key, plan.athleteName.trim() || key);
    }
    return Array.from(grouped, ([username, name]) => ({ username, name })).sort((a, b) =>
      a.name.localeCompare(b.name, "es")
    );
  }, [availablePlans]);
  const userPlans = availablePlans.filter(
    (plan) => usernameKey(plan.athleteUsername) === selectedUsername
  );
  const selectedPlan = userPlans.find((plan) => plan.id === selectedPlanId);
  const entries = parseGuidanceEntries(selectedPlan?.[field] ?? "");
  const copyValue = serializeGuidanceEntries(entries);
  const tooLong = copyValue.length > 3000;
  const canCopy = !disabled && Boolean(selectedPlan) && Boolean(copyValue) && !tooLong;
  const selectClass =
    "mt-1.5 w-full min-w-0 rounded-lg border border-white/15 bg-[#181818] px-2.5 py-2.5 text-sm text-brand-text outline-none focus:border-brand-accent/60 disabled:opacity-50";

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-label={`Copiar ${title} de otro usuario`}
        aria-expanded={open && !disabled}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
          setCopied(false);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-accent/30 bg-brand-accent/5 px-2.5 py-2 text-xs font-semibold text-brand-text transition hover:bg-brand-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {open && !disabled ? <X className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {open && !disabled ? "Cerrar copia" : "Copiar de otro usuario"}
      </button>

      {open && !disabled ? (
        <div
          id={panelId}
          role="region"
          aria-label={`Copiar ${title}`}
          className="mt-3 space-y-3 rounded-xl border border-brand-accent/25 bg-brand-accent/5 p-3"
        >
          {users.length ? (
            <>
              <p className="text-xs leading-relaxed text-brand-muted">
                Elige el usuario y el plan del que quieres copiar este apartado.
              </p>
              <label className="block text-xs text-brand-muted">
                Usuario de origen
                <select
                  aria-label={`Usuario de origen para ${title}`}
                  value={
                    users.some((user) => user.username === selectedUsername) ? selectedUsername : ""
                  }
                  onChange={(event) => {
                    const username = event.target.value;
                    setSelectedUsername(username);
                    setSelectedPlanId(
                      availablePlans.find((plan) => usernameKey(plan.athleteUsername) === username)
                        ?.id ?? ""
                    );
                  }}
                  className={selectClass}
                >
                  <option value="">Selecciona un usuario</option>
                  {users.map((user) => (
                    <option key={user.username} value={user.username}>
                      {user.name} (@{user.username})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-brand-muted">
                Plan de origen
                <select
                  aria-label={`Plan de origen para ${title}`}
                  value={selectedPlan?.id ?? ""}
                  disabled={!userPlans.length}
                  onChange={(event) => setSelectedPlanId(event.target.value)}
                  className={selectClass}
                >
                  <option value="">Selecciona un plan</option>
                  {userPlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {plan.status === "published" ? "Publicado" : "En revisión"}
                    </option>
                  ))}
                </select>
              </label>
              {selectedPlan ? (
                <div
                  aria-label={`Vista previa de ${title}`}
                  className="rounded-lg border border-white/10 bg-black/20 p-3"
                >
                  <p className="mb-2 text-xs font-semibold text-brand-text">
                    Contenido que se copiará
                  </p>
                  <ul className="max-h-48 list-disc space-y-1.5 overflow-y-auto break-words pl-4 text-xs leading-relaxed text-brand-muted marker:text-brand-accent">
                    {entries.map((entry, index) => (
                      <li key={index}>{entry}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {tooLong ? (
                <p role="alert" className="text-xs text-rose-200">
                  Este apartado supera el límite de 3000 caracteres. Reduce su contenido en el plan
                  de origen antes de copiarlo.
                </p>
              ) : null}
              {selectedPlan && hasContent ? (
                <p className="text-xs text-brand-muted">
                  El contenido actual de {title.toLowerCase()} se sustituirá por el de la vista
                  previa.
                </p>
              ) : null}
              <button
                type="button"
                aria-label={`Aplicar copia de ${title}`}
                disabled={!canCopy}
                onClick={() => {
                  if (!canCopy) return;
                  onCopy(copyValue);
                  setOpen(false);
                  setCopied(true);
                }}
                className="w-full rounded-lg bg-brand-accent px-3 py-2.5 text-xs font-semibold text-black transition hover:bg-[#ffe169] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {hasContent ? "Reemplazar" : "Copiar"} {title.toLowerCase()}
              </button>
            </>
          ) : (
            <p className="text-xs leading-relaxed text-brand-muted">
              No hay contenido de {title.toLowerCase()} disponible en planes de otros usuarios.
            </p>
          )}
        </div>
      ) : null}
      {copied && !disabled ? (
        <p role="status" className="mt-2 text-xs text-brand-accent">
          Copia aplicada a {title.toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}
