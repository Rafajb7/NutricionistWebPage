import { describe, expect, it } from "vitest";
import { DEFAULT_EXERCISE_CATALOG } from "@/lib/routines/default-exercises";

describe("DEFAULT_EXERCISE_CATALOG", () => {
  it("contains exactly 100 exercises", () => {
    expect(DEFAULT_EXERCISE_CATALOG).toHaveLength(100);
  });

  it("keeps unique exercise rows by group + name", () => {
    const uniqueRows = new Set(
      DEFAULT_EXERCISE_CATALOG.map((item) => `${item.muscleGroup}::${item.exercise}`)
    );
    expect(uniqueRows.size).toBe(DEFAULT_EXERCISE_CATALOG.length);
  });
});

