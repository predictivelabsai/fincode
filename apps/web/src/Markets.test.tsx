/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import type {
  PublicMarket,
  PublicMarketDetail,
  PublicMarketListResponse,
  PublicMarketSummary,
  PublicOrderBook,
  PublicPriceHistory,
} from "@polytrade/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarketDetailWorkspace, MarketsWorkspace } from "./Markets";
import type { GatewayClient } from "./api";
import { GatewayError } from "./api";

// Markets.tsx imports ./env at module scope, and env.ts parses import.meta.env
// eagerly — CI has no .env.local, so the schema must see test values here.
vi.mock("./env", () => ({
  env: {
    VITE_API_URL: "https://api.polytrade.test",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test",
    VITE_CLERK_JWT_TEMPLATE: "polytrade",
    VITE_PUBLIC_SITE_URL: "https://polytrade.chat",
  },
}));

const OBSERVED = "2026-08-30T12:00:00.000Z";

function summary(overrides: Partial<PublicMarketSummary> = {}): PublicMarketSummary {
  return {
    id: "market-1",
    conditionId: "condition-1",
    slug: "fed-rates-september",
    question: "Will the Fed cut rates in September?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.435", "0.565"],
    clobTokenIds: ["123", "456"],
    active: true,
    closed: false,
    acceptingOrders: true,
    endDate: "2026-09-16T00:00:00.000Z",
    liquidity: "50000",
    volume: "1200000",
    ...overrides,
  };
}

function market(overrides: Partial<PublicMarket> = {}): PublicMarket {
  return {
    ...summary(),
    description: "Resolution source: Federal Reserve statements.",
    enableOrderBook: true,
    archived: false,
    restricted: false,
    minimumOrderSize: "5",
    minimumTickSize: "0.01",
    startDate: "2026-08-01T00:00:00.000Z",
    createdAt: null,
    closedTime: null,
    icon: "https://cdn.polytrade.test/fed.png",
    volume24hr: "320000",
    ...overrides,
  };
}

function detail(overrides: Partial<PublicMarketDetail> = {}): PublicMarketDetail {
  return {
    market: market(),
    quotes: [
      { outcome: "Yes", tokenId: "123", price: "0.44", bestBid: "0.42", bestAsk: "0.46", source: "order-book" },
      { outcome: "No", tokenId: "456", price: "0.565", bestBid: null, bestAsk: null, source: "gamma" },
    ],
    observedAt: OBSERVED,
    ...overrides,
  };
}

function book(overrides: Partial<PublicOrderBook> = {}): PublicOrderBook {
  return {
    tokenId: "123",
    minimumOrderSize: "5",
    tickSize: "0.01",
    negativeRisk: false,
    lastTradePrice: "0.44",
    bids: [
      { price: "0.42", size: "500" },
      { price: "0.41", size: "1200" },
    ],
    asks: [
      { price: "0.46", size: "300" },
      { price: "0.47", size: "2400" },
    ],
    observedAt: OBSERVED,
    ...overrides,
  };
}

function history(): PublicPriceHistory {
  return {
    tokenId: "123",
    interval: "1d",
    points: [
      { timestamp: 1756500000000, price: "0.40" },
      { timestamp: 1756503600000, price: "0.48" },
      { timestamp: 1756507200000, price: "0.44" },
    ],
    observedAt: OBSERVED,
  };
}

function listPage(markets: PublicMarketSummary[], hasMore = false): PublicMarketListResponse {
  return { markets, limit: 12, offset: 0, hasMore, observedAt: OBSERVED };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MarketsWorkspace browse", () => {
  it("renders market cards and paginates with the page size", async () => {
    const client = {
      publicMarkets: vi
        .fn()
        .mockResolvedValueOnce(listPage([summary()], true))
        .mockResolvedValueOnce(listPage([summary({ slug: "next-page", id: "market-2" })])),
    } as unknown as GatewayClient;

    render(<MarketsWorkspace client={client} onSelectMarket={vi.fn()} />);
    expect(await screen.findByText("Will the Fed cut rates in September?")).toBeInTheDocument();

    expect(client.publicMarkets).toHaveBeenCalledWith(12, 0, "volume24hr");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Will the Fed cut rates in September?");
    expect(client.publicMarkets).toHaveBeenCalledWith(12, 12, "volume24hr");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await vi.waitFor(() => expect(client.publicMarkets).toHaveBeenCalledWith(12, 0, "volume24hr"));
  });

  it("offers the Gamma source quote as the fallback when a book read fails", async () => {
    const client = {
      publicMarkets: vi.fn().mockResolvedValue(listPage([summary()])),
    } as unknown as GatewayClient;

    render(<MarketsWorkspace client={client} onSelectMarket={vi.fn()} />);

    const card = await screen.findByRole("button", { name: /Will the Fed cut rates/i });
    fireEvent.click(card);
    expect(client.publicMarkets).toHaveBeenCalledTimes(1);
  });

  it("keeps browsing usable when the gateway is unreachable", async () => {
    const client = {
      publicMarkets: vi.fn().mockRejectedValue(
        new GatewayError("Upstream unavailable", "UPSTREAM", 503),
      ),
    } as unknown as GatewayClient;

    render(<MarketsWorkspace client={client} onSelectMarket={vi.fn()} />);

    expect(await screen.findByText("Live market data could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("Upstream unavailable")).toBeInTheDocument();
  });
});

describe("MarketDetailWorkspace", () => {
  it("renders quotes, tape controls, and the order book", async () => {
    const client = {
      publicMarket: vi.fn().mockResolvedValue(detail()),
      publicOrderBook: vi.fn().mockResolvedValue(book()),
      publicPriceHistory: vi.fn().mockResolvedValue(history()),
    } as unknown as GatewayClient;

    render(
      <MarketDetailWorkspace client={client} slug="fed-rates-september" onBack={vi.fn()} />,
    );

    expect(
      await screen.findByRole("heading", { name: "Will the Fed cut rates in September?" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("44¢").length).toBeGreaterThan(0);
    expect(screen.getByText("56.5¢")).toBeInTheDocument();
    expect(screen.getByText("Gamma prices")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1w" })).toBeInTheDocument();
    await screen.findByRole("img", { name: "Price history chart" });
    expect(client.publicPriceHistory).toHaveBeenCalledWith("123", "1d");
    expect(screen.getByText("Best ask / best bid: 46¢ / 42¢")).toBeInTheDocument();
    expect(screen.getByText("42¢")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
  });

  it("switches to the other outcome's book and tape", async () => {
    const client = {
      publicMarket: vi.fn().mockResolvedValue(detail()),
      publicOrderBook: vi.fn().mockResolvedValue(book()),
      publicPriceHistory: vi.fn().mockResolvedValue(history()),
    } as unknown as GatewayClient;

    render(
      <MarketDetailWorkspace client={client} slug="fed-rates-september" onBack={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Will the Fed cut rates in September?" });

    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await act(async () => flushPromises());

    expect(client.publicOrderBook).toHaveBeenCalledWith("456");
    expect(client.publicPriceHistory).toHaveBeenCalledWith("456", "1d");
    expect(screen.getByRole("heading", { name: "No price history" })).toBeInTheDocument();
  });

  it("shows a not-found panel for an unknown slug", async () => {
    const client = {
      publicMarket: vi.fn().mockRejectedValue(
        new GatewayError("Public market not found", "NOT_FOUND", 404),
      ),
      publicOrderBook: vi.fn(),
      publicPriceHistory: vi.fn(),
    } as unknown as GatewayClient;

    render(
      <MarketDetailWorkspace client={client} slug="not-a-market" onBack={vi.fn()} />,
    );

    expect(await screen.findByText("Market not found")).toBeInTheDocument();
    expect(client.publicOrderBook).not.toHaveBeenCalled();
  });

  it("keeps the page alive when the order book read fails", async () => {
    const client = {
      publicMarket: vi.fn().mockResolvedValue(detail()),
      publicOrderBook: vi.fn().mockRejectedValue(new Error("book down")),
      publicPriceHistory: vi.fn().mockResolvedValue(history()),
    } as unknown as GatewayClient;

    render(
      <MarketDetailWorkspace client={client} slug="fed-rates-september" onBack={vi.fn()} />,
    );

    expect(
      await screen.findByRole("heading", { name: "Will the Fed cut rates in September?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("The order book is empty right now.")).toBeInTheDocument();
  });

  it("updates the document title for sharing and tabs", async () => {
    const client = {
      publicMarket: vi.fn().mockResolvedValue(detail()),
      publicOrderBook: vi.fn().mockResolvedValue(book()),
      publicPriceHistory: vi.fn().mockResolvedValue(history()),
    } as unknown as GatewayClient;

    render(
      <MarketDetailWorkspace client={client} slug="fed-rates-september" onBack={vi.fn()} />,
    );
    await screen.findByRole("heading", { name: "Will the Fed cut rates in September?" });

    expect(document.title).toBe("Will the Fed cut rates in September? · PolyTrade");
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}