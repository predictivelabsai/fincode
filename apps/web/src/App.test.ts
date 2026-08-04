import { describe, expect, it } from "vitest";

import { maximumExposure } from "./order";

describe("maximumExposure", () => {
  it("calculates resting buy exposure without changing decimal inputs", () => {
    expect(maximumExposure({
      action: "create",
      execution: "GTC",
      tokenId: "1",
      marketId: "market",
      marketQuestion: "Question?",
      outcome: "Yes",
      side: "BUY",
      rationale: "",
      observedAt: "2026-08-03T00:00:00.000Z",
      price: "0.42",
      size: "10",
      postOnly: false,
    })).toBe("4.2 USDC");
  });

  it("labels an immediate sell in shares", () => {
    expect(maximumExposure({
      action: "create",
      execution: "FAK",
      tokenId: "1",
      marketId: "market",
      marketQuestion: "Question?",
      outcome: "No",
      side: "SELL",
      rationale: "",
      observedAt: "2026-08-03T00:00:00.000Z",
      amount: "7.5",
      limitPrice: "0.3",
      postOnly: false,
    })).toBe("7.5 shares");
  });
});
