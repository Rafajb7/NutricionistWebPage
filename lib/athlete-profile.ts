export type AthleteSex = "" | "male" | "female";

export function normalizeAthleteSex(value: unknown): AthleteSex {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (["male", "hombre", "masculino", "m", "man"].includes(normalized)) return "male";
  if (["female", "mujer", "femenino", "f", "woman"].includes(normalized)) return "female";
  return "";
}

export function getAthleteSexLabel(value: AthleteSex): string {
  if (value === "male") return "Hombre";
  if (value === "female") return "Mujer";
  return "Sin definir";
}

export function normalizeHeightCm(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const heightCm = value < 3 ? value * 100 : value;
  return Math.round(heightCm * 10) / 10;
}

export function parseHeightCmInput(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed =
    typeof value === "string" ? Number(value.trim().replace(",", ".")) : Number(value);
  return normalizeHeightCm(parsed);
}
