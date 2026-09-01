import { describe, expect, it } from "vitest";
import {
  accountOverviewSchema,
  alertChannelSchema,
  alertCreateChannelRequestSchema,
  alertEventKindSchema,
  paperStrategyActionSchema,
  backtestConfigSchema,
  backtestRunListSchema,
  breakoutBacktestConfigSchema,
  defaultBreakoutBacktestConfig,
  defaultMeanReversionBacktestConfig,
  isBacktestEligibleMarket,
  marketSearchResponseSchema,
  momentumBacktestConfigSchema,
  paperOrderRequestSchema,
  paperPortfolioSchema,
  paperQuoteSchema,
  paperStrategySnapshotSchema,
  paperStrategyStartRequestSchema,
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

describe("backtest capacity contract", () => {
  it("reports the exact active count and limit", () => {
    expect(backtestRunListSchema.parse({
      items: [],
      activeCount: 4,
      activeLimit: 10,
    })).toMatchObject({ activeCount: 4, activeLimit: 10 });
    expect(() => backtestRunListSchema.parse({
      items: [],
      activeCount: 11,
    })).toThrow();
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

  it("defaults an untagged config to momentum", () => {
    expect(backtestConfigSchema.parse({}).strategy).toBe("momentum_v1");
  });

  it("applies defaults for the two additional strategies", () => {
    expect(defaultMeanReversionBacktestConfig).toMatchObject({
      strategy: "mean_reversion_v1",
      reversionWindowMinutes: 60,
      reversionThreshold: "0.05",
    });
    expect(defaultBreakoutBacktestConfig).toMatchObject({
      strategy: "breakout_v1",
      breakoutWindowMinutes: 240,
      breakoutThreshold: "0.02",
    });
  });

  it("rejects cross-strategy fields and non-positive new thresholds", () => {
    expect(() => backtestConfigSchema.parse({
      strategy: "mean_reversion_v1",
      momentumWindowMinutes: 30,
    })).toThrow();
    expect(() => breakoutBacktestConfigSchema.parse({
      strategy: "breakout_v1",
      breakoutThreshold: "0",
    })).toThrow(/greater than zero/);
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

  it("validates bounded background paper strategies and their status snapshot", () => {
    expect(paperStrategyStartRequestSchema.parse({
      conditionId: "0xcondition",
      tokenId: "123",
      entryPrice: "0.35",
      exitPrice: "0.65",
      sharesPerOrder: "10",
      maxPosition: "50",
      intervalSeconds: 15,
    }).maxPosition).toBe("50");
    expect(() => paperStrategyStartRequestSchema.parse({
      conditionId: "0xcondition",
      tokenId: "123",
      entryPrice: "0.70",
      exitPrice: "0.60",
      sharesPerOrder: "10",
      maxPosition: "5",
      intervalSeconds: 1,
    })).toThrow();
    expect(paperStrategySnapshotSchema.parse({ strategy: null, events: [] })).toEqual({ strategy: null, events: [] });
  });
});

describe("alert channel contracts", () => {
  const validDiscord = {
    kind: "discord",
    label: "Trading Discord",
    target: "https://discord.com/api/webhooks/1234/abcdefghij",
    eventKinds: ["BUY", "SELL"],
  };
  const validTelegram = {
    kind: "telegram",
    label: "Phone",
    target: "-1001234567890",
    eventKinds: ["ERROR"],
  };

  it("accepts Discord webhook URLs and Telegram chat ids", () => {
    expect(alertCreateChannelRequestSchema.parse(validDiscord).kind).toBe("discord");
    expect(alertCreateChannelRequestSchema.parse(validTelegram).target).toBe("-1001234567890");
  });

  it("rejects non-webhook, non-HTTPS, and foreign-host Discord targets", () => {
    for (const target of [
      "",
      "not-a-url",
      "https://evil.example/api/webhooks/123/token",
      "http://discord.com/api/webhooks/123/token",
      "https://discord.com/invite/abc",
      "https://evil.com/api/webhooks/123/token",
      "https://discord.com/api/webhooks/",
    ]) {
      expect(() => alertCreateChannelRequestSchema.parse({ ...validDiscord, target })).toThrow();
    }
  });

  it("rejects malformed Telegram chat ids and empty event kinds", () => {
    expect(() => alertCreateChannelRequestSchema.parse({ ...validTelegram, target: "12a" })).toThrow();
    expect(() => alertCreateChannelRequestSchema.parse({ ...validTelegram, target: "" })).toThrow();
    expect(() => alertCreateChannelRequestSchema.parse({ ...validDiscord, eventKinds: [] })).toThrow();
  });

  it("excludes WAIT from alertable event kinds", () => {
    expect([...alertEventKindSchema.options].sort())
      .toEqual([...paperStrategyActionSchema.options.filter((kind) => kind !== "WAIT")].sort());
    expect(alertEventKindSchema.safeParse("WAIT").success).toBe(false);
  });

  it("never exposes the encrypted target on channel responses", () => {
    const keys = Object.keys(alertChannelSchema.shape);
    expect(keys).not.toContain("target");
    expect(keys).not.toContain("encryptedTarget");
    expect(keys).toContain("targetHint");
    expect(alertChannelSchema.parse({
      channelId: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      kind: "telegram",
      label: "Phone",
      eventKinds: ["BUY"],
      enabled: true,
      targetHint: "chat 123456789",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }).targetHint).toBe("chat 123456789");
  });
});
