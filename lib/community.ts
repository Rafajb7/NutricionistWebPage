import type { CommunityActorRole } from "@/lib/google/community";

export const COMMUNITY_EDIT_WINDOW_MS = 15 * 60 * 1000;

export function normalizeCommunityUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function canAuthorEditUntil(createdAt: string, nowIso: string): boolean {
  const created = new Date(createdAt).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(now)) return false;
  return now - created <= COMMUNITY_EDIT_WINDOW_MS;
}

export function isAdminRole(permission: "user" | "admin"): boolean {
  return permission === "admin";
}

export function permissionToActorRole(permission: "user" | "admin"): CommunityActorRole {
  return permission === "admin" ? "admin" : "user";
}

export function safeSnapshotJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

export function createCommunityId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

