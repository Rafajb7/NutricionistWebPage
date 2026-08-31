import { describe, expect, it } from "vitest";
import {
  calculateMakingWeightStatus,
  getCurrentMakingWeightValue,
  getMakingWeightThresholds
} from "@/lib/making-weight";
import type { CompetitionCalendarEvent } from "@/lib/google/calendar";
import type { RevisionEntry } from "@/lib/google/types";

function competition(overrides: Partial<CompetitionCalendarEvent> = {}): CompetitionCalendarEvent {
  return {
    id: "competition-1",
    title: "Campeonato",
    date: "2026-09-30",
    weighInDate: "2026-09-30",
    weighInTime: "09:00",
    targetWeightKg: 75,
    location: "Madrid",
    description: "",
    createdAt: "",
    ...overrides
  };
}

describe("making weight", () => {
  it("uses the configured risk thresholds for 30, 15 and 7 days", () => {
    expect(getMakingWeightThresholds(30)).toEqual({
      criticalThresholdPercent: 10,
      moderateThresholdPercent: 3
    });
    expect(getMakingWeightThresholds(15)).toEqual({
      criticalThresholdPercent: 7,
      moderateThresholdPercent: 3
    });
    expect(getMakingWeightThresholds(7)).toEqual({
      criticalThresholdPercent: 5,
      moderateThresholdPercent: 2
    });
  });

  it("classifies critical, moderate and no-risk cuts", () => {
    expect(
      calculateMakingWeightStatus({
        competition: competition({ weighInDate: "2026-09-30" }),
        currentWeightKg: 82.5,
        fromDate: "2026-08-31"
      }).risk
    ).toBe("critical");

    expect(
      calculateMakingWeightStatus({
        competition: competition({ weighInDate: "2026-09-15" }),
        currentWeightKg: 78,
        fromDate: "2026-08-31"
      }).risk
    ).toBe("moderate");

    expect(
      calculateMakingWeightStatus({
        competition: competition({ weighInDate: "2026-09-07" }),
        currentWeightKg: 76,
        fromDate: "2026-08-31"
      }).risk
    ).toBe("none");
  });

  it("classifies a large absolute weight gap as critical near weigh-in", () => {
    const status = calculateMakingWeightStatus({
      competition: competition({
        date: "2026-09-15",
        weighInDate: "2026-09-15",
        targetWeightKg: 75
      }),
      currentWeightKg: 52.5,
      fromDate: "2026-09-04"
    });

    expect(status.daysUntilWeighIn).toBe(11);
    expect(status.cutRatioPercent).toBe(30);
    expect(status.risk).toBe("critical");
  });

  it("prefers the latest revision weight for the current weight", () => {
    const revisions: RevisionEntry[] = [
      {
        nombre: "Atleta",
        usuario: "atleta",
        fecha: "2026-08-20",
        pregunta: "PESO MEDIO SEMANAL (KG)",
        respuesta: "78,4 kg (78, 78,8)",
        imageUrl: null
      }
    ];
    const current = getCurrentMakingWeightValue({
      revisions,
      peakModeLogs: [
        {
          timestamp: "",
          fecha: "2026-08-29",
          nombre: "Atleta",
          usuario: "atleta",
          modo: "diablo",
          pesoAyunasKg: 77,
          pesoNocturnoKg: 78,
          pasosDiarios: 10000,
          aguaLitros: 3,
          frutaPiezas: 2,
          verduraRaciones: 2,
          cerealesIntegralesRaciones: 1,
          hambreEscala: 4,
          descansoEscala: 4,
          horasSueno: 8,
          estresEscala: 3,
          molestiasDigestivasEscala: 1,
          cumplimientoPlanEscala: 9,
          tuvoEntreno: true,
          dobleSesion: false
        }
      ]
    });

    expect(current).toEqual({
      weightKg: 78.4,
      date: "2026-08-20",
      source: "revision"
    });
  });
});
