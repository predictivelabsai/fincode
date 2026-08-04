import { describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { parseConfig } from "../src/config.js";
import type { Principal } from "../src/types.js";
import { FakePolymarket, MemoryTradingStore } from "./fakes.js";

const principal: Principal = {
  id: "assethero:user-1",
  issuer: "assethero",
  subject: "user-1",
  scopes: new Set(["research", "trade"]),
};

function config(trustedProxies = "127.0.0.1/32,::1/128") {
  return parseConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@db.example.test:5432/polytrade?sslmode=require",
    CREDENTIALS_KEK_BASE64: Buffer.alloc(32, 9).toString("base64"),
    CORS_ORIGINS: "https://app.assethero.test,https://polytrade.test",
    TRUSTED_PROXIES: trustedProxies,
    CLERK_ISSUER: "https://clerk.test",
    CLERK_JWKS_URL: "https://clerk.test/jwks",
  });
}

async function setup(trustedProxies?: string) {
  const store = new MemoryTradingStore();
  const polymarket = new FakePolymarket();
  let challengeCalls = 0;
  let observedIp = "";
  const verifiedScopes: string[] = [];
  const createdIntents: unknown[] = [];
  const submittedIntents: Array<{ intentId: string; signature: string }> = [];
  const trading = {
    eligibility: async (ip: string) => {
      observedIp = ip;
      return { blocked: false, verified: true, ip, country: "US", region: "NY", checkedAt: new Date().toISOString() };
    },
    createChallenge: async () => {
      challengeCalls += 1;
      return {
        challengeId: "00000000-0000-4000-8000-000000000010",
        expiresAt: "2026-08-03T00:05:00.000Z",
        typedData: { domain: {}, types: {}, primaryType: "Challenge", message: {} },
      };
    },
    createSession: async () => ({}),
    currentSession: async () => ({
      sessionId: "00000000-0000-4000-8000-000000000001",
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 0,
      idleExpiresAt: "2026-08-03T00:30:00.000Z",
      expiresAt: "2026-08-03T08:00:00.000Z",
    }),
    revokeSession: async () => {},
    account: async () => ({ positions: [], openOrders: [], trades: [] }),
    accountOverview: async () => ({
      walletAddress: "0x0000000000000000000000000000000000000001",
      positions: [],
      openOrders: [],
      fills: [],
      observedAt: "2026-08-03T00:00:00.000Z",
    }),
    createIntent: async (
      _principal: Principal,
      _clientIp: string,
      _sessionId: string,
      proposal: unknown,
    ) => {
      createdIntents.push(proposal);
      return { intentId: `00000000-0000-4000-8000-${String(createdIntents.length).padStart(12, "0")}` };
    },
    submitIntent: async (
      _principal: Principal,
      _clientIp: string,
      intentId: string,
      signature: string,
    ) => {
      submittedIntents.push({ intentId, signature });
      return { success: true, orderID: `order-${submittedIntents.length}` };
    },
    cancel: async () => ({}),
  };
  const emptyPaperPortfolio = {
    initialCash: "10000.000000",
    cash: "10000.000000",
    positionsValue: "0.000000",
    equity: "10000.000000",
    realizedPnl: "0.000000",
    unrealizedPnl: "0.000000",
    totalPnl: "0.000000",
    totalFees: "0.000000",
    positions: [],
    warnings: [],
    observedAt: "2026-08-03T00:00:00.000Z",
  };
  const paper = {
    portfolio: async () => emptyPaperPortfolio,
    quote: async () => ({
      conditionId: "0xcondition",
      tokenId: "123",
      marketQuestion: "Will paper routes pass?",
      outcome: "Yes",
      side: "BUY",
      shares: "10.000000",
      averagePrice: "0.400000",
      limitPrice: "0.400000",
      grossNotional: "4.000000",
      feeRate: "0.000000",
      fee: "0.00000",
      cashEffect: "-4.000000",
      observedAt: "2026-08-03T00:00:00.000Z",
    }),
    order: async () => ({
      fill: {
        fillId: "55555555-5555-4555-8555-555555555555",
        kind: "BUY",
        conditionId: "0xcondition",
        tokenId: "123",
        marketQuestion: "Will paper routes pass?",
        outcome: "Yes",
        shares: "10.000000",
        averagePrice: "0.400000",
        grossNotional: "4.000000",
        feeRate: "0.000000",
        fee: "0.00000",
        cashEffect: "-4.000000",
        realizedPnl: "0.000000",
        observedAt: "2026-08-03T00:00:00.000Z",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
      portfolio: emptyPaperPortfolio,
    }),
    refresh: async () => emptyPaperPortfolio,
    fills: async (_principal: Principal, limit: number, offset: number) => ({ items: [], total: 0, limit, offset }),
  };
  const app = await buildApp({
    config: config(trustedProxies),
    verifier: { verifyAuthorization: async (_header: string | undefined, scope: string) => {
      verifiedScopes.push(scope);
      return principal;
    } } as never,
    store,
    polymarket,
    trading: trading as never,
    paper: paper as never,
  });
  await app.ready();
  return {
    app,
    challengeCalls: () => challengeCalls,
    createdIntents,
    observedIp: () => observedIp,
    submittedIntents,
    verifiedScopes,
  };
}

describe("gateway HTTP boundary", () => {
  it("allows only exact configured origins", async () => {
    const { app } = await setup();
    const allowed = await app.inject({
      method: "GET",
      url: "/v1/research/markets?query=election",
      headers: { authorization: "Bearer token", origin: "https://app.assethero.test" },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.assethero.test");

    const denied = await app.inject({
      method: "GET",
      url: "/v1/research/markets?query=election",
      headers: { authorization: "Bearer token", origin: "https://evil.test" },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
    await app.close();
  });

  it("honors forwarded client IPs only from configured proxies", async () => {
    const trusted = await setup();
    await trusted.app.inject({
      method: "GET",
      url: "/v1/eligibility",
      headers: { authorization: "Bearer token", "x-forwarded-for": "203.0.113.8" },
    });
    expect(trusted.observedIp()).toBe("203.0.113.8");
    await trusted.app.close();

    const untrusted = await setup("10.0.0.0/8");
    await untrusted.app.inject({
      method: "GET",
      url: "/v1/eligibility",
      headers: { authorization: "Bearer token", "x-forwarded-for": "203.0.113.8" },
    });
    expect(untrusted.observedIp()).not.toBe("203.0.113.8");
    await untrusted.app.close();
  });

  it("deduplicates writes and rejects key reuse with changed payload", async () => {
    const { app, challengeCalls } = await setup();
    const headers = {
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": "challenge-key-1",
    };
    const body = { walletAddress: "0x0000000000000000000000000000000000000001", signatureType: 0 };
    const first = await app.inject({ method: "POST", url: "/v1/wallet-sessions/challenge", headers, payload: body });
    const replay = await app.inject({ method: "POST", url: "/v1/wallet-sessions/challenge", headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(challengeCalls()).toBe(1);

    const changed = await app.inject({
      method: "POST",
      url: "/v1/wallet-sessions/challenge",
      headers,
      payload: { ...body, walletAddress: "0x0000000000000000000000000000000000000002" },
    });
    expect(changed.statusCode).toBe(409);
    await app.close();
  });

  it("publishes versioned request schemas in OpenAPI", async () => {
    const { app } = await setup();
    const specification = app.swagger() as { paths: Record<string, Record<string, { requestBody?: unknown }>> };
    expect(specification.paths["/v1/order-intents"]?.post?.requestBody).toBeDefined();
    expect(specification.paths["/v1/cancellations"]?.post?.requestBody).toBeDefined();
    expect(specification.paths["/v1/wallet-sessions/current"]?.get).toBeDefined();
    expect(specification.paths["/v1/account/overview"]?.get).toBeDefined();
    expect(specification.paths["/v1/paper/quotes"]?.post?.requestBody).toBeDefined();
    expect(specification.paths["/v1/paper/orders"]?.post?.requestBody).toBeDefined();
    expect(specification.paths["/v1/paper/portfolio"]?.get).toBeDefined();
    await app.close();
  });

  it("keeps paper routes on research auth without invoking wallet or geoblock flows", async () => {
    const { app, challengeCalls, observedIp, verifiedScopes } = await setup();
    const headers = { authorization: "Bearer token", "content-type": "application/json" };

    const portfolio = await app.inject({ method: "GET", url: "/v1/paper/portfolio", headers });
    const quote = await app.inject({
      method: "POST",
      url: "/v1/paper/quotes",
      headers,
      payload: { conditionId: "0xcondition", tokenId: "123", side: "BUY", shares: "10" },
    });
    const order = await app.inject({
      method: "POST",
      url: "/v1/paper/orders",
      headers: { ...headers, "idempotency-key": "paper-order-key-1" },
      payload: { conditionId: "0xcondition", tokenId: "123", side: "BUY", shares: "10", limitPrice: "0.4" },
    });
    const refresh = await app.inject({
      method: "POST",
      url: "/v1/paper/refresh",
      headers: { authorization: "Bearer token" },
    });
    const fills = await app.inject({ method: "GET", url: "/v1/paper/fills?limit=10&offset=0", headers });

    expect([portfolio, quote, order, refresh, fills].map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(verifiedScopes).toEqual(["research", "research", "research", "research", "research"]);
    expect(challengeCalls()).toBe(0);
    expect(observedIp()).toBe("");
    await app.close();
  });

  it("serves stable wallet-session and account-overview DTOs", async () => {
    const { app } = await setup();
    const headers = { authorization: "Bearer token" };

    const session = await app.inject({ method: "GET", url: "/v1/wallet-sessions/current", headers });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      sessionId: "00000000-0000-4000-8000-000000000001",
      signatureType: 0,
    });
    expect(session.json()).not.toHaveProperty("encryptedCredentials");

    const overview = await app.inject({ method: "GET", url: "/v1/account/overview", headers });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ positions: [], openOrders: [], fills: [] });
    await app.close();
  });

  it("requires and forwards a separate wallet signature for every batch member", async () => {
    const { app, createdIntents, submittedIntents } = await setup();
    const headers = {
      authorization: "Bearer token",
      "content-type": "application/json",
      "idempotency-key": "batch-order-key-1",
    };
    const base = {
      action: "create",
      tokenId: "123",
      marketId: "0xcondition",
      marketQuestion: "Will this batch pass?",
      outcome: "Yes",
      side: "BUY",
      rationale: "test",
      observedAt: "2026-08-03T00:00:00.000Z",
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/order-intents/batch",
      headers,
      payload: {
        sessionId: "00000000-0000-4000-8000-000000000001",
        proposals: [
          { ...base, execution: "GTC", price: "0.4", size: "10", postOnly: true },
          { ...base, tokenId: "456", outcome: "No", execution: "FAK", amount: "4", limitPrice: "0.5", postOnly: false },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    expect(createdIntents).toHaveLength(2);

    const submitted = await app.inject({
      method: "POST",
      url: "/v1/order-intents/batch/submit",
      headers: { ...headers, "idempotency-key": "batch-submit-key-1" },
      payload: {
        items: [
          { intentId: "00000000-0000-4000-8000-000000000001", signature: "0x11" },
          { intentId: "00000000-0000-4000-8000-000000000002", signature: "0x22" },
        ],
      },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submittedIntents).toEqual([
      { intentId: "00000000-0000-4000-8000-000000000001", signature: "0x11" },
      { intentId: "00000000-0000-4000-8000-000000000002", signature: "0x22" },
    ]);
    await app.close();
  });
});
