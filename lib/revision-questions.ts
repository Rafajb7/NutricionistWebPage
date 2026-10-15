import type { AthleteSex } from "@/lib/athlete-profile";

export const WEIGHT_AVERAGE_QUESTION = "PESO MEDIO SEMANAL (KG)";
export const STEPS_AVERAGE_QUESTION = "NUMERO DE PASOS";

export type RevisionQuestion = {
  title: string;
  help: string;
  type: "text" | "menstrual_cycle" | "weight" | "steps";
};
export type SheetRevisionQuestion = RevisionQuestion & { type: "text" | "menstrual_cycle" };

function questionKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// A: question, B: help text, C: texto / ciclo_menstrual. Existing A-only
// sheets remain valid. An optional Pregunta | Ayuda | Tipo header is skipped.
export function parseRevisionQuestionRows(rows: unknown[][]): SheetRevisionQuestion[] {
  return rows.flatMap((row, index) => {
    const title = String(row[0] ?? "").trim();
    const help = String(row[1] ?? "").trim();
    const rawType = questionKey(String(row[2] ?? ""));
    if (!title) return [];
    if (index === 0 && questionKey(title) === "pregunta" && rawType === "tipo") return [];
    if (!["", "texto", "ciclo_menstrual"].includes(rawType)) {
      throw new Error(
        `Tipo de pregunta no válido en la fila ${index + 1}: usa texto o ciclo_menstrual.`
      );
    }
    return [
      {
        title,
        help,
        type: rawType === "ciclo_menstrual" ? ("menstrual_cycle" as const) : ("text" as const)
      }
    ];
  });
}

export function buildRevisionQuestions(
  sheetQuestions: SheetRevisionQuestion[],
  sex: AthleteSex
): RevisionQuestion[] {
  const reserved = new Set([WEIGHT_AVERAGE_QUESTION, STEPS_AVERAGE_QUESTION].map(questionKey));
  return [
    { title: WEIGHT_AVERAGE_QUESTION, help: "", type: "weight" },
    { title: STEPS_AVERAGE_QUESTION, help: "", type: "steps" },
    ...sheetQuestions.filter(
      (question) =>
        question.title.trim() &&
        !reserved.has(questionKey(question.title)) &&
        (question.type !== "menstrual_cycle" || sex === "female")
    )
  ];
}
