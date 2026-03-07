export const STRENGTH_EXERCISES = [
  "Sentadilla",
  "Press de banca",
  "Peso muerto",
  "Pasos diarios"
] as const;

export type StrengthExercise = (typeof STRENGTH_EXERCISES)[number];

export function isStrengthExercise(value: string): value is StrengthExercise {
  return STRENGTH_EXERCISES.includes(value as StrengthExercise);
}

export const DAILY_STEPS_EXERCISE = "Pasos diarios" as const;

export function isDailyStepsExercise(value: string): value is typeof DAILY_STEPS_EXERCISE {
  return value === DAILY_STEPS_EXERCISE;
}
