import {
  accountOverviewSchema,
  cancelRequestSchema,
  marketSearchResponseSchema,
  orderIntentResponseSchema,
  paperFillsResponseSchema,
  paperOrderResponseSchema,
  paperPortfolioSchema,
  paperQuoteSchema,
  paperStrategySnapshotSchema,
  publicMarketDetailSchema,
  publicMarketListResponseSchema,
  publicOrderBookSchema,
  publicPriceHistorySchema,
  walletChallengeResponseSchema,
  walletSessionResponseSchema,
  walletSessionStatusSchema,
  type AccountOverview,
  type CancellationSelector,
  type CreateOrderProposal,
  type MarketSearchResponse,
  type OrderIntentResponse,
  type PaperFillsResponse,
  type PaperOrderRequest,
  type PaperOrderResponse,
  type PaperPortfolio,
  type PaperQuote,
  type PaperQuoteRequest,
  type PaperStrategySnapshot,
  type PaperStrategyStartRequest,
  type PublicMarketDetail,
  type PublicMarketListResponse,
  type PublicOrderBook,
  type PublicPriceHistory,
  type WalletChallengeRequest,
  type WalletChallengeResponse,
  type WalletSessionResponse,
  type WalletSessionStatus,
} from "@polytrade/contracts";
import type { Hex } from "viem";

export interface AccountSnapshot {
  walletAddress: string;
  funderAddress?: string;
  positions: unknown[];
  openOrders: unknown[];
  trades: unknown[];
  observedAt: string;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type MarketHistoryInterval = "1h" | "6h" | "1d" | "1w" | "max";

export class GatewayClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  createChallenge(body: WalletChallengeRequest): Promise<WalletChallengeResponse> {
    return this.request("/v1/wallet-sessions/challenge", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((value) => walletChallengeResponseSchema.parse(value));
  }

  createWalletSession(challengeId: string, signature: Hex): Promise<WalletSessionResponse> {
    return this.request("/v1/wallet-sessions", {
      method: "POST",
      body: JSON.stringify({ challengeId, signature }),
    }).then((value) => walletSessionResponseSchema.parse(value));
  }

  revokeWalletSession(sessionId: string): Promise<void> {
    return this.request(`/v1/wallet-sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  currentWalletSession(): Promise<WalletSessionStatus> {
    return this.request("/v1/wallet-sessions/current")
      .then((value) => walletSessionStatusSchema.parse(value));
  }

  account(): Promise<AccountSnapshot> {
    return this.request("/v1/account/snapshot");
  }

  accountOverview(): Promise<AccountOverview> {
    return this.request("/v1/account/overview")
      .then((value) => accountOverviewSchema.parse(value));
  }

  searchMarkets(query: string, state: "active" | "resolved" = "active", limit = 20): Promise<MarketSearchResponse> {
    const search = new URLSearchParams({ query, state, limit: String(limit) });
    return this.request(`/v1/research/markets?${search}`)
      .then((value) => marketSearchResponseSchema.parse(value));
  }

  paperPortfolio(): Promise<PaperPortfolio> {
    return this.request("/v1/paper/portfolio")
      .then((value) => paperPortfolioSchema.parse(value));
  }

  paperQuote(body: PaperQuoteRequest): Promise<PaperQuote> {
    return this.request("/v1/paper/quotes", {
      method: "POST",
      body: JSON.stringify(body),
    }).then((value) => paperQuoteSchema.parse(value));
  }

  paperOrder(body: PaperOrderRequest, idempotencyKey?: string): Promise<PaperOrderResponse> {
    return this.request("/v1/paper/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }, idempotencyKey).then((value) => paperOrderResponseSchema.parse(value));
  }

  refreshPaperPortfolio(): Promise<PaperPortfolio> {
    return this.request("/v1/paper/refresh", { method: "POST" })
      .then((value) => paperPortfolioSchema.parse(value));
  }

  paperFills(limit = 20, offset = 0): Promise<PaperFillsResponse> {
    const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request(`/v1/paper/fills?${search}`)
      .then((value) => paperFillsResponseSchema.parse(value));
  }

  paperStrategy(): Promise<PaperStrategySnapshot> {
    return this.request("/v1/paper/strategy")
      .then((value) => paperStrategySnapshotSchema.parse(value));
  }

  startPaperStrategy(body: PaperStrategyStartRequest, idempotencyKey?: string): Promise<PaperStrategySnapshot> {
    return this.request("/v1/paper/strategy", {
      method: "POST",
      body: JSON.stringify(body),
    }, idempotencyKey).then((value) => paperStrategySnapshotSchema.parse(value));
  }

  stopPaperStrategy(): Promise<PaperStrategySnapshot> {
    return this.request("/v1/paper/strategy/stop", { method: "POST" })
      .then((value) => paperStrategySnapshotSchema.parse(value));
  }

  createIntent(
    sessionId: string,
    proposal: CreateOrderProposal,
    idempotencyKey?: string,
  ): Promise<OrderIntentResponse> {
    return this.request("/v1/order-intents", {
      method: "POST",
      body: JSON.stringify({ sessionId, proposal }),
    }, idempotencyKey).then((value) => orderIntentResponseSchema.parse(value));
  }

  submitIntent(intentId: string, signature: Hex, idempotencyKey?: string): Promise<unknown> {
    return this.request(`/v1/order-intents/${encodeURIComponent(intentId)}/submit`, {
      method: "POST",
      body: JSON.stringify({ signature }),
    }, idempotencyKey);
  }

  cancel(sessionId: string, selector: CancellationSelector): Promise<unknown> {
    return this.request("/v1/cancellations", {
      method: "POST",
      body: JSON.stringify(cancelRequestSchema.parse({ sessionId, selector, confirmed: true })),
    });
  }

  publicMarkets(limit = 12, offset = 0, order: "volume24hr" | "liquidity" | "endDate" = "volume24hr"): Promise<PublicMarketListResponse> {
    const search = new URLSearchParams({ limit: String(limit), offset: String(offset), order });
    return this.request(`/v1/public/markets?${search}`)
      .then((value) => publicMarketListResponseSchema.parse(value));
  }

  publicMarket(slug: string): Promise<PublicMarketDetail> {
    return this.request(`/v1/public/markets/${encodeURIComponent(slug)}`)
      .then((value) => publicMarketDetailSchema.parse(value));
  }

  publicOrderBook(tokenId: string): Promise<PublicOrderBook> {
    return this.request(`/v1/public/order-books/${encodeURIComponent(tokenId)}`)
      .then((value) => publicOrderBookSchema.parse(value));
  }

  publicPriceHistory(tokenId: string, interval: MarketHistoryInterval = "1d"): Promise<PublicPriceHistory> {
    const search = new URLSearchParams({ interval });
    return this.request(`/v1/public/price-history/${encodeURIComponent(tokenId)}?${search}`)
      .then((value) => publicPriceHistorySchema.parse(value));
  }

  private async request<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    const token = await this.getToken();
    const method = init.method?.toUpperCase() ?? "GET";
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    else headers.delete("Authorization");
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    if (method !== "GET" && method !== "HEAD") {
      headers.set("Idempotency-Key", idempotencyKey ?? crypto.randomUUID());
    }
    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
      credentials: "omit",
    });
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    if (!response.ok) {
      throw new GatewayError(
        payload?.error?.message ?? `Gateway request failed (${response.status})`,
        payload?.error?.code ?? "GATEWAY_ERROR",
        response.status,
      );
    }
    return payload as T;
  }
}
