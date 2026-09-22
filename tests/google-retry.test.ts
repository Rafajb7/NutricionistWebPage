import { describe, expect, it } from "vitest";
import { isGoogleRateLimitError, isGoogleTransientError } from "@/lib/google/retry";

describe("Google API errors", () => {
  it("recognizes quota reasons nested inside a Google 403 response", () => {
    const error = { response: { status: 403, data: { error: {
      message: "Request rejected", errors: [{ reason: "userRateLimitExceeded" }]
    } } } };
    expect(isGoogleRateLimitError(error)).toBe(true);
    expect(isGoogleTransientError(error)).toBe(true);
  });

  it.each([429, "429"])("recognizes HTTP %s", (status) => {
    expect(isGoogleRateLimitError({ response: { status } })).toBe(true);
  });

  it("recognizes structured RESOURCE_EXHAUSTED errors", () => {
    expect(isGoogleRateLimitError({ response: { data: { error: { status: "RESOURCE_EXHAUSTED" } } } })).toBe(true);
  });

  it("treats connection reset codes as transient without calling them quota errors", () => {
    const error = { code: "ECONNRESET" };
    expect(isGoogleTransientError(error)).toBe(true);
    expect(isGoogleRateLimitError(error)).toBe(false);
  });

  it("does not retry a permission failure", () => {
    const error = { response: { status: 403, data: { error: { message: "Permission denied" } } } };
    expect(isGoogleTransientError(error)).toBe(false);
    expect(isGoogleRateLimitError(error)).toBe(false);
  });
});
