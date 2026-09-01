/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GatewayClient } from "./api";
import { PaperWorkspace } from "./Paper";
import { ShareCard } from "./TrackRecord";

// CI has no .env.local; ShareCard's module pulls env at import time.
vi.mock("./env", () => ({
  env: {
    VITE_API_URL: "https://api.polytrade.test",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test",
    VITE_CLERK_JWT_TEMPLATE: "polytrade",
  },
}));

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

const noShare = { token: null, enabled: false, createdAt: null, updatedAt: null };

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
      paperShareStatus: vi.fn(async () => noShare),
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

describe("ShareCard", () => {
  it("creates a link from the private state and shows the share URL", async () => {
    const token = "a".repeat(32);
    const client = {
      paperShareStatus: vi.fn(async () => noShare),
      enablePaperShare: vi.fn(async () => ({
        token,
        enabled: true,
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      })),
    } as unknown as GatewayClient;
    const onNotice = vi.fn();
    render(<ShareCard client={client} onNotice={onNotice} onError={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /Create share link/ }));
    expect(client.enablePaperShare).toHaveBeenCalledWith(false);
    expect(await screen.findByText("Public")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`/u/${token}`))).toBeInTheDocument();
    expect(onNotice).toHaveBeenCalledWith("Share link created.");
  });

  it("flips to private when the link is disabled", async () => {
    const token = "b".repeat(32);
    const client = {
      paperShareStatus: vi.fn(async () => ({
        token,
        enabled: true,
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      })),
      enablePaperShare: vi.fn(),
      disablePaperShare: vi.fn(async () => ({ token, enabled: false, createdAt: null, updatedAt: null })),
    } as unknown as GatewayClient;
    render(<ShareCard client={client} onNotice={vi.fn()} onError={vi.fn()} />);

    expect(await screen.findByText("Public")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`/u/${token}`))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Disable sharing/ }));
    expect(await screen.findByText("Private")).toBeInTheDocument();
    expect(client.disablePaperShare).toHaveBeenCalledOnce();
  });
});
