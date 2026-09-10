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
  formula?: EnergyFormula;
  formulas?: EnergyFormula[];
  referenceDate?: Date;
};

export type EnergyFormulaResult = {
  formula: EnergyFormula;
  label: string;
  bmrKcal: number;
  tdeeKcal: number;
};

export type EnergyCalculationResult = {
  age: number | null;
  sex: AthleteSex;
  weightKg: number | null;
  heightCm: number | null;
  bodyFatPercent: number | null;
  leanMassKg: number | null;
  formula: EnergyFormula;
  formulas: EnergyFormula[];
  usedFormulas: EnergyFormula[];
  formulaResults: EnergyFormulaResult[];
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

export function getDefaultEnergyFormulas(bodyFatPercent: number | null): EnergyFormula[] {
  return [getDefaultEnergyFormula(bodyFatPercent)];
}

export function getEnergyFormulaLabel(formula: EnergyFormula): string {
  return ENERGY_FORMULA_OPTIONS.find((option) => option.value === formula)?.label ?? formula;
}

export function getEnergyFormulaSelectionLabel(formulas: EnergyFormula[]): string {
  const validFormulas: EnergyFormula[] = formulas.length ? formulas : ["mifflin_st_jeor"];
  if (validFormulas.length === 1) return getEnergyFormulaLabel(validFormulas[0]);
  return `Media de ${validFormulas.length} formulas`;
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function isBodyFatFormula(formula: EnergyFormula): boolean {
  return formula === "cunningham" || formula === "katch_mcardle";
}

function normalizeFormulaSelection(input: EnergyCalculationInput): EnergyFormula[] {
  const rawFormulas = input.formulas?.length
    ? input.formulas
    : input.formula
      ? [input.formula]
      : [getDefaultEnergyFormula(input.bodyFatPercent)];
  const allowed = new Set(ENERGY_FORMULA_OPTIONS.map((option) => option.value));
  const unique = rawFormulas.filter(
    (formula, index, list) => allowed.has(formula) && list.indexOf(formula) === index
  );
  return unique.length ? unique : [getDefaultEnergyFormula(input.bodyFatPercent)];
}

function calculateBmrForFormula(input: {
  formula: EnergyFormula;
  sex: AthleteSex;
  age: number;
  weightKg: number;
  heightCm: number;
  leanMassKg: number | null;
}): number {
  if (input.formula === "cunningham") {
    return 500 + 22 * (input.leanMassKg as number);
  }
  if (input.formula === "katch_mcardle") {
    return 370 + 21.6 * (input.leanMassKg as number);
  }
  if (input.formula === "harris_benedict_revised") {
    return input.sex === "male"
      ? 88.362 + 13.397 * input.weightKg + 4.799 * input.heightCm - 5.677 * input.age
      : 447.593 + 9.247 * input.weightKg + 3.098 * input.heightCm - 4.33 * input.age;
  }
  return input.sex === "male"
    ? 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + 5
    : 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age - 161;
}

export function calculateEnergyNeeds(input: EnergyCalculationInput): EnergyCalculationResult {
  const age = calculateAgeFromBirthDate(input.birthDate, input.referenceDate);
  const weightKg = input.weightKg;
  const heightCm = input.heightCm;
  const bodyFatPercent = input.bodyFatPercent;
  const pal = input.pal;
  const selectedFormulas = normalizeFormulaSelection(input);
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
  const hasBodyFat = hasValidBodyFatPercent(bodyFatPercent);
  const usableFormulas = selectedFormulas.filter(
    (formula) => !isBodyFatFormula(formula) || hasBodyFat
  );
  if (!usableFormulas.length) {
    errors.push("% grasa corporal valido para esta formula");
  }
  if (usableFormulas.length < selectedFormulas.length) {
    warnings.push("Se han omitido formulas que requieren % de grasa valido.");
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
      formula: usableFormulas[0] ?? selectedFormulas[0],
      formulas: selectedFormulas,
      usedFormulas: [],
      formulaResults: [],
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

  const formulaResults = usableFormulas.map((formula) => {
    const bmrKcal = round(
      calculateBmrForFormula({
        formula,
        sex: input.sex,
        age: resolvedAge,
        weightKg: resolvedWeight,
        heightCm: resolvedHeight,
        leanMassKg: resolvedLeanMass
      }),
      0
    );
    return {
      formula,
      label: getEnergyFormulaLabel(formula),
      bmrKcal,
      tdeeKcal: round(bmrKcal * resolvedPal, 0)
    };
  });

  const averageBmr = round(
    formulaResults.reduce((sum, item) => sum + item.bmrKcal, 0) / formulaResults.length,
    0
  );
  return {
    age,
    sex: input.sex,
    weightKg,
    heightCm,
    bodyFatPercent,
    leanMassKg,
    formula: usableFormulas[0],
    formulas: selectedFormulas,
    usedFormulas: usableFormulas,
    formulaResults,
    pal,
    bmrKcal: averageBmr,
    tdeeKcal: round(averageBmr * resolvedPal, 0),
    errors,
    warnings
  };
}
