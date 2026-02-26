import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("verifyPassword", () => {
  it("validates bcrypt passwords", async () => {
    const hash = await hashPassword("StrongPass123");
    const valid = await verifyPassword({
      candidate: "StrongPass123",
      stored: hash,
      allowPlaintextFallback: false
    });
    expect(valid).toBe(true);
  });

  it("rejects plaintext when fallback is disabled", async () => {
    const valid = await verifyPassword({
      candidate: "1234",
      stored: "1234",
      allowPlaintextFallback: false
    });
    expect(valid).toBe(false);
  });

  it("accepts plaintext when fallback is enabled", async () => {
    const valid = await verifyPassword({
      candidate: "legacy-pass",
      stored: "legacy-pass",
      allowPlaintextFallback: true
    });
    expect(valid).toBe(true);
  });
});
