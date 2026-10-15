export const CYCLE_PHASES = [
  { value: "menstrual", label: "Menstrual" },
  { value: "follicular", label: "Folicular" },
  { value: "ovulatory", label: "Ovulatoria" },
  { value: "luteal", label: "Lútea" },
  { value: "unknown", label: "No conozco mi fase" },
  { value: "not-applicable", label: "No tengo menstruación / no aplica" }
] as const;

export type CyclePhase = (typeof CYCLE_PHASES)[number]["value"];
export type CycleDateField = "periodStart" | "periodEnd" | "nextPeriodStart";
export type RevisionCycleAnswer = {
  phase: CyclePhase | "";
  cycleDay: string;
  menstruating: "" | "yes" | "no" | "unknown";
  periodStart: string;
  periodEnd: string;
  nextPeriodStart: string;
  startUnknown: boolean;
  endUnknown: boolean;
  notes: string;
};

export function emptyRevisionCycleAnswer(): RevisionCycleAnswer {
  return {
    phase: "",
    cycleDay: "",
    menstruating: "",
    periodStart: "",
    periodEnd: "",
    nextPeriodStart: "",
    startUnknown: false,
    endUnknown: false,
    notes: ""
  };
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isValidCycleDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && localDateKey(date) === value;
}

export function formatCycleDate(value: string): string {
  if (!isValidCycleDate(value)) return "Sin indicar";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function validateRevisionCycleAnswer(
  value: RevisionCycleAnswer,
  today = localDateKey(new Date())
): string | null {
  if (!CYCLE_PHASES.some((phase) => phase.value === value.phase))
    return "Selecciona la fase de tu ciclo o indica que no la conoces.";
  if (value.notes.length > 1200)
    return "Las observaciones del ciclo no pueden superar los 1200 caracteres.";
  if (value.phase === "not-applicable") return null;
  if (!["yes", "no", "unknown"].includes(value.menstruating))
    return "Indica si estás menstruando actualmente.";
  if (
    value.cycleDay &&
    (!/^\d+$/.test(value.cycleDay) || Number(value.cycleDay) < 1 || Number(value.cycleDay) > 366)
  ) {
    return "Indica un día del ciclo entre 1 y 366 o deja ese dato vacío si no lo sabes.";
  }
  if (!value.startUnknown && !isValidCycleDate(value.periodStart))
    return "Selecciona el inicio de la menstruación o indica que no lo recuerdas.";
  if (!value.endUnknown && !isValidCycleDate(value.periodEnd))
    return "Selecciona el fin previsto o indica que aún no lo sabes.";
  if (!value.startUnknown && value.periodStart > today)
    return "El inicio de la última menstruación no puede estar en el futuro.";
  if (!value.startUnknown && !value.endUnknown && value.periodEnd < value.periodStart)
    return "El fin previsto debe ser igual o posterior al inicio.";
  if (value.nextPeriodStart && !isValidCycleDate(value.nextPeriodStart))
    return "Selecciona una fecha válida para la próxima menstruación.";
  if (value.nextPeriodStart && value.nextPeriodStart < today)
    return "La próxima menstruación debe tener una fecha de hoy en adelante.";
  if (value.nextPeriodStart && !value.startUnknown && value.nextPeriodStart <= value.periodStart)
    return "La próxima menstruación debe ser posterior al inicio registrado.";
  if (value.nextPeriodStart && !value.endUnknown && value.nextPeriodStart <= value.periodEnd)
    return "La próxima menstruación debe ser posterior al fin registrado.";
  return null;
}

// Store a readable answer in the existing question/answer row, so both the
// revision history and Google Sheets work without a schema change.
export function formatRevisionCycleAnswer(value: RevisionCycleAnswer): string {
  const phase = CYCLE_PHASES.find((item) => item.value === value.phase)?.label ?? "Sin indicar";
  const lines = [`Fase del ciclo: ${phase}`];
  if (value.phase !== "not-applicable") {
    lines.push(
      `Día del ciclo: ${value.cycleDay || "No lo sé"}`,
      `Menstruando actualmente: ${{ yes: "Sí", no: "No", unknown: "No lo sé", "": "Sin indicar" }[value.menstruating]}`,
      `Inicio de la menstruación: ${value.startUnknown ? "No lo recuerdo" : formatCycleDate(value.periodStart)}`,
      `Fin previsto de la menstruación: ${value.endUnknown ? "No lo sé" : formatCycleDate(value.periodEnd)}`,
      `Próxima menstruación prevista: ${value.nextPeriodStart ? formatCycleDate(value.nextPeriodStart) : "No lo sé"}`
    );
  }
  if (value.notes.trim()) lines.push(`Observaciones: ${value.notes.trim()}`);
  return lines.join("\n");
}
