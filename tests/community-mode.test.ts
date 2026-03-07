import { describe, expect, it } from "vitest";
import {
  COMMUNITY_EDIT_WINDOW_MS,
  canAuthorEditUntil,
  normalizeCommunityUsername,
  permissionToActorRole
} from "@/lib/community";

describe("community helpers", () => {
  it("normalizes usernames", () => {
    expect(normalizeCommunityUsername(" @RafaJ ")).toBe("rafaj");
  });

  it("maps permission to actor role", () => {
    expect(permissionToActorRole("admin")).toBe("admin");
    expect(permissionToActorRole("user")).toBe("user");
  });

  it("allows author edition inside 15-minute window", () => {
    const createdAt = "2026-03-07T10:00:00.000Z";
    const insideWindow = new Date(
      new Date(createdAt).getTime() + COMMUNITY_EDIT_WINDOW_MS - 10_000
    ).toISOString();
    const outsideWindow = new Date(
      new Date(createdAt).getTime() + COMMUNITY_EDIT_WINDOW_MS + 10_000
    ).toISOString();

    expect(canAuthorEditUntil(createdAt, insideWindow)).toBe(true);
    expect(canAuthorEditUntil(createdAt, outsideWindow)).toBe(false);
  });
});

