import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  buildRevisionQuestions,
  parseRevisionQuestionRows,
  STEPS_AVERAGE_QUESTION,
  WEIGHT_AVERAGE_QUESTION,
  type RevisionQuestion
} from "@/lib/revision-questions";
import { SHEET_QUESTIONS, CYCLE_QUESTION } from "@/tests/fixtures/revision-questions";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";

const mocks = vi.hoisted(() => ({ session: vi.fn(), questions: vi.fn(), users: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/google/sheets", () => ({
  readQuestionsFromSheet: mocks.questions,
  readUsersFromSheetCached: mocks.users
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));
import { GET } from "@/app/api/questions/route";

const titles = (questions: RevisionQuestion[]) => questions.map((question) => question.title);
const cacheKey = "google:revision-question-definitions";

beforeEach(() => {
  vi.clearAllMocks();
  deleteMemoryCache(cacheKey);
  mocks.questions.mockResolvedValue(SHEET_QUESTIONS);
  mocks.users.mockResolvedValue([
    { username: "@Ana", sex: "female" },
    { username: "juan", sex: "male" },
    { username: "sin-sexo", sex: "" }
  ]);
  mocks.session.mockResolvedValue({ session: { username: "ana" } });
});

describe("Sheet question content and behavior", () => {
  it("reads title, help and type from Sheets while retaining legacy A-only rows", () => {
    expect(
      parseRevisionQuestionRows([
        ["CINTURA(cm)"],
        [],
        ["", "Not a question"],
        ["Pregunta que puedo editar", "Ayuda que también puedo editar", "texto"],
        ["Mi ciclo, con otro título", "Ayuda del ciclo", "CICLO_MENSTRUAL"]
      ])
    ).toEqual([
      { title: "CINTURA(cm)", help: "", type: "text" },
      { title: "Pregunta que puedo editar", help: "Ayuda que también puedo editar", type: "text" },
      { title: "Mi ciclo, con otro título", help: "Ayuda del ciclo", type: "menstrual_cycle" }
    ]);
  });

  it("supports an optional header without showing it as a question", () => {
    expect(parseRevisionQuestionRows([["Pregunta", "Ayuda", "Tipo"], ["CADERA(cm)"]])).toEqual([
      { title: "CADERA(cm)", help: "", type: "text" }
    ]);
  });

  it("rejects invalid types instead of exposing a misconfigured cycle question to everyone", () => {
    expect(() => parseRevisionQuestionRows([["Ciclo", "", "ciclo_menstural"]])).toThrow("fila 1");
  });

  it("keeps only weight and steps fixed; all remaining questions follow Sheet order", () => {
    expect(titles(buildRevisionQuestions(SHEET_QUESTIONS, "female"))).toEqual([
      WEIGHT_AVERAGE_QUESTION,
      STEPS_AVERAGE_QUESTION,
      ...titles(SHEET_QUESTIONS)
    ]);
    expect(titles(buildRevisionQuestions([], "female"))).toEqual([
      WEIGHT_AVERAGE_QUESTION,
      STEPS_AVERAGE_QUESTION
    ]);
  });

  it("reflects edits, additions, deletions and reordering without restoring hardcoded questions", () => {
    const rows = [
      ["Última pregunta ahora al principio", "Ayuda cambiada", "texto"],
      ["Pregunta nueva", "", "texto"]
    ];
    expect(buildRevisionQuestions(parseRevisionQuestionRows(rows), "female").slice(2)).toEqual([
      { title: rows[0][0], help: rows[0][1], type: "text" },
      { title: rows[1][0], help: "", type: "text" }
    ]);
  });

  it("does not duplicate the two fixed questions if they also occur in the Sheet", () => {
    const questions = buildRevisionQuestions(
      parseRevisionQuestionRows([[" peso medio semanal (kg) "], ["NÚMERO DE PASOS"], ["CINTURA"]]),
      "female"
    );
    expect(titles(questions)).toEqual([WEIGHT_AVERAGE_QUESTION, STEPS_AVERAGE_QUESTION, "CINTURA"]);
  });

  it.each(["male", ""] as const)(
    "omits cycle data for sex %s even after editing its text",
    (sex) => {
      const edited = parseRevisionQuestionRows([
        ["Título nuevo del ciclo", "Ayuda nueva", "ciclo_menstrual"]
      ]);
      expect(buildRevisionQuestions(edited, sex)).toHaveLength(2);
      expect(buildRevisionQuestions(edited, "female")[2]).toEqual(edited[0]);
    }
  );

  it("resolves visibility per authenticated user without sharing personalized questions in cache", async () => {
    const female = await GET();
    expect(titles((await female.json()).questions)).toContain(CYCLE_QUESTION);
    expect(female.headers.get("Cache-Control")).toBe("private, no-store");
    for (const username of ["juan", "sin-sexo", "missing-profile"]) {
      mocks.session.mockResolvedValue({ session: { username } });
      expect(titles((await (await GET()).json()).questions)).not.toContain(CYCLE_QUESTION);
    }
    expect(mocks.questions).toHaveBeenCalledTimes(1);
    expect(mocks.users).toHaveBeenCalledTimes(4);
  });

  it("serves updated title and help when the Sheet cache is refreshed", async () => {
    await GET();
    deleteMemoryCache(cacheKey);
    mocks.questions.mockResolvedValue(
      parseRevisionQuestionRows([["Nuevo texto", "Nueva ayuda", "ciclo_menstrual"]])
    );
    const result = await (await GET()).json();
    expect(result.questions.slice(2)).toEqual([
      { title: "Nuevo texto", help: "Nueva ayuda", type: "menstrual_cycle" }
    ]);
  });

  it("does not load data for an unauthenticated request", async () => {
    mocks.session.mockResolvedValue({
      session: null,
      response: NextResponse.json({}, { status: 401 })
    });
    expect((await GET()).status).toBe(401);
    expect(mocks.questions).not.toHaveBeenCalled();
    expect(mocks.users).not.toHaveBeenCalled();
  });

  it("reports failed profile loading instead of silently omitting a woman's question", async () => {
    mocks.users.mockRejectedValueOnce(new Error("Sheets unavailable"));
    expect((await GET()).status).toBe(500);
  });
});
