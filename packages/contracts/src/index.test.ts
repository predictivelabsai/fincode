import { describe, expect, it } from "vitest";
import {
  accountOverviewSchema,
  isBacktestEligibleMarket,
  marketSearchResponseSchema,
  momentumBacktestConfigSchema,
  paperOrderRequestSchema,
  paperPortfolioSchema,
  paperQuoteSchema,
  tradingActionProposalSchema,
  walletSessionStatusSchema,
} from "./index.js";

describe("tradingActionProposalSchema", () => {
  const base = {
    action: "create" as const,
    tokenId: "123",
    marketId: "condition",
    marketQuestion: "Will this test pass?",
    outcome: "Yes",
    side: "BUY" as const,
    rationale: "contract test",
    observedAt: "2026-08-03T00:00:00.000Z",
  };

  it("accepts a post-only GTC proposal", () => {
    expect(
      tradingActionProposalSchema.parse({
        ...base,
        execution: "GTC",
        price: "0.45",
        size: "10",
        postOnly: true,
      }),
    ).toMatchObject({ execution: "GTC", postOnly: true });
  });

  it("rejects post-only immediate orders", () => {
    expect(() =>
      tradingActionProposalSchema.parse({
        ...base,
        execution: "FOK",
        amount: "10",
        limitPrice: "0.5",
        postOnly: true,
      }),
    ).toThrow();
  });

  it("requires an expiration for GTD", () => {
    expect(() =>
      tradingActionProposalSchema.parse({
        ...base,
        execution: "GTD",
        price: "0.45",
        size: "10",
      }),
    ).toThrow(/GTD requires expiration/);
  });
});

describe("backtest market eligibility", () => {
  const market = {
    id: "market-1",
    conditionId: "condition-1",
    slug: "market-1",
    question: "Will this resolve Yes?",
    description: "",
    outcomes: ["Yes", "No"],
    outcomePrices: ["1", "0"],
    clobTokenIds: ["101", "202"],
    active: false,
    closed: true,
    acceptingOrders: false,
    enableOrderBook: true,
    archived: false,
    restricted: false,
    minimumOrderSize: "5",
    minimumTickSize: "0.01",
    endDate: "2026-05-01T02:00:00.000Z",
    startDate: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    closedTime: "2026-05-01T02:00:00.000Z",
    liquidity: "100",
    volume: "1000",
  };

  it("accepts only resolved binary markets from the CLOB V2 era", () => {
    expect(isBacktestEligibleMarket(market)).toBe(true);
    expect(isBacktestEligibleMarket({ ...market, startDate: "2024-01-04T00:00:00.000Z" })).toBe(false);
    expect(isBacktestEligibleMarket({ ...market, closed: false })).toBe(false);
    expect(isBacktestEligibleMarket({ ...market, outcomes: ["A", "B"] })).toBe(false);
    expect(isBacktestEligibleMarket({ ...market, outcomePrices: ["0.5", "0.5"] })).toBe(false);
  });
});

describe("momentumBacktestConfigSchema", () => {
  it("applies deterministic v1 defaults", () => {
    expect(momentumBacktestConfigSchema.parse({})).toMatchObject({
      strategy: "momentum_v1",
      initialCapital: "10000",
      positionSizePct: "0.10",
      momentumWindowMinutes: 60,
      slippage: "0.01",
    });
  });

  it("rejects an inverted date range", () => {
    expect(() => momentumBacktestConfigSchema.parse({
      startAt: "2026-06-02T00:00:00.000Z",
      endAt: "2026-06-01T00:00:00.000Z",
    })).toThrow(/later than startAt/);
  });
});

describe("web workspace read contracts", () => {
  it("parses wallet session metadata without credential fields", () => {
    const value = walletSessionStatusSchema.parse({
      sessionId: "00000000-0000-4000-8000-000000000001",
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 0,
      idleExpiresAt: "2026-08-03T00:30:00.000Z",
      expiresAt: "2026-08-03T08:00:00.000Z",
    });
    expect(value).not.toHaveProperty("encryptedCredentials");
  });

  it("parses normalized account and market search data", () => {
    expect(accountOverviewSchema.parse({
      walletAddress: "0x0000000000000000000000000000000000000001",
      positions: [],
      openOrders: [],
      fills: [],
      observedAt: "2026-08-03T00:00:00.000Z",
    }).positions).toEqual([]);
    expect(marketSearchResponseSchema.parse({
      query: "election",
      state: "resolved",
      observedAt: "2026-08-03T00:00:00.000Z",
      events: [],
    }).state).toBe("resolved");
  });
});

describe("paper trading contracts", () => {
  it("accepts exact decimal quote and portfolio payloads", () => {
    expect(paperQuoteSchema.parse({
      conditionId: "0xcondition",
      tokenId: "123",
      marketQuestion: "Will paper contracts parse?",
      outcome: "Yes",
      side: "BUY",
      shares: "10.000000",
      averagePrice: "0.420000",
      limitPrice: "0.430000",
      grossNotional: "4.200000",
      feeRate: "0.040000",
      fee: "0.09744",
      cashEffect: "-4.297440",
      observedAt: "2026-08-03T00:00:00.000Z",
    }).cashEffect).toBe("-4.297440");
    expect(paperPortfolioSchema.parse({
      initialCash: "10000.000000",
      cash: "9995.702560",
      positionsValue: "4.000000",
      equity: "9999.702560",
      realizedPnl: "0.000000",
      unrealizedPnl: "-0.297440",
      totalPnl: "-0.297440",
      totalFees: "0.097440",
      positions: [],
      warnings: [],
      observedAt: "2026-08-03T00:00:00.000Z",
    }).equity).toBe("9999.702560");
  });

  it("rejects zero shares and imprecise paper prices", () => {
    expect(() => paperOrderRequestSchema.parse({
      conditionId: "0xcondition",
      tokenId: "123",
      side: "BUY",
      shares: "0",
      limitPrice: "0.4",
    })).toThrow();
    expect(() => paperOrderRequestSchema.parse({
      conditionId: "0xcondition",
      tokenId: "123",
      side: "BUY",
      shares: "1",
      limitPrice: "0.1234567",
    })).toThrow();
  });
});
