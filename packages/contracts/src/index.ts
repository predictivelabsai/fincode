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

export const momentumBacktestConfigSchema = z
  .object({
    strategy: z.literal("momentum_v1").default("momentum_v1"),
    initialCapital: backtestDecimalString.default("10000"),
    positionSizePct: backtestDecimalString.default("0.10"),
    momentumWindowMinutes: z.number().int().min(1).max(1_440).default(60),
    momentumThreshold: backtestDecimalString.default("0.05"),
    takeProfit: backtestDecimalString.default("0.10"),
    stopLoss: backtestDecimalString.default("0.05"),
    maxHoldMinutes: z.number().int().min(1).max(43_200).default(1_440),
    cooldownMinutes: z.number().int().min(0).max(43_200).default(60),
    slippage: backtestDecimalString.default("0.01"),
    maxFillDelayMinutes: z.number().int().min(1).max(60).default(5),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (Number(value.initialCapital) <= 0) {
      ctx.addIssue({ code: "custom", path: ["initialCapital"], message: "Must be greater than zero" });
    }
    if (Number(value.positionSizePct) <= 0 || Number(value.positionSizePct) > 1) {
      ctx.addIssue({ code: "custom", path: ["positionSizePct"], message: "Must be greater than zero and at most one" });
    }
    for (const key of ["momentumThreshold", "takeProfit", "stopLoss", "slippage"] as const) {
      if (Number(value[key]) > 1) {
        ctx.addIssue({ code: "custom", path: [key], message: "Must be at most one" });
      }
    }
    if (value.startAt && value.endAt && Date.parse(value.startAt) >= Date.parse(value.endAt)) {
      ctx.addIssue({ code: "custom", path: ["endAt"], message: "Must be later than startAt" });
    }
  });

export const defaultMomentumBacktestConfig = momentumBacktestConfigSchema.parse({});

export const createBacktestRequestSchema = z.object({
  marketId: z.string().min(1).max(200),
  config: momentumBacktestConfigSchema.default(defaultMomentumBacktestConfig),
});

export const backtestFailureSchema = z.object({ code: z.string(), message: z.string() });

export const backtestRunSchema = z.object({
  runId: z.string().uuid(),
  marketId: z.string(),
  marketQuestion: z.string().nullable().optional(),
  status: backtestStatusSchema,
  phase: backtestPhaseSchema,
  progress: z.number().int().min(0).max(100),
  config: momentumBacktestConfigSchema,
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
export const backtestRunListSchema = z.object({ items: z.array(backtestRunSchema) });
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
export type CreateIntentRequest = z.infer<typeof createIntentRequestSchema>;
export type OrderIntentResponse = z.infer<typeof orderIntentResponseSchema>;
export type TypedData = z.infer<typeof typedDataSchema>;
export type MomentumBacktestConfig = z.infer<typeof momentumBacktestConfigSchema>;
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
