export const STRENGTH_EXERCISES = [
  "Sentadilla",
  "Press de banca",
  "Peso muerto"
] as const;

export type StrengthExercise = (typeof STRENGTH_EXERCISES)[number];

export function isStrengthExercise(value: string): value is StrengthExercise {
  return STRENGTH_EXERCISES.includes(value as StrengthExercise);
}
