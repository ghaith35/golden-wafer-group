import { describe, expect, it } from "vitest";

// Refresh tokens must be unique per login: same user + same second used to
// mint byte-identical JWTs, and the second login 500d on the tokenHash
// unique key (double-tap on a slow line = locked out of your own account).
describe("signRefreshToken uniqueness", () => {
  it("two logins in the same second mint different tokens", async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-uniqueness-check";
    const { signRefreshToken, verifyToken } = await import("@/lib/auth/tokens");
    const claims = { sub: "u1", companyId: "c1", username: "ghaith", role: "Livreur" };
    const [a, b] = await Promise.all([signRefreshToken(claims), signRefreshToken(claims)]);
    expect(a).not.toBe(b);
    const pa = (await verifyToken(a)) as Record<string, unknown>;
    expect(pa._type).toBe("refresh");
    expect(typeof pa.jti).toBe("string");
  });
});
