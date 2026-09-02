/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AgentPredictionHitRate } from "@polytrade/contracts";

import { GatewayError } from "./api";
import AccuracyPage from "./AccuracyPage";
import { fetchPublicAgentScorecard } from "./public-api";

vi.mock("./public-api", () => ({ fetchPublicAgentScorecard: vi.fn() }));

// CI has no .env.local; AccuracyPage.tsx reads env at module scope.
vi.mock("./env", () => ({
  env: {
    VITE_API_URL: "https://api.polytrade.test",
    VITE_CLERK_PUBLISHABLE_KEY: "pk_test",
    VITE_CLERK_JWT_TEMPLATE: "polytrade",
  },
}));

const scorecard: AgentPredictionHitRate = {
  totals: {
    graded: 3,
    hits: 2,
    hitRatePct: "66.67",
    pending: 2,
    voided: 1,
    lastGradedAt: "2026-09-01T00:00:00.000Z",
  },
  byCategory: [
    { category: "Economics", graded: 2, hits: 1, hitRatePct: "50.00" },
    { category: "Crypto", graded: 1, hits: 1, hitRatePct: "100.00" },
  ],
  recent: [
    {
      marketQuestion: "Will the Fed hold rates in September?",
      predictedOutcome: "Yes",
      gradedOutcome: "Yes",
      hit: true,
      madeAt: "2026-08-28T00:00:00.000Z",
      gradedAt: "2026-09-01T00:00:00.000Z",
      category: "Economics",
    },
    {
      marketQuestion: "Will ETH close above $5,000 in August?",
      predictedOutcome: "Yes",
      gradedOutcome: "No",
      hit: false,
      madeAt: "2026-08-20T00:00:00.000Z",
      gradedAt: "2026-09-01T00:00:00.000Z",
      category: "Crypto",
    },
  ],
  observedAt: "2026-09-02T00:00:00.000Z",
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/accuracy"]}>
      <AccuracyPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(fetchPublicAgentScorecard).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("AccuracyPage", () => {
  it("renders the totals, by-category table, and recent graded calls", async () => {
    vi.mocked(fetchPublicAgentScorecard).mockResolvedValue(scorecard);
    renderPage();

    expect(await screen.findByRole("heading", { name: "Prediction accuracy" })).toBeInTheDocument();
    expect(screen.getAllByText("Hit rate").length).toBeGreaterThan(0);
    expect(screen.getByText("66.67%")).toBeInTheDocument();
    expect(screen.getByText("By category")).toBeInTheDocument();
    expect(screen.getAllByText("Economics").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Will the Fed hold rates in September?").length).toBeGreaterThan(0);
    expect(screen.getByText("Hit", { selector: ".accuracy-pill" })).toBeInTheDocument();
    expect(screen.getByText("Miss", { selector: ".accuracy-pill" })).toBeInTheDocument();
    expect(screen.getByText(/Past accuracy does not predict future results/)).toBeInTheDocument();
    // The public fetch carries no credentials and no token argument.
    expect(fetchPublicAgentScorecard).toHaveBeenCalledWith("https://api.polytrade.test");
  });

  it("renders the empty state before anything has graded", async () => {
    vi.mocked(fetchPublicAgentScorecard).mockResolvedValue({
      totals: { graded: 0, hits: 0, hitRatePct: null, pending: 0, voided: 0, lastGradedAt: null },
      byCategory: [],
      recent: [],
      observedAt: "2026-09-02T00:00:00.000Z",
    });
    renderPage();

    expect(await screen.findByText(/No graded calls yet/)).toBeInTheDocument();
    expect(screen.queryByText("By category")).toBeNull();
    expect(screen.queryByText("Recent graded predictions")).toBeNull();
  });

  it("marks the tab title without adding a noindex meta", async () => {
    vi.mocked(fetchPublicAgentScorecard).mockResolvedValue(scorecard);
    renderPage();
    await screen.findByRole("heading", { name: "Prediction accuracy" });
    expect(document.title).toBe("Prediction accuracy · PolyTrade");
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("offers a retry after a transient gateway failure", async () => {
    vi.mocked(fetchPublicAgentScorecard)
      .mockRejectedValueOnce(new GatewayError("upstream unavailable", "UPSTREAM", 503))
      .mockResolvedValueOnce(scorecard);
    renderPage();

    expect(await screen.findByText("Accuracy scorecard could not be loaded")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("heading", { name: "Prediction accuracy" })).toBeInTheDocument();
    expect(fetchPublicAgentScorecard).toHaveBeenCalledTimes(2);
  });
});