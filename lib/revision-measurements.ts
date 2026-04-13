export type RevisionMeasurementKey =
  | "CINTURA"
  | "CADERA"
  | "BRAZO_RELAJADO"
  | "BRAZO_FLEXIONADO"
  | "MUSLO";

function normalizeQuestionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function getRevisionMeasurementKey(question: string): RevisionMeasurementKey | null {
  const normalized = normalizeQuestionKey(question);
  const withoutCmSuffix = normalized.replace(/CM$/, "");

  if (withoutCmSuffix.includes("BRAZO") && withoutCmSuffix.includes("RELAJADO")) {
    return "BRAZO_RELAJADO";
  }

  if (withoutCmSuffix.includes("BRAZO") && withoutCmSuffix.includes("FLEXIONADO")) {
    return "BRAZO_FLEXIONADO";
  }

  if (withoutCmSuffix.includes("CINTURA")) return "CINTURA";
  if (withoutCmSuffix.includes("CADERA")) return "CADERA";
  if (withoutCmSuffix.includes("MUSLO")) return "MUSLO";

  return null;
}

export function isRevisionMeasurementQuestion(question: string): boolean {
  return getRevisionMeasurementKey(question) !== null;
}

export function parseRevisionMeasurementValue(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  if (value <= 0 || value > 1000) return null;
  return value;
}

export function formatRevisionMeasurementForSheet(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

export function normalizeRevisionMeasurementAnswer(raw: string): string {
  const parsed = parseRevisionMeasurementValue(raw);
  if (parsed === null) return "";
  return formatRevisionMeasurementForSheet(parsed);
}
