/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayClient } from "./api";
import { PaperWorkspace } from "./Paper";

const portfolio = {
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
  observedAt: "2026-08-04T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaperWorkspace live dashboard", () => {
  it("polls persistent strategy, portfolio, and first-page fills every three seconds", async () => {
    vi.useFakeTimers();
    const client = {
      refreshPaperPortfolio: vi.fn(async () => portfolio),
      paperPortfolio: vi.fn(async () => portfolio),
      paperFills: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 20 })),
      paperStrategy: vi.fn(async () => ({ strategy: null, events: [] })),
    } as unknown as GatewayClient;
    const view = render(<PaperWorkspace client={client} onError={vi.fn()} onNotice={vi.fn()} />);

    await act(async () => flushPromises());
    expect(screen.getByRole("heading", { name: "Paper trading" })).toBeInTheDocument();
    vi.mocked(client.paperPortfolio).mockClear();
    vi.mocked(client.paperStrategy).mockClear();
    vi.mocked(client.paperFills).mockClear();

    await act(async () => {
      vi.advanceTimersByTime(3_000);
      await flushPromises();
    });

    expect(client.paperPortfolio).toHaveBeenCalledOnce();
    expect(client.paperStrategy).toHaveBeenCalledOnce();
    expect(client.paperFills).toHaveBeenCalledWith(20, 0);

    view.unmount();
    vi.mocked(client.paperPortfolio).mockClear();
    vi.advanceTimersByTime(3_000);
    expect(client.paperPortfolio).not.toHaveBeenCalled();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
