export type CompetitionMode = "none" | "titan" | "diablo";

export type CompetitionEventDate = {
  date: string;
};

export type ActiveCompetitionMode = {
  mode: Exclude<CompetitionMode, "none">;
  competitionDate: string;
  daysUntilCompetition: number;
  startsOn: string;
  endsOn: string;
};

function formatDateOnly(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateString(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid date.");
  }
  parsed.setDate(parsed.getDate() + days);
  return formatDateOnly(parsed);
}

export function toDaysUntilCompetition(date: string, fromDate = new Date()): number | null {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;

  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function toWindowForDaysUntil(date: string, daysUntilCompetition: number): ActiveCompetitionMode | null {
  if (daysUntilCompetition >= 0 && daysUntilCompetition <= 7) {
    return {
      mode: "diablo",
      competitionDate: date,
      daysUntilCompetition,
      startsOn: addDaysToDateString(date, -7),
      endsOn: date
    };
  }

  if (daysUntilCompetition >= 8 && daysUntilCompetition <= 21) {
    return {
      mode: "titan",
      competitionDate: date,
      daysUntilCompetition,
      startsOn: addDaysToDateString(date, -21),
      endsOn: addDaysToDateString(date, -8)
    };
  }

  return null;
}

export function getActiveCompetitionMode(
  events: CompetitionEventDate[],
  fromDate = new Date()
): ActiveCompetitionMode | null {
  const windows = events
    .map((event) => {
      const daysUntilCompetition = toDaysUntilCompetition(event.date, fromDate);
      if (daysUntilCompetition === null) return null;
      return toWindowForDaysUntil(event.date, daysUntilCompetition);
    })
    .filter((value): value is ActiveCompetitionMode => Boolean(value))
    .sort((a, b) => {
      const byDays = a.daysUntilCompetition - b.daysUntilCompetition;
      if (byDays !== 0) return byDays;
      return a.competitionDate.localeCompare(b.competitionDate);
    });

  return windows[0] ?? null;
}

export function getCompetitionMode(
  events: CompetitionEventDate[],
  fromDate = new Date()
): CompetitionMode {
  return getActiveCompetitionMode(events, fromDate)?.mode ?? "none";
}

export function buildCompetitionCalendarPeriods(competitionDate: string): {
  competitionWeek: {
    startDate: string;
    endDateExclusive: string;
  };
  precompetitionWeeks: {
    startDate: string;
    endDateExclusive: string;
  };
} {
  return {
    competitionWeek: {
      startDate: addDaysToDateString(competitionDate, -7),
      endDateExclusive: addDaysToDateString(competitionDate, 1)
    },
    precompetitionWeeks: {
      startDate: addDaysToDateString(competitionDate, -21),
      endDateExclusive: addDaysToDateString(competitionDate, -7)
    }
  };
}
