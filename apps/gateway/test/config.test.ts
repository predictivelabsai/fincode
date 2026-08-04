import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/config.js";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@db.example.test:5432/polytrade?sslmode=require",
    CREDENTIALS_KEK_BASE64: Buffer.alloc(32, 3).toString("base64"),
    CLERK_ISSUER: "https://clerk.test",
    CLERK_JWKS_URL: "https://clerk.test/.well-known/jwks.json",
    ...overrides,
  };
}

describe("gateway authentication configuration", () => {
  it("starts with Clerk as the only configured issuer", () => {
    const config = parseConfig(environment({
      ASSETHERO_API_ISSUER: "",
      ASSETHERO_API_JWKS_URL: "",
    }));

    expect(config.CLERK_ISSUER).toBe("https://clerk.test");
    expect(config.ASSETHERO_API_ISSUER).toBeUndefined();
    expect(config.ASSETHERO_API_JWKS_URL).toBeUndefined();
  });

  it("enables AssetHero API trust only when issuer and JWKS are configured together", () => {
    expect(() => parseConfig(environment({
      ASSETHERO_API_ISSUER: "https://auth.assethero.test",
    }))).toThrow(/configured together/);

    const config = parseConfig(environment({
      ASSETHERO_API_ISSUER: "https://auth.assethero.test/",
      ASSETHERO_API_JWKS_URL: "https://auth.assethero.test/.well-known/jwks.json",
    }));
    expect(config.ASSETHERO_API_ISSUER).toBe("https://auth.assethero.test");
    expect(config.ASSETHERO_API_AUDIENCE).toBe("polytrade");
  });
});
