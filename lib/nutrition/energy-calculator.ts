import type { AthleteSex } from "@/lib/athlete-profile";

export type EnergyFormula =
  | "mifflin_st_jeor"
  | "cunningham"
  | "katch_mcardle"
  | "harris_benedict_revised";

export type EnergyCalculationInput = {
  birthDate: string;
  sex: AthleteSex;
  weightKg: number | null;
  heightCm: number | null;
  bodyFatPercent: number | null;
  pal: number | null;
  formula: EnergyFormula;
  referenceDate?: Date;
};

export type EnergyCalculationResult = {
  age: number | null;
  sex: AthleteSex;
  weightKg: number | null;
  heightCm: number | null;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  formula: EnergyFormula;
  pal: number | null;
  bmrKcal: number | null;
  tdeeKcal: number | null;
  errors: string[];
  warnings: string[];
};

export const ENERGY_FORMULA_OPTIONS: Array<{
  value: EnergyFormula;
  label: string;
  requiresBodyFat: boolean;
}> = [
  { value: "mifflin_st_jeor", label: "Mifflin-St Jeor", requiresBodyFat: false },
  { value: "cunningham", label: "Cunningham", requiresBodyFat: true },
  { value: "katch_mcardle", label: "Katch-McArdle", requiresBodyFat: true },
  {
    value: "harris_benedict_revised",
    label: "Harris-Benedict revisada",
    requiresBodyFat: false
  }
];

export const PAL_OPTIONS = [
  {
    value: 1.2,
    label: "1,20 - reposo / actividad muy baja",
    description: "Actividad diaria minima."
  },
  {
    value: 1.4,
    label: "1,40 - sedentario ligero",
    description: "Trabajo sentado y poca actividad adicional."
  },
  {
    value: 1.55,
    label: "1,55 - ligero activo",
    description: "Movimiento diario y entrenamiento suave."
  },
  {
    value: 1.75,
    label: "1,75 - activo moderado",
    description: "Entrenamiento frecuente o trabajo activo."
  },
  {
    value: 2,
    label: "2,00 - muy activo",
    description: "Carga deportiva alta."
  },
  {
    value: 2.2,
    label: "2,20 - atleta alta carga",
    description: "Doble sesion o NEAT muy elevado."
  },
  {
    value: 2.4,
    label: "2,40 - extremadamente activo",
    description: "Carga extrema sostenida."
  }
] as const;

export function calculateAgeFromBirthDate(
  birthDate: string,
  referenceDate = new Date()
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;

  let age = referenceDate.getFullYear() - birth.getFullYear();
  const monthDiff = referenceDate.getMonth() - birth.getMonth();
  const dayDiff = referenceDate.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) age -= 1;
  return age >= 0 ? age : null;
}

export function hasValidBodyFatPercent(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value <= 100;
}

export function getDefaultEnergyFormula(bodyFatPercent: number | null): EnergyFormula {
  return hasValidBodyFatPercent(bodyFatPercent) ? "cunningham" : "mifflin_st_jeor";
}

export function getEnergyFormulaLabel(formula: EnergyFormula): string {
  return ENERGY_FORMULA_OPTIONS.find((option) => option.value === formula)?.label ?? formula;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isBodyFatFormula(formula: EnergyFormula): boolean {
  return formula === "cunningham" || formula === "katch_mcardle";
}

export function calculateEnergyNeeds(input: EnergyCalculationInput): EnergyCalculationResult {
  const age = calculateAgeFromBirthDate(input.birthDate, input.referenceDate);
  const weightKg = input.weightKg;
  const heightCm = input.heightCm;
  const bodyFatPercent = input.bodyFatPercent;
  const pal = input.pal;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.sex) errors.push("Sexo");
  if (age === null) errors.push("Fecha de nacimiento / edad");
  if (weightKg === null || !Number.isFinite(weightKg) || weightKg <= 0) errors.push("Peso");
  if (heightCm === null || !Number.isFinite(heightCm) || heightCm <= 0) errors.push("Altura");
  if (pal === null || !Number.isFinite(pal) || pal <= 0) errors.push("PAL");
  if (bodyFatPercent !== null && (!Number.isFinite(bodyFatPercent) || bodyFatPercent < 0 || bodyFatPercent > 100)) {
    errors.push("% grasa corporal");
  }
  if (isBodyFatFormula(input.formula) && !hasValidBodyFatPercent(bodyFatPercent)) {
    errors.push("% grasa corporal valido para esta formula");
  }

  if (age !== null && (age < 12 || age > 90)) warnings.push("Edad fuera del rango habitual de trabajo.");
  if (weightKg !== null && Number.isFinite(weightKg) && (weightKg < 30 || weightKg > 250)) {
    warnings.push("Peso fuera de un rango fisiologico habitual.");
  }
  if (heightCm !== null && Number.isFinite(heightCm) && (heightCm < 120 || heightCm > 230)) {
    warnings.push("Altura fuera de un rango fisiologico habitual.");
  }
  if (hasValidBodyFatPercent(bodyFatPercent) && (bodyFatPercent < 3 || bodyFatPercent > 70)) {
    warnings.push("% grasa fuera de un rango fisiologico habitual.");
  }
  if (pal !== null && Number.isFinite(pal) && (pal < 1.2 || pal > 2.4)) {
    warnings.push("PAL fuera del rango recomendado 1,20-2,40.");
  }

  const leanMassKg =
    weightKg !== null && hasValidBodyFatPercent(bodyFatPercent)
      ? round(weightKg * (1 - bodyFatPercent / 100), 1)
      : null;

  if (errors.length) {
    return {
      age,
      sex: input.sex,
      weightKg,
      heightCm,
      bodyFatPercent,
      leanMassKg,
      formula: input.formula,
      pal,
      bmrKcal: null,
      tdeeKcal: null,
      errors,
      warnings
    };
  }

  const resolvedAge = age as number;
  const resolvedWeight = weightKg as number;
  const resolvedHeight = heightCm as number;
  const resolvedPal = pal as number;
  const resolvedLeanMass = leanMassKg as number | null;

  let bmrKcal: number;
  if (input.formula === "cunningham") {
    bmrKcal = 500 + 22 * (resolvedLeanMass as number);
  } else if (input.formula === "katch_mcardle") {
    bmrKcal = 370 + 21.6 * (resolvedLeanMass as number);
  } else if (input.formula === "harris_benedict_revised") {
    bmrKcal =
      input.sex === "male"
        ? 88.362 + 13.397 * resolvedWeight + 4.799 * resolvedHeight - 5.677 * resolvedAge
        : 447.593 + 9.247 * resolvedWeight + 3.098 * resolvedHeight - 4.33 * resolvedAge;
  } else {
    bmrKcal =
      input.sex === "male"
        ? 10 * resolvedWeight + 6.25 * resolvedHeight - 5 * resolvedAge + 5
        : 10 * resolvedWeight + 6.25 * resolvedHeight - 5 * resolvedAge - 161;
  }

  const roundedBmr = round(bmrKcal, 0);
  return {
    age,
    sex: input.sex,
    weightKg,
    heightCm,
    bodyFatPercent,
    leanMassKg,
    formula: input.formula,
    pal,
    bmrKcal: roundedBmr,
    tdeeKcal: round(roundedBmr * resolvedPal, 0),
    errors,
    warnings
  };
}
