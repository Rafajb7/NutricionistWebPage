import type { SheetRevisionQuestion } from "@/lib/revision-questions";

// Test data only: production question text must come from Sheets.
export const CYCLE_QUESTION = "Mi ciclo: texto editable desde la hoja";
export const WEEKLY_REVIEW_QUESTIONS: SheetRevisionQuestion[] = Array.from(
  { length: 11 },
  (_, index) => ({
    title: index === 8 ? CYCLE_QUESTION : `Pregunta editable ${index + 1}`,
    help: `Ayuda editable ${index + 1}`,
    type: index === 8 ? "menstrual_cycle" : "text"
  })
);
export const SHEET_QUESTIONS: SheetRevisionQuestion[] = [
  { title: "CINTURA", help: "", type: "text" },
  ...WEEKLY_REVIEW_QUESTIONS
];
