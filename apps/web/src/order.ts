import type { CreateOrderProposal } from "@polytrade/contracts";

export function maximumExposure(proposal: CreateOrderProposal): string {
  if ("price" in proposal) {
    if (proposal.side === "SELL") return `${proposal.size} shares`;
    const value = Number(proposal.price) * Number(proposal.size);
    return Number.isFinite(value) ? `${formatDecimal(value)} USDC` : "Invalid";
  }
  return `${proposal.amount} ${proposal.side === "BUY" ? "USDC" : "shares"}`;
}

function formatDecimal(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
