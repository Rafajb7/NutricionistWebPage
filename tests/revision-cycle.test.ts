import { describe, expect, it } from "vitest";
import {
  emptyRevisionCycleAnswer,
  formatRevisionCycleAnswer,
  isValidCycleDate,
  validateRevisionCycleAnswer,
  type RevisionCycleAnswer
} from "@/lib/revision-cycle";

function answer(changes: Partial<RevisionCycleAnswer> = {}): RevisionCycleAnswer {
  return {
    ...emptyRevisionCycleAnswer(),
    phase: "menstrual",
    menstruating: "yes",
    periodStart: "2026-10-12",
    periodEnd: "2026-10-17",
    ...changes
  };
}
const today = "2026-10-14";

describe("menstrual cycle dates and readable history", () => {
  it("accepts current menstruation and estimates extending into another month", () => {
    expect(validateRevisionCycleAnswer(answer(), today)).toBeNull();
    expect(
      validateRevisionCycleAnswer(
        answer({
          periodStart: "2026-09-29",
          periodEnd: "2026-10-04",
          nextPeriodStart: "2026-10-28"
        }),
        today
      )
    ).toBeNull();
  });
  it("accepts a one-day period", () => {
    expect(validateRevisionCycleAnswer(answer({ periodEnd: "2026-10-12" }), today)).toBeNull();
  });
  it.each(["2026-02-29", "2026-04-31", "2026-00-10", "2026-13-01", "not-a-date"])(
    "rejects impossible date %s",
    (date) => {
      expect(isValidCycleDate(date)).toBe(false);
      expect(validateRevisionCycleAnswer(answer({ periodStart: date }), today)).not.toBeNull();
    }
  );
  it("accepts leap day only in leap years", () => {
    expect(isValidCycleDate("2028-02-29")).toBe(true);
  });
  it.each([
    { periodStart: "2026-10-15" },
    { periodEnd: "2026-10-11" },
    { nextPeriodStart: "2026-10-13" },
    { nextPeriodStart: "2026-10-16" },
    { cycleDay: "0" },
    { cycleDay: "1.5" },
    { cycleDay: "367" },
    { phase: "" as const }
  ])("rejects invalid or incomplete values %j", (changes) => {
    expect(validateRevisionCycleAnswer(answer(changes), today)).not.toBeNull();
  });
  it("allows unknown dates explicitly and does not force dates when not applicable", () => {
    expect(
      validateRevisionCycleAnswer(
        answer({
          phase: "unknown",
          periodStart: "",
          periodEnd: "",
          startUnknown: true,
          endUnknown: true
        }),
        today
      )
    ).toBeNull();
    const notApplicable = { ...emptyRevisionCycleAnswer(), phase: "not-applicable" as const };
    expect(validateRevisionCycleAnswer(notApplicable, today)).toBeNull();
    expect(formatRevisionCycleAnswer(notApplicable)).toBe(
      "Fase del ciclo: No tengo menstruación / no aplica"
    );
  });
  it("saves phase, dates, cycle day, current status and comments as readable text", () => {
    const text = formatRevisionCycleAnswer(
      answer({ cycleDay: "3", nextPeriodStart: "2026-11-10", notes: "Algo de cansancio" })
    );
    expect(text).toBe(
      "Fase del ciclo: Menstrual\nDía del ciclo: 3\nMenstruando actualmente: Sí\nInicio de la menstruación: 12/10/2026\nFin previsto de la menstruación: 17/10/2026\nPróxima menstruación prevista: 10/11/2026\nObservaciones: Algo de cansancio"
    );
  });
  it("does not save stale dates if the answer changes to not applicable or unknown dates", () => {
    expect(formatRevisionCycleAnswer(answer({ phase: "not-applicable" }))).not.toContain("12/10");
    expect(formatRevisionCycleAnswer(answer({ startUnknown: true, endUnknown: true }))).toContain(
      "Inicio de la menstruación: No lo recuerdo\nFin previsto de la menstruación: No lo sé"
    );
  });
});
