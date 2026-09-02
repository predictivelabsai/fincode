import { z } from "zod";

export const decimalString = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a non-negative decimal string with at most 6 decimal places");

export const positiveDecimalString = decimalString.refine(
  (value) => Number(value) > 0,
  "Value must be greater than zero",
);

export const signedDecimalString = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d{1,6})?$/, "Use a decimal string with at most 6 decimal places");

export const priceString = positiveDecimalString.refine(
  (value) => Number(value) <= 1,
  "Price must be at most 1",
);

export const evmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");
export const hexSignature = z.string().regex(/^0x[a-fA-F0-9]+$/, "Invalid hexadecimal signature");
export const tokenId = z.string().regex(/^\d+$/, "Token ID must be an unsigned integer");

export const backtestDecimalString = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/, "Use a non-negative decimal string");
export const signedBacktestDecimalString = z
  .string()
  .regex(/^-?(0|[1-9]\d*)(\.\d{1,8})?$/, "Use a decimal string");

export const sideSchema = z.enum(["BUY", "SELL"]);
export const restingOrderTypeSchema = z.enum(["GTC", "GTD"]);
export const immediateOrderTypeSchema = z.enum(["FOK", "FAK"]);
export const orderTypeSchema = z.enum(["GTC", "GTD", "FOK", "FAK"]);

const proposalBase = {
  tokenId,
  marketId: z.string().min(1).max(200),
  marketQuestion: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(200),
  side: sideSchema,
  rationale: z.string().max(2_000).default(""),
  observedAt: z.string().datetime(),
};

export const restingOrderProposalSchema = z
  .object({
    action: z.literal("create"),
    execution: restingOrderTypeSchema,
    ...proposalBase,
    price: priceString,
    size: positiveDecimalString,
    expiration: z.number().int().positive().optional(),
    postOnly: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.execution === "GTD" && value.expiration === undefined) {
      ctx.addIssue({ code: "custom", path: ["expiration"], message: "GTD requires expiration" });
    }
    if (value.execution === "GTC" && value.expiration !== undefined) {
      ctx.addIssue({ code: "custom", path: ["expiration"], message: "GTC cannot include expiration" });
    }
  });

export const immediateOrderProposalSchema = z.object({
  action: z.literal("create"),
  execution: immediateOrderTypeSchema,
  ...proposalBase,
  amount: positiveDecimalString,
  limitPrice: priceString,
  postOnly: z.literal(false).default(false),
});

export const cancellationSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("order"), orderId: z.string().min(1).max(200) }),
  z.object({
    kind: z.literal("market"),
    marketId: z.string().min(1).max(200),
    tokenId: tokenId.optional(),
  }),
  z.object({ kind: z.literal("all") }),
]);

export const cancellationProposalSchema = z.object({
  action: z.literal("cancel"),
  selector: cancellationSelectorSchema,
  rationale: z.string().max(2_000).default(""),
  observedAt: z.string().datetime(),
});

export const tradingActionProposalSchema = z.union([
  restingOrderProposalSchema,
  immediateOrderProposalSchema,
  cancellationProposalSchema,
]);

export const createOrderProposalSchema = z.union([
  restingOrderProposalSchema,
  immediateOrderProposalSchema,
]);

export const signatureTypeSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const walletChallengeRequestSchema = z.object({
  walletAddress: evmAddress,
  signatureType: signatureTypeSchema.default(0),
  funderAddress: evmAddress.optional(),
});

export const walletSessionRequestSchema = z.object({
  challengeId: z.string().uuid(),
  signature: hexSignature,
});

export const createIntentRequestSchema = z.object({
  sessionId: z.string().uuid(),
  proposal: createOrderProposalSchema,
});

export const submitIntentRequestSchema = z.object({
  signature: hexSignature,
});

export const cancelRequestSchema = z.object({
  sessionId: z.string().uuid(),
  selector: cancellationSelectorSchema,
  confirmed: z.literal(true),
});

export const typedDataSchema = z.object({
  domain: z.record(z.string(), z.unknown()),
  types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))),
  primaryType: z.string().min(1),
  message: z.record(z.string(), z.unknown()),
});

export const walletChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  typedData: typedDataSchema,
});

export const walletSessionStatusSchema = z.object({
  sessionId: z.string().uuid(),
  walletAddress: evmAddress,
  funderAddress: evmAddress.optional(),
  signatureType: signatureTypeSchema,
  idleExpiresAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const walletSessionResponseSchema = walletSessionStatusSchema;

const nullableAccountString = z.string().nullable();

export const accountPositionSchema = z.object({
  positionId: z.string().min(1),
  conditionId: nullableAccountString,
  assetId: nullableAccountString,
  marketTitle: nullableAccountString,
  outcome: nullableAccountString,
  size: nullableAccountString,
  averagePrice: nullableAccountString,
  currentPrice: nullableAccountString,
  currentValue: nullableAccountString,
  cashPnl: nullableAccountString,
  percentPnl: nullableAccountString,
  redeemable: z.boolean(),
});

export const accountOrderSchema = z.object({
  orderId: z.string().min(1),
  marketId: nullableAccountString,
  assetId: nullableAccountString,
  outcome: nullableAccountString,
  side: nullableAccountString,
  originalSize: nullableAccountString,
  matchedSize: nullableAccountString,
  remainingSize: nullableAccountString,
  price: nullableAccountString,
  orderType: nullableAccountString,
  status: nullableAccountString,
  createdAt: z.string().datetime().nullable(),
  expiration: z.string().datetime().nullable(),
});

export const accountFillSchema = z.object({
  tradeId: z.string().min(1),
  marketId: nullableAccountString,
  assetId: nullableAccountString,
  outcome: nullableAccountString,
  side: nullableAccountString,
  size: nullableAccountString,
  price: nullableAccountString,
  status: nullableAccountString,
  matchedAt: z.string().datetime().nullable(),
  traderSide: nullableAccountString,
  transactionHash: nullableAccountString,
});

export const accountOverviewSchema = z.object({
  walletAddress: evmAddress,
  funderAddress: evmAddress.optional(),
  positions: z.array(accountPositionSchema),
  openOrders: z.array(accountOrderSchema),
  fills: z.array(accountFillSchema),
  observedAt: z.string().datetime(),
});

const nullableMarketDate = z.string().datetime().nullable();

export const marketSearchMarketSchema = z.object({
  id: z.string(),
  conditionId: z.string(),
  slug: z.string(),
  question: z.string(),
  description: z.string(),
  outcomes: z.array(z.string()),
  outcomePrices: z.array(z.string()),
  clobTokenIds: z.array(z.string()),
  active: z.boolean(),
  closed: z.boolean(),
  acceptingOrders: z.boolean(),
  enableOrderBook: z.boolean(),
  archived: z.boolean(),
  restricted: z.boolean(),
  minimumOrderSize: z.string(),
  minimumTickSize: z.string(),
  endDate: nullableMarketDate,
  startDate: nullableMarketDate,
  createdAt: nullableMarketDate,
  closedTime: nullableMarketDate,
  liquidity: z.string(),
  volume: z.string(),
});

export const marketSearchEventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  endDate: nullableMarketDate,
  liquidity: z.string(),
  volume: z.string(),
  markets: z.array(marketSearchMarketSchema),
});

export const marketSearchResponseSchema = z.object({
  query: z.string(),
  state: z.enum(["active", "resolved"]),
  observedAt: z.string().datetime(),
  events: z.array(marketSearchEventSchema),
});

export const publicMarketSchema = marketSearchMarketSchema.extend({
  icon: z.string().optional(),
  volume24hr: z.string().optional(),
});

export const publicMarketSummarySchema = publicMarketSchema.pick({
  id: true,
  conditionId: true,
  slug: true,
  question: true,
  outcomes: true,
  outcomePrices: true,
  clobTokenIds: true,
  active: true,
  closed: true,
  acceptingOrders: true,
  endDate: true,
  liquidity: true,
  volume: true,
  icon: true,
  volume24hr: true,
});

export const publicOutcomeQuoteSchema = z.object({
  outcome: z.string(),
  tokenId,
  price: z.string().nullable(),
  bestBid: z.string().nullable(),
  bestAsk: z.string().nullable(),
  source: z.enum(["order-book", "gamma"]),
});

export const publicMarketDetailSchema = z.object({
  market: publicMarketSchema,
  quotes: z.array(publicOutcomeQuoteSchema),
  observedAt: z.string().datetime(),
});

export const publicMarketListResponseSchema = z.object({
  markets: z.array(publicMarketSummarySchema),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  observedAt: z.string().datetime(),
});

export const publicOrderBookLevelSchema = z.object({
  price: z.string(),
  size: z.string(),
});

export const publicOrderBookSchema = z.object({
  tokenId,
  minimumOrderSize: z.string(),
  tickSize: z.string(),
  negativeRisk: z.boolean(),
  lastTradePrice: z.string().nullable(),
  bids: z.array(publicOrderBookLevelSchema),
  asks: z.array(publicOrderBookLevelSchema),
  observedAt: z.string().datetime(),
});

export const publicPriceHistorySchema = z.object({
  tokenId,
  interval: z.enum(["1h", "6h", "1d", "1w", "max"]),
  points: z.array(z.object({ timestamp: z.number(), price: z.string() })),
  observedAt: z.string().datetime(),
});

export const paperQuoteRequestSchema = z.object({
  conditionId: z.string().min(1).max(200),
  tokenId,
  side: sideSchema,
  shares: positiveDecimalString,
});

export const paperOrderRequestSchema = paperQuoteRequestSchema.extend({
  limitPrice: priceString,
});

export const paperQuoteSchema = z.object({
  conditionId: z.string().min(1).max(200),
  tokenId,
  marketQuestion: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(200),
  side: sideSchema,
  shares: positiveDecimalString,
  averagePrice: priceString,
  limitPrice: priceString,
  grossNotional: decimalString,
  feeRate: decimalString,
  fee: decimalString,
  cashEffect: signedDecimalString,
  observedAt: z.string().datetime(),
});

export const paperMarkStatusSchema = z.enum(["current", "stale", "unpriced"]);

export const paperPositionSchema = z.object({
  conditionId: z.string().min(1).max(200),
  tokenId,
  marketQuestion: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(200),
  shares: positiveDecimalString,
  costBasis: decimalString,
  averageCost: decimalString,
  bestBid: priceString.nullable(),
  liquidationValue: decimalString,
  unrealizedPnl: signedDecimalString,
  markStatus: paperMarkStatusSchema,
  markedAt: z.string().datetime().nullable(),
});

export const paperFillKindSchema = z.enum(["BUY", "SELL", "SETTLEMENT"]);

export const paperFillSchema = z.object({
  fillId: z.string().uuid(),
  kind: paperFillKindSchema,
  conditionId: z.string().min(1).max(200),
  tokenId,
  marketQuestion: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(200),
  shares: positiveDecimalString,
  averagePrice: decimalString,
  grossNotional: decimalString,
  feeRate: decimalString,
  fee: decimalString,
  cashEffect: signedDecimalString,
  realizedPnl: signedDecimalString,
  observedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const paperPortfolioSchema = z.object({
  initialCash: decimalString,
  cash: decimalString,
  positionsValue: decimalString,
  equity: decimalString,
  realizedPnl: signedDecimalString,
  unrealizedPnl: signedDecimalString,
  totalPnl: signedDecimalString,
  totalFees: decimalString,
  positions: z.array(paperPositionSchema),
  warnings: z.array(z.string()),
  observedAt: z.string().datetime(),
});

export const paperOrderResponseSchema = z.object({
  fill: paperFillSchema,
  portfolio: paperPortfolioSchema,
});

export const paperFillsResponseSchema = z.object({
  items: z.array(paperFillSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const paperShareStatusSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/).nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
});

export const paperShareManageRequestSchema = z.object({
  rotate: z.boolean().default(false),
});

// Public track-record page: a pseudonymous projection of one paper account.
// Everything identity-adjacent (principal id, token/condition ids, cost basis)
// is deliberately dropped so the payload can be served without authentication.
export const publicTrackRecordStatsSchema = z.object({
  initialCash: decimalString,
  cash: decimalString,
  equity: decimalString,
  totalPnl: signedDecimalString,
  realizedPnl: signedDecimalString,
  unrealizedPnl: signedDecimalString,
  totalFees: decimalString,
  tradeCount: z.number().int().nonnegative(),
  winRate: z.string().nullable(),
});

export const publicTrackRecordPointSchema = z.object({
  t: z.string().datetime(),
  equity: decimalString,
});

export const publicTrackRecordProfileSchema = z.object({
  displayName: z.string().min(1).max(80),
  startedAt: z.string().datetime(),
});

export const publicTrackRecordPositionSchema = paperPositionSchema.pick({
  marketQuestion: true,
  outcome: true,
  shares: true,
  averageCost: true,
  liquidationValue: true,
  unrealizedPnl: true,
  markStatus: true,
});

export const publicTrackRecordFillSchema = paperFillSchema.pick({
  fillId: true,
  kind: true,
  marketQuestion: true,
  outcome: true,
  shares: true,
  averagePrice: true,
  fee: true,
  cashEffect: true,
  realizedPnl: true,
  createdAt: true,
});

export const publicTrackRecordSchema = z.object({
  profile: publicTrackRecordProfileSchema,
  stats: publicTrackRecordStatsSchema,
  equityCurve: z.array(publicTrackRecordPointSchema).max(501),
  positions: z.array(publicTrackRecordPositionSchema).max(100),
  fills: z.array(publicTrackRecordFillSchema).max(50),
  observedAt: z.string().datetime(),
});

export const paperStrategyStartRequestSchema = z.object({
  conditionId: z.string().min(1).max(200),
  tokenId,
  entryPrice: priceString,
  exitPrice: priceString,
  sharesPerOrder: positiveDecimalString,
  maxPosition: positiveDecimalString,
  intervalSeconds: z.number().int().min(5).max(3_600),
}).superRefine((value, ctx) => {
  if (Number(value.entryPrice) >= Number(value.exitPrice)) {
    ctx.addIssue({ code: "custom", path: ["exitPrice"], message: "Exit price must be higher than entry price" });
  }
  if (Number(value.maxPosition) < Number(value.sharesPerOrder)) {
    ctx.addIssue({ code: "custom", path: ["maxPosition"], message: "Maximum position must allow one complete order" });
  }
});

export const paperStrategyStatusSchema = z.enum(["RUNNING", "STOPPED", "FAILED"]);
export const paperStrategyActionSchema = z.enum(["STARTED", "WAIT", "BUY", "SELL", "ERROR", "STOPPED"]);

export const paperStrategySchema = z.object({
  strategyId: z.string().uuid(),
  conditionId: z.string().min(1).max(200),
  tokenId,
  marketQuestion: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(200),
  entryPrice: priceString,
  exitPrice: priceString,
  sharesPerOrder: positiveDecimalString,
  maxPosition: positiveDecimalString,
  intervalSeconds: z.number().int().min(5).max(3_600),
  status: paperStrategyStatusSchema,
  ordersPlaced: z.number().int().nonnegative(),
  scansCompleted: z.number().int().nonnegative(),
  lastAction: paperStrategyActionSchema,
  lastMessage: z.string().min(1).max(2_000),
  lastQuoteSide: sideSchema.nullable(),
  lastQuotePrice: priceString.nullable(),
  lastScannedAt: z.string().datetime().nullable(),
  nextScanAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});

export const paperStrategyEventSchema = z.object({
  eventId: z.string().uuid(),
  action: paperStrategyActionSchema,
  message: z.string().min(1).max(2_000),
  side: sideSchema.nullable(),
  price: priceString.nullable(),
  fillId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export const paperStrategySnapshotSchema = z.object({
  strategy: paperStrategySchema.nullable(),
  events: z.array(paperStrategyEventSchema),
});

export const alertChannelKindSchema = z.enum(["discord", "telegram"]);

// Same literal values as paperStrategyActionSchema, minus "WAIT" — WAIT fires on
// every scan and is too noisy to notify on.
export const alertEventKindSchema = z.enum(["STARTED", "BUY", "SELL", "ERROR", "STOPPED"]);

const alertTargetHint = z.string().min(1).max(120);

const alertChannelBase = {
  channelId: z.string().uuid(),
  label: z.string().min(1).max(80),
  eventKinds: z.array(alertEventKindSchema).min(1),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Display-only hint ("discord.com/api/webhooks/…9f2a"). The usable webhook URL
  // or chat id is never serialized — only `target` in the create request, which
  // is encrypted and never echoed back.
  targetHint: alertTargetHint,
};

export const alertChannelSchema = z.object({
  kind: alertChannelKindSchema,
  ...alertChannelBase,
});

export const alertChannelListSchema = z.object({ items: z.array(alertChannelSchema) });

export const alertCreateChannelRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discord"),
    label: z.string().min(1).max(80),
    target: z.string().superRefine((value, ctx) => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        ctx.addIssue({ code: "custom", message: "Target must be an HTTPS Discord webhook URL" });
        return;
      }
      const okHost = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]
        .includes(url.hostname);
      const okPath = /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
      if (url.protocol !== "https:" || !okHost || !okPath) {
        ctx.addIssue({ code: "custom", message: "Target must be an HTTPS Discord webhook URL" });
      }
    }),
    eventKinds: z.array(alertEventKindSchema).min(1),
  }),
  z.object({
    kind: z.literal("telegram"),
    label: z.string().min(1).max(80),
    target: z.string().regex(/^-?\d{3,20}$/, "Target must be a Telegram chat id"),
    eventKinds: z.array(alertEventKindSchema).min(1),
  }),
]);

export const alertDeliveryStatusSchema = z.enum(["pending", "delivered", "failed"]);

export const alertDeliverySchema = z.object({
  deliveryId: z.string().uuid(),
  channelId: z.string().uuid(),
  channelLabel: z.string().min(1).max(80),
  channelKind: alertChannelKindSchema,
  action: paperStrategyActionSchema,
  message: z.string().min(1).max(2_000),
  context: z.object({
    marketQuestion: z.string().max(1_000).nullable(),
    outcome: z.string().max(200).nullable(),
    side: sideSchema.nullable(),
    price: priceString.nullable(),
  }),
  status: alertDeliveryStatusSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable(),
});

export const alertDeliveryListSchema = z.object({
  items: z.array(alertDeliverySchema),
  limit: z.number().int().positive(),
});

export const alertTestSendResponseSchema = z.object({
  status: z.enum(["sent", "failed"]),
  error: z.string().nullable(),
});

export const orderIntentResponseSchema = z.object({
  intentId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  orderType: orderTypeSchema,
  postOnly: z.boolean(),
  typedData: typedDataSchema,
  order: z.record(z.string(), z.unknown()),
});

export const backtestStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const backtestPhaseSchema = z.enum([
  "queued",
  "fetching",
  "simulating",
  "saving",
  "completed",
  "failed",
  "cancelled",
]);
export const backtestOutcomeSchema = z.enum(["YES", "NO"]);

const commonBacktestConfigShape = {
  initialCapital: backtestDecimalString.default("10000"),
  positionSizePct: backtestDecimalString.default("0.10"),
  takeProfit: backtestDecimalString.default("0.10"),
  stopLoss: backtestDecimalString.default("0.05"),
  maxHoldMinutes: z.number().int().min(1).max(43_200).default(1_440),
  cooldownMinutes: z.number().int().min(0).max(43_200).default(60),
  slippage: backtestDecimalString.default("0.01"),
  maxFillDelayMinutes: z.number().int().min(1).max(60).default(5),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
};

type CommonBacktestConfig = {
  initialCapital: string;
  positionSizePct: string;
  takeProfit: string;
  stopLoss: string;
  slippage: string;
  startAt?: string | null;
  endAt?: string | null;
};

function validateCommonBacktestConfig(
  value: CommonBacktestConfig,
  ctx: z.RefinementCtx,
): void {
  if (Number(value.initialCapital) <= 0) {
    ctx.addIssue({ code: "custom", path: ["initialCapital"], message: "Must be greater than zero" });
  }
  if (Number(value.positionSizePct) <= 0 || Number(value.positionSizePct) > 1) {
    ctx.addIssue({ code: "custom", path: ["positionSizePct"], message: "Must be greater than zero and at most one" });
  }
  for (const key of ["takeProfit", "stopLoss", "slippage"] as const) {
    if (Number(value[key]) > 1) {
      ctx.addIssue({ code: "custom", path: [key], message: "Must be at most one" });
    }
  }
  if (value.startAt && value.endAt && Date.parse(value.startAt) >= Date.parse(value.endAt)) {
    ctx.addIssue({ code: "custom", path: ["endAt"], message: "Must be later than startAt" });
  }
}

export const momentumBacktestConfigSchema = z
  .object({
    strategy: z.literal("momentum_v1").default("momentum_v1"),
    ...commonBacktestConfigShape,
    momentumWindowMinutes: z.number().int().min(1).max(1_440).default(60),
    momentumThreshold: backtestDecimalString.default("0.05"),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateCommonBacktestConfig(value, ctx);
    if (Number(value.momentumThreshold) > 1) {
      ctx.addIssue({ code: "custom", path: ["momentumThreshold"], message: "Must be at most one" });
    }
  });

export const meanReversionBacktestConfigSchema = z
  .object({
    strategy: z.literal("mean_reversion_v1").default("mean_reversion_v1"),
    ...commonBacktestConfigShape,
    reversionWindowMinutes: z.number().int().min(1).max(1_440).default(60),
    reversionThreshold: backtestDecimalString.default("0.05"),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateCommonBacktestConfig(value, ctx);
    if (Number(value.reversionThreshold) <= 0 || Number(value.reversionThreshold) > 1) {
      ctx.addIssue({ code: "custom", path: ["reversionThreshold"], message: "Must be greater than zero and at most one" });
    }
  });

export const breakoutBacktestConfigSchema = z
  .object({
    strategy: z.literal("breakout_v1").default("breakout_v1"),
    ...commonBacktestConfigShape,
    breakoutWindowMinutes: z.number().int().min(1).max(1_440).default(240),
    breakoutThreshold: backtestDecimalString.default("0.02"),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateCommonBacktestConfig(value, ctx);
    if (Number(value.breakoutThreshold) <= 0 || Number(value.breakoutThreshold) > 1) {
      ctx.addIssue({ code: "custom", path: ["breakoutThreshold"], message: "Must be greater than zero and at most one" });
    }
  });

const taggedBacktestConfigSchema = z.discriminatedUnion("strategy", [
  momentumBacktestConfigSchema,
  meanReversionBacktestConfigSchema,
  breakoutBacktestConfigSchema,
]);

export const backtestConfigSchema = z.preprocess((value) => {
  if (value && typeof value === "object" && !Array.isArray(value) && !("strategy" in value)) {
    return { strategy: "momentum_v1", ...value };
  }
  return value;
}, taggedBacktestConfigSchema);

export const defaultMomentumBacktestConfig = momentumBacktestConfigSchema.parse({
  strategy: "momentum_v1",
});
export const defaultMeanReversionBacktestConfig = meanReversionBacktestConfigSchema.parse({
  strategy: "mean_reversion_v1",
});
export const defaultBreakoutBacktestConfig = breakoutBacktestConfigSchema.parse({
  strategy: "breakout_v1",
});

export const createBacktestRequestSchema = z.object({
  marketId: z.string().min(1).max(200),
  config: backtestConfigSchema.default(defaultMomentumBacktestConfig),
});

export const backtestFailureSchema = z.object({ code: z.string(), message: z.string() });

export const backtestRunSchema = z.object({
  runId: z.string().uuid(),
  marketId: z.string(),
  marketQuestion: z.string().nullable().optional(),
  status: backtestStatusSchema,
  phase: backtestPhaseSchema,
  progress: z.number().int().min(0).max(100),
  config: backtestConfigSchema,
  resolvedOutcome: backtestOutcomeSchema.nullable().optional(),
  datasetHash: z.string().length(64).nullable().optional(),
  cancelRequested: z.boolean().default(false),
  failure: backtestFailureSchema.nullable().optional(),
  warnings: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
});

export const backtestMetricsSchema = z.object({
  initialCapital: backtestDecimalString,
  finalEquity: backtestDecimalString,
  pnl: signedBacktestDecimalString,
  returnPct: signedBacktestDecimalString,
  maxDrawdownPct: backtestDecimalString,
  tradeCount: z.number().int().nonnegative(),
  winRatePct: backtestDecimalString,
  profitFactor: backtestDecimalString.nullable(),
  averageHoldingSeconds: backtestDecimalString,
  exposurePct: backtestDecimalString,
  fees: backtestDecimalString,
  skippedSignals: z.number().int().nonnegative(),
  yesBuyHoldReturnPct: signedBacktestDecimalString,
  noBuyHoldReturnPct: signedBacktestDecimalString,
});

export const backtestResultSchema = z.object({
  metrics: backtestMetricsSchema,
  assumptions: z.array(z.string()),
});

export const backtestTradeSchema = z.object({
  tradeIndex: z.number().int().nonnegative(),
  outcome: backtestOutcomeSchema,
  entryAt: z.string().datetime(),
  exitAt: z.string().datetime(),
  entryPrice: backtestDecimalString,
  exitPrice: backtestDecimalString,
  shares: backtestDecimalString,
  entryFee: backtestDecimalString,
  exitFee: backtestDecimalString,
  pnl: signedBacktestDecimalString,
  exitReason: z.enum(["take_profit", "stop_loss", "max_hold", "settlement"]),
});

export const backtestSeriesPointSchema = z.object({
  timestamp: z.string().datetime(),
  yesPrice: backtestDecimalString.nullable().optional(),
  noPrice: backtestDecimalString.nullable().optional(),
  equity: backtestDecimalString,
});

export const backtestRunEnvelopeSchema = z.object({
  run: backtestRunSchema,
  result: backtestResultSchema.nullable().optional(),
});
export const backtestRunListSchema = z.object({
  items: z.array(backtestRunSchema),
  activeCount: z.number().int().nonnegative(),
  activeLimit: z.number().int().positive(),
});
export const backtestTradesResponseSchema = z.object({
  runId: z.string().uuid(),
  items: z.array(backtestTradeSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export const backtestSeriesResponseSchema = z.object({
  runId: z.string().uuid(),
  points: z.array(backtestSeriesPointSchema),
});

export type TradingActionProposal = z.infer<typeof tradingActionProposalSchema>;
export type CreateOrderProposal = z.infer<typeof createOrderProposalSchema>;
export type CancellationSelector = z.infer<typeof cancellationSelectorSchema>;
export type WalletChallengeRequest = z.infer<typeof walletChallengeRequestSchema>;
export type WalletChallengeResponse = z.infer<typeof walletChallengeResponseSchema>;
export type WalletSessionRequest = z.infer<typeof walletSessionRequestSchema>;
export type WalletSessionResponse = z.infer<typeof walletSessionResponseSchema>;
export type WalletSessionStatus = z.infer<typeof walletSessionStatusSchema>;
export type AccountPosition = z.infer<typeof accountPositionSchema>;
export type AccountOrder = z.infer<typeof accountOrderSchema>;
export type AccountFill = z.infer<typeof accountFillSchema>;
export type AccountOverview = z.infer<typeof accountOverviewSchema>;
export type MarketSearchMarket = z.infer<typeof marketSearchMarketSchema>;
export type MarketSearchEvent = z.infer<typeof marketSearchEventSchema>;
export type MarketSearchResponse = z.infer<typeof marketSearchResponseSchema>;
export type PublicMarket = z.infer<typeof publicMarketSchema>;
export type PublicMarketSummary = z.infer<typeof publicMarketSummarySchema>;
export type PublicOutcomeQuote = z.infer<typeof publicOutcomeQuoteSchema>;
export type PublicMarketDetail = z.infer<typeof publicMarketDetailSchema>;
export type PublicMarketListResponse = z.infer<typeof publicMarketListResponseSchema>;
export type PublicOrderBookLevel = z.infer<typeof publicOrderBookLevelSchema>;
export type PublicOrderBook = z.infer<typeof publicOrderBookSchema>;
export type PublicPriceHistory = z.infer<typeof publicPriceHistorySchema>;
export type PaperQuoteRequest = z.infer<typeof paperQuoteRequestSchema>;
export type PaperOrderRequest = z.infer<typeof paperOrderRequestSchema>;
export type PaperQuote = z.infer<typeof paperQuoteSchema>;
export type PaperMarkStatus = z.infer<typeof paperMarkStatusSchema>;
export type PaperPosition = z.infer<typeof paperPositionSchema>;
export type PaperFillKind = z.infer<typeof paperFillKindSchema>;
export type PaperFill = z.infer<typeof paperFillSchema>;
export type PaperPortfolio = z.infer<typeof paperPortfolioSchema>;
export type PaperOrderResponse = z.infer<typeof paperOrderResponseSchema>;
export type PaperFillsResponse = z.infer<typeof paperFillsResponseSchema>;
export type PaperStrategyStartRequest = z.infer<typeof paperStrategyStartRequestSchema>;
export type PaperStrategyStatus = z.infer<typeof paperStrategyStatusSchema>;
export type PaperStrategyAction = z.infer<typeof paperStrategyActionSchema>;
export type PaperStrategy = z.infer<typeof paperStrategySchema>;
export type PaperStrategyEvent = z.infer<typeof paperStrategyEventSchema>;
export type PaperStrategySnapshot = z.infer<typeof paperStrategySnapshotSchema>;
export type PaperShareStatus = z.infer<typeof paperShareStatusSchema>;
export type PaperShareManageRequest = z.infer<typeof paperShareManageRequestSchema>;
export type PublicTrackRecord = z.infer<typeof publicTrackRecordSchema>;
export type PublicTrackRecordStats = z.infer<typeof publicTrackRecordStatsSchema>;
export type PublicTrackRecordPoint = z.infer<typeof publicTrackRecordPointSchema>;
export type PublicTrackRecordProfile = z.infer<typeof publicTrackRecordProfileSchema>;
export type PublicTrackRecordPosition = z.infer<typeof publicTrackRecordPositionSchema>;
export type PublicTrackRecordFill = z.infer<typeof publicTrackRecordFillSchema>;
export type AlertChannelKind = z.infer<typeof alertChannelKindSchema>;
export type AlertEventKind = z.infer<typeof alertEventKindSchema>;
export type AlertChannel = z.infer<typeof alertChannelSchema>;
export type AlertChannelList = z.infer<typeof alertChannelListSchema>;
export type AlertCreateChannelRequest = z.infer<typeof alertCreateChannelRequestSchema>;
export type AlertDeliveryStatus = z.infer<typeof alertDeliveryStatusSchema>;
export type AlertDelivery = z.infer<typeof alertDeliverySchema>;
export type AlertDeliveryList = z.infer<typeof alertDeliveryListSchema>;
export type AlertTestSendResponse = z.infer<typeof alertTestSendResponseSchema>;
export type CreateIntentRequest = z.infer<typeof createIntentRequestSchema>;
export type OrderIntentResponse = z.infer<typeof orderIntentResponseSchema>;
export type TypedData = z.infer<typeof typedDataSchema>;
export type MomentumBacktestConfig = z.infer<typeof momentumBacktestConfigSchema>;
export type MeanReversionBacktestConfig = z.infer<typeof meanReversionBacktestConfigSchema>;
export type BreakoutBacktestConfig = z.infer<typeof breakoutBacktestConfigSchema>;
export type BacktestConfig = z.infer<typeof backtestConfigSchema>;
export type BacktestStrategy = BacktestConfig["strategy"];
export type CreateBacktestRequest = z.infer<typeof createBacktestRequestSchema>;
export type BacktestStatus = z.infer<typeof backtestStatusSchema>;
export type BacktestPhase = z.infer<typeof backtestPhaseSchema>;
export type BacktestOutcome = z.infer<typeof backtestOutcomeSchema>;
export type BacktestRun = z.infer<typeof backtestRunSchema>;
export type BacktestMetrics = z.infer<typeof backtestMetricsSchema>;
export type BacktestResult = z.infer<typeof backtestResultSchema>;
export type BacktestTrade = z.infer<typeof backtestTradeSchema>;
export type BacktestSeriesPoint = z.infer<typeof backtestSeriesPointSchema>;
export type BacktestRunEnvelope = z.infer<typeof backtestRunEnvelopeSchema>;
export type BacktestRunList = z.infer<typeof backtestRunListSchema>;
export type BacktestTradesResponse = z.infer<typeof backtestTradesResponseSchema>;
export type BacktestSeriesResponse = z.infer<typeof backtestSeriesResponseSchema>;

export const BACKTEST_CLOB_V2_START = "2026-04-28T00:00:00.000Z";

export function isBacktestEligibleMarket(market: MarketSearchMarket): boolean {
  const labels = market.outcomes.map((outcome) => outcome.trim().toUpperCase());
  const resolutionPrices = market.outcomePrices.map(Number);
  const startedAt = market.startDate ?? market.createdAt;
  return market.closed
    && !market.acceptingOrders
    && market.enableOrderBook
    && labels.length === 2
    && new Set(labels).size === 2
    && labels.includes("YES")
    && labels.includes("NO")
    && market.clobTokenIds.length === 2
    && resolutionPrices.length === 2
    && resolutionPrices.every(Number.isFinite)
    && resolutionPrices.filter((price) => price === 1).length === 1
    && resolutionPrices.filter((price) => price === 0).length === 1
    && startedAt !== null
    && Date.parse(startedAt) >= Date.parse(BACKTEST_CLOB_V2_START);
}

// The winning outcome of a resolved binary market is the one Gamma prices at
// exactly 1. Anything ambiguous (50-50, malformed prices, still trading)
// yields null so callers can void the grade instead of guessing.
export function resolvedBinaryMarketWinner(market: MarketSearchMarket): string | null {
  if (!market.closed || market.acceptingOrders) return null;
  if (market.outcomes.length !== 2 || market.outcomePrices.length !== 2) return null;
  const resolutionPrices = market.outcomePrices.map(Number);
  if (!resolutionPrices.every(Number.isFinite)) return null;
  const winners = market.outcomes.filter((_, index) => resolutionPrices[index] === 1);
  if (winners.length !== 1) return null;
  return winners[0]!;
}

export const confidenceString = z
  .string()
  .regex(
    /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/,
    "Use a decimal string between 0 and 1 with at most 4 decimal places",
  );

export const agentPredictionRequestSchema = z.object({
  conditionId: z.string().min(1).max(200),
  tokenId: tokenId.optional(),
  marketQuestion: z.string().min(1).max(1000),
  predictedOutcome: z.string().min(1).max(200),
  confidence: confidenceString.optional(),
});

export const agentPredictionStatusSchema = z.enum(["PENDING", "GRADED", "VOID"]);

export const agentPredictionRecordSchema = agentPredictionRequestSchema.extend({
  predictionId: z.string().uuid(),
  status: agentPredictionStatusSchema,
  madeAt: z.string().datetime(),
  category: z.string().nullable(),
});

export const agentPredictionCategorySchema = z.object({
  category: z.string(),
  graded: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  hitRatePct: z.string().nullable(),
});

export const agentPredictionRecentSchema = z.object({
  marketQuestion: z.string(),
  predictedOutcome: z.string(),
  gradedOutcome: z.string().nullable(),
  hit: z.boolean().nullable(),
  madeAt: z.string().datetime(),
  gradedAt: z.string().datetime().nullable(),
  category: z.string().nullable(),
});

export const agentPredictionHitRateSchema = z.object({
  totals: z.object({
    graded: z.number().int().nonnegative(),
    hits: z.number().int().nonnegative(),
    hitRatePct: z.string().nullable(),
    pending: z.number().int().nonnegative(),
    voided: z.number().int().nonnegative(),
    lastGradedAt: z.string().datetime().nullable(),
  }),
  byCategory: z.array(agentPredictionCategorySchema).max(8),
  recent: z.array(agentPredictionRecentSchema).max(25),
  observedAt: z.string().datetime(),
});

export type AgentPredictionRequest = z.infer<typeof agentPredictionRequestSchema>;
export type AgentPredictionStatus = z.infer<typeof agentPredictionStatusSchema>;
export type AgentPredictionRecord = z.infer<typeof agentPredictionRecordSchema>;
export type AgentPredictionCategory = z.infer<typeof agentPredictionCategorySchema>;
export type AgentPredictionRecent = z.infer<typeof agentPredictionRecentSchema>;
export type AgentPredictionHitRate = z.infer<typeof agentPredictionHitRateSchema>;
