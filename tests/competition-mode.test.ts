import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  buildCompetitionCalendarPeriods,
  getActiveCompetitionMode,
  getCompetitionMode,
  toDaysUntilCompetition
} from "@/lib/competition-mode";

describe("competition mode windows", () => {
  const referenceDate = new Date("2026-03-01T12:00:00Z");

  it("calculates days until competition", () => {
    expect(toDaysUntilCompetition("2026-03-08", referenceDate)).toBe(7);
    expect(toDaysUntilCompetition("2026-03-22", referenceDate)).toBe(21);
    expect(toDaysUntilCompetition("2026-02-20", referenceDate)).toBeLessThan(0);
  });

  it("enables diablo mode in competition week", () => {
    const mode = getActiveCompetitionMode([{ date: "2026-03-08" }], referenceDate);
    expect(mode?.mode).toBe("diablo");
    expect(mode?.startsOn).toBe("2026-03-01");
    expect(mode?.endsOn).toBe("2026-03-08");
  });

  it("enables titan mode in precompetition weeks", () => {
    const mode = getActiveCompetitionMode([{ date: "2026-03-22" }], referenceDate);
    expect(mode?.mode).toBe("titan");
    expect(mode?.startsOn).toBe("2026-03-01");
    expect(mode?.endsOn).toBe("2026-03-14");
  });

  it("returns none outside windows", () => {
    expect(getCompetitionMode([{ date: "2026-04-15" }], referenceDate)).toBe("none");
  });

  it("prioritizes nearest active competition window", () => {
    const mode = getCompetitionMode(
      [{ date: "2026-03-22" }, { date: "2026-03-06" }],
      referenceDate
    );
    expect(mode).toBe("diablo");
  });
});

describe("competition calendar periods", () => {
  it("builds competition and precompetition ranges", () => {
    const periods = buildCompetitionCalendarPeriods("2026-05-20");
    expect(periods.competitionWeek.startDate).toBe("2026-05-13");
    expect(periods.competitionWeek.endDateExclusive).toBe("2026-05-21");
    expect(periods.precompetitionWeeks.startDate).toBe("2026-04-29");
    expect(periods.precompetitionWeeks.endDateExclusive).toBe("2026-05-13");
  });

  it("adds days to date string", () => {
    expect(addDaysToDateString("2026-01-01", 10)).toBe("2026-01-11");
    expect(addDaysToDateString("2026-01-01", -1)).toBe("2025-12-31");
  });
});
