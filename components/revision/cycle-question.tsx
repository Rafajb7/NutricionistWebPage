"use client";

import { useId, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Flower2,
  Moon,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CYCLE_PHASES,
  formatCycleDate,
  localDateKey,
  type CycleDateField,
  type RevisionCycleAnswer
} from "@/lib/revision-cycle";

const phaseIcons = [Droplets, Flower2, Sparkles, Moon];
const dateFields: Array<{
  key: CycleDateField;
  label: string;
  short: string;
  color: string;
  dot: string;
}> = [
  {
    key: "periodStart",
    label: "Inicio",
    short: "I",
    color: "border-rose-400/60 bg-rose-400/15 text-rose-200",
    dot: "bg-rose-400"
  },
  {
    key: "periodEnd",
    label: "Fin previsto",
    short: "F",
    color: "border-violet-400/60 bg-violet-400/15 text-violet-200",
    dot: "bg-violet-400"
  },
  {
    key: "nextPeriodStart",
    label: "Próxima (opcional)",
    short: "P",
    color: "border-amber-300/60 bg-amber-300/15 text-amber-100",
    dot: "bg-amber-300"
  }
];
const fieldClass =
  "mt-2 w-full rounded-xl border border-white/15 bg-[#181818] px-3 py-3 text-sm text-brand-text outline-none focus:border-brand-accent focus:ring-1 focus:ring-brand-accent";

export function CycleQuestion({
  value,
  onChange
}: {
  value: RevisionCycleAnswer;
  onChange: (value: RevisionCycleAnswer) => void;
}) {
  const id = useId();
  const [target, setTarget] = useState<CycleDateField>("periodStart");
  const [month, setMonth] = useState(() => {
    const date = value.periodStart ? new Date(`${value.periodStart}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1, 12);
  });
  const [dateError, setDateError] = useState("");
  const today = localDateKey(new Date());
  const firstWeekday = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const activeDate = dateFields.find((field) => field.key === target)!;
  const applicable = value.phase !== "not-applicable";

  function patch(changes: Partial<RevisionCycleAnswer>) {
    setDateError("");
    onChange({ ...value, ...changes });
  }

  function selectDate(date: string) {
    if (target === "periodStart" && date > today) {
      setDateError("El inicio de la última menstruación no puede estar en el futuro.");
      return;
    }
    if (target === "periodEnd" && value.periodStart && date < value.periodStart) {
      setDateError("Selecciona un fin igual o posterior al inicio.");
      return;
    }
    if (
      target === "nextPeriodStart" &&
      (date < today ||
        (value.periodEnd && date <= value.periodEnd) ||
        (value.periodStart && date <= value.periodStart))
    ) {
      setDateError(
        "Selecciona una fecha de hoy en adelante y posterior a la menstruación registrada."
      );
      return;
    }
    const changes: Partial<RevisionCycleAnswer> = { [target]: date };
    if (target === "periodStart") {
      changes.startUnknown = false;
      // Clear dependent dates when moving the start beyond them.
      if (value.periodEnd && value.periodEnd < date) changes.periodEnd = "";
      if (value.nextPeriodStart && value.nextPeriodStart <= date) changes.nextPeriodStart = "";
      setTarget("periodEnd");
    }
    if (target === "periodEnd") {
      changes.endUnknown = false;
      if (value.nextPeriodStart && value.nextPeriodStart <= date) changes.nextPeriodStart = "";
    }
    patch(changes);
  }

  function changeTarget(key: CycleDateField) {
    setTarget(key);
    setDateError("");
    const date = value[key];
    if (date) {
      const selected = new Date(`${date}T12:00:00`);
      setMonth(new Date(selected.getFullYear(), selected.getMonth(), 1, 12));
    }
  }

  return (
    <div className="mt-5 space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-brand-text">Tu fase actual</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CYCLE_PHASES.slice(0, 4).map((phase, index) => {
            const Icon = phaseIcons[index];
            const selected = value.phase === phase.value;
            return (
              <button
                key={phase.value}
                type="button"
                aria-pressed={selected}
                onClick={() =>
                  patch({
                    phase: phase.value,
                    menstruating: phase.value === "menstrual" ? "yes" : "no"
                  })
                }
                className={cn(
                  "relative flex min-h-24 flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
                  selected
                    ? "border-brand-accent bg-brand-accent/10 text-brand-accent"
                    : "border-white/10 bg-black/20 text-brand-muted hover:border-white/30 hover:text-brand-text"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="font-medium">{phase.label}</span>
                {selected ? (
                  <Check className="absolute right-3 top-3 h-4 w-4" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {CYCLE_PHASES.slice(4).map((phase) => (
            <button
              key={phase.value}
              type="button"
              aria-pressed={value.phase === phase.value}
              onClick={() => patch({ phase: phase.value })}
              className={cn(
                "rounded-full border px-3 py-2 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
                value.phase === phase.value
                  ? "border-brand-accent bg-brand-accent/10 text-brand-accent"
                  : "border-white/15 text-brand-muted hover:text-brand-text"
              )}
            >
              {phase.label}
            </button>
          ))}
        </div>
      </fieldset>

      {applicable ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-brand-muted">
              ¿Estás menstruando actualmente?
              <select
                value={value.menstruating}
                onChange={(event) =>
                  patch({ menstruating: event.target.value as RevisionCycleAnswer["menstruating"] })
                }
                className={fieldClass}
              >
                <option value="">Selecciona una opción</option>
                <option value="yes">Sí</option>
                <option value="no">No</option>
                <option value="unknown">No lo sé</option>
              </select>
            </label>
            <label className="text-sm text-brand-muted">
              Día del ciclo (si lo sabes)
              <input
                type="number"
                min="1"
                max="366"
                step="1"
                inputMode="numeric"
                placeholder="Ej.: 12"
                value={value.cycleDay}
                onChange={(event) => patch({ cycleDay: event.target.value })}
                className={fieldClass}
              />
            </label>
          </div>

          <section
            aria-labelledby={`${id}-calendar-title`}
            className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
          >
            <div className="border-b border-white/10 p-4 sm:p-5">
              <h2
                id={`${id}-calendar-title`}
                className="flex items-center gap-2 text-base font-semibold text-brand-text"
              >
                <CalendarDays className="h-5 w-5 text-brand-accent" aria-hidden="true" /> Tu
                calendario
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-brand-muted">
                Marca el inicio y el fin previsto de tu menstruación actual o de la última. Puedes
                añadir cuándo esperas la próxima.
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {dateFields.map((field) => {
                  const unknown =
                    field.key === "periodStart"
                      ? value.startUnknown
                      : field.key === "periodEnd"
                        ? value.endUnknown
                        : false;
                  return (
                    <button
                      key={field.key}
                      type="button"
                      aria-pressed={target === field.key}
                      aria-label={`Seleccionar ${field.label.toLowerCase()}`}
                      onClick={() => changeTarget(field.key)}
                      className={cn(
                        "rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                        field.color,
                        target === field.key
                          ? "ring-1 ring-current"
                          : "opacity-75 hover:opacity-100"
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium">
                        <span className={cn("h-2 w-2 rounded-full", field.dot)} />
                        {field.label}
                      </span>
                      <span className="mt-1 block text-sm font-semibold">
                        {unknown
                          ? "No lo sé"
                          : value[field.key]
                            ? formatCycleDate(value[field.key])
                            : "Elegir fecha"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="p-3 sm:p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  aria-label="Mes anterior"
                  onClick={() =>
                    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1, 12))
                  }
                  className="rounded-xl p-3 text-brand-muted hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <h3 className="text-sm font-semibold capitalize text-brand-text" aria-live="polite">
                  {month.toLocaleDateString("es-ES", { month: "long", year: "numeric" })}
                </h3>
                <button
                  type="button"
                  aria-label="Mes siguiente"
                  onClick={() =>
                    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12))
                  }
                  className="rounded-xl p-3 text-brand-muted hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand-accent"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
              <p
                className={cn("mb-3 rounded-lg border px-3 py-2 text-xs", activeDate.color)}
                aria-live="polite"
              >
                Seleccionando: <strong>{activeDate.label}</strong>. Pulsa un día del calendario.
              </p>
              <div
                className="grid grid-cols-7 gap-1 text-center text-xs text-brand-muted"
                aria-hidden="true"
              >
                {["L", "M", "X", "J", "V", "S", "D"].map((day) => (
                  <span key={day} className="py-2">
                    {day}
                  </span>
                ))}
              </div>
              <div role="group" aria-label="Días del mes" className="grid grid-cols-7 gap-1">
                {Array.from({ length: cellCount }, (_, index) => {
                  const day = index - firstWeekday + 1;
                  if (day < 1 || day > daysInMonth) return <span key={index} aria-hidden="true" />;
                  const date = localDateKey(
                    new Date(month.getFullYear(), month.getMonth(), day, 12)
                  );
                  const markers = dateFields.filter((field) => value[field.key] === date);
                  const inRange =
                    value.periodStart &&
                    value.periodEnd &&
                    date > value.periodStart &&
                    date < value.periodEnd;
                  const sameDay =
                    markers.some((field) => field.key === "periodStart") &&
                    markers.some((field) => field.key === "periodEnd");
                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => selectDate(date)}
                      aria-pressed={markers.length > 0}
                      aria-current={date === today ? "date" : undefined}
                      aria-label={`${formatCycleDate(date)}${markers.length ? `, ${markers.map((field) => field.label).join(", ")}` : ""}`}
                      className={cn(
                        "relative flex min-h-12 min-w-0 flex-col items-center justify-center rounded-lg border text-sm transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:min-h-14",
                        sameDay
                          ? "border-rose-300/60 bg-gradient-to-br from-rose-400/25 to-violet-400/30 text-white"
                          : (markers[0]?.color ??
                              (inRange
                                ? "border-transparent bg-violet-400/10 text-violet-100"
                                : "border-transparent text-brand-text hover:bg-white/10")),
                        date === today &&
                          "font-bold underline decoration-brand-accent underline-offset-4"
                      )}
                    >
                      {day}
                      {markers.length ? (
                        <span
                          className="flex gap-1 text-[9px] font-bold leading-3"
                          aria-hidden="true"
                        >
                          {markers.map((field) => (
                            <span
                              key={field.key}
                              className={
                                field.key === "periodStart"
                                  ? "text-rose-200"
                                  : field.key === "periodEnd"
                                    ? "text-violet-200"
                                    : "text-amber-100"
                              }
                            >
                              {field.short}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-brand-muted">
                <span>Hoy aparece subrayado · I: inicio · F: fin · P: próxima</span>
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setMonth(new Date(now.getFullYear(), now.getMonth(), 1, 12));
                  }}
                  className="text-brand-accent underline underline-offset-4"
                >
                  Volver a este mes
                </button>
              </div>
              {dateError ? (
                <p role="alert" className="mt-3 text-sm text-rose-200">
                  {dateError}
                </p>
              ) : null}
            </div>
            <div className="space-y-3 border-t border-white/10 p-4 text-sm text-brand-muted sm:p-5">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={value.startUnknown}
                  onChange={(event) => {
                    patch({ startUnknown: event.target.checked, periodStart: "" });
                    if (event.target.checked) setTarget("periodEnd");
                  }}
                  className="h-4 w-4 accent-rose-400"
                />
                No recuerdo cuándo empezó
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={value.endUnknown}
                  onChange={(event) => patch({ endUnknown: event.target.checked, periodEnd: "" })}
                  className="h-4 w-4 accent-violet-400"
                />
                No sé cuándo acabará
              </label>
              {value.nextPeriodStart ? (
                <button
                  type="button"
                  onClick={() => patch({ nextPeriodStart: "" })}
                  className="text-xs text-amber-100 underline underline-offset-4"
                >
                  Quitar fecha de la próxima menstruación
                </button>
              ) : null}
            </div>
          </section>
        </>
      ) : (
        <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
          Se registrará que esta pregunta no aplica. Puedes añadir cualquier detalle que quieras
          compartir.
        </p>
      )}

      <label className="block text-sm text-brand-muted">
        ¿Algo más sobre tu ciclo? (opcional)
        <textarea
          rows={3}
          maxLength={1200}
          value={value.notes}
          onChange={(event) => patch({ notes: event.target.value })}
          placeholder="Síntomas, irregularidades o cualquier detalle que quieras comentar…"
          className={fieldClass}
        />
      </label>
    </div>
  );
}
