import type {
  CancellationSelector,
  CreateOrderProposal,
  MarketSearchMarket,
  TypedData,
} from "@polytrade/contracts";
import type { OrderResponse } from "@polymarket/clob-client-v2";
import { hashTypedData, verifyTypedData, type Address, type Hex } from "viem";

import type { PolymarketPort } from "../src/polymarket.js";
import type { IdempotencyClaim, TradingStore } from "../src/store.js";
import type {
  AccountSnapshot,
  ApiKeyCreds,
  BuiltOrderIntent,
  ChallengeRecord,
  OrderIntentRecord,
  WalletSessionRecord,
} from "../src/types.js";

export class MemoryTradingStore implements TradingStore {
  readonly challenges = new Map<string, ChallengeRecord>();
  readonly sessions = new Map<string, WalletSessionRecord>();
  readonly intents = new Map<string, OrderIntentRecord>();
  readonly audits: Array<{ principalId: string; action: string; entityId?: string; detail?: unknown }> = [];
  readonly idempotency = new Map<string, { hash: string; response?: unknown }>();
  readonly accountMirrors: Array<{ principalId: string; account: AccountSnapshot }> = [];

  async health() {}
  async close() {}

  async createChallenge(challenge: ChallengeRecord) {
    this.challenges.set(challenge.id, challenge);
  }

  async consumeChallenge(id: string, principalId: string, now: Date) {
    const value = this.challenges.get(id);
    if (!value || value.principalId !== principalId || value.usedAt || value.expiresAt <= now) return undefined;
    value.usedAt = now;
    return value;
  }

  async createSession(session: WalletSessionRecord) {
    this.sessions.set(session.id, session);
  }

  async getSession(id: string, principalId: string, now: Date, idleSeconds: number) {
    const value = this.sessions.get(id);
    if (!isActive(value, principalId, now)) return undefined;
    value.lastUsedAt = now;
    value.idleExpiresAt = new Date(Math.min(value.absoluteExpiresAt.getTime(), now.getTime() + idleSeconds * 1_000));
    return value;
  }

  async getLatestSession(principalId: string, now: Date, idleSeconds: number) {
    const candidates = [...this.sessions.values()].filter((value) => isActive(value, principalId, now));
    const value = candidates.at(-1);
    if (!value) return undefined;
    value.lastUsedAt = now;
    value.idleExpiresAt = new Date(Math.min(value.absoluteExpiresAt.getTime(), now.getTime() + idleSeconds * 1_000));
    return value;
  }

  async peekLatestSession(principalId: string, now: Date) {
    const candidates = [...this.sessions.values()].filter((value) => isActive(value, principalId, now));
    return candidates.at(-1);
  }

  async revokeSession(id: string, principalId: string) {
    const value = this.sessions.get(id);
    if (!value || value.principalId !== principalId || value.revokedAt) return false;
    value.revokedAt = new Date();
    return true;
  }

  async createIntent(intent: OrderIntentRecord) {
    const existing = [...this.intents.values()].find(
      (value) => value.principalId === intent.principalId && value.idempotencyKey === intent.idempotencyKey,
    );
    if (existing) return existing;
    this.intents.set(intent.id, intent);
    return intent;
  }

  async getIntent(id: string, principalId: string) {
    const value = this.intents.get(id);
    return value?.principalId === principalId ? value : undefined;
  }

  async claimIntentSubmission(id: string, principalId: string, signedOrderHash: string) {
    const value = await this.getIntent(id, principalId);
    if (!value || value.status !== "PENDING") return false;
    value.status = "SUBMITTING";
    value.signedOrderHash = signedOrderHash;
    return true;
  }

  async setIntentStatus(
    id: string,
    principalId: string,
    status: OrderIntentRecord["status"],
    values: { signedOrderHash?: string; upstreamResponse?: unknown; submittedAt?: Date } = {},
  ) {
    const value = await this.getIntent(id, principalId);
    if (!value) return;
    value.status = status;
    Object.assign(value, values);
  }

  async beginIdempotency(principalId: string, operation: string, key: string, requestHash: string): Promise<IdempotencyClaim> {
    const mapKey = `${principalId}:${operation}:${key}`;
    const value = this.idempotency.get(mapKey);
    if (!value) {
      this.idempotency.set(mapKey, { hash: requestHash });
      return { state: "claimed" };
    }
    if (value.hash !== requestHash) return { state: "mismatch" };
    if (value.response === undefined) return { state: "pending" };
    return { state: "complete", response: value.response };
  }

  async finishIdempotency(principalId: string, operation: string, key: string, response: unknown) {
    const value = this.idempotency.get(`${principalId}:${operation}:${key}`);
    if (value && value.response === undefined) value.response = response;
  }

  async mirrorAccount(principalId: string, account: AccountSnapshot) {
    this.accountMirrors.push({ principalId, account });
  }

  async appendAudit(principalId: string, action: string, entityId?: string, detail?: unknown) {
    this.audits.push({ principalId, action, ...(entityId ? { entityId } : {}), ...(detail ? { detail } : {}) });
  }
}

function isActive(value: WalletSessionRecord | undefined, principalId: string, now: Date): value is WalletSessionRecord {
  return Boolean(
    value &&
    value.principalId === principalId &&
    !value.revokedAt &&
    value.idleExpiresAt > now &&
    value.absoluteExpiresAt > now,
  );
}

export class FakePolymarket implements PolymarketPort {
  readonly preflighted: CreateOrderProposal[] = [];
  readonly submitted: Array<{ orderType: string; postOnly: boolean }> = [];
  readonly cancellations: CancellationSelector[] = [];
  submitError: Error | null = null;
  submitResponse: OrderResponse | null = null;
  reconciled: unknown | undefined;
  accountSnapshot: AccountSnapshot | null = null;
  paperMarket: MarketSearchMarket = {
    id: "market-1",
    conditionId: "0xcondition",
    slug: "paper-market",
    question: "Will this paper trade pass?",
    description: "",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.4", "0.6"],
    clobTokenIds: ["123", "456"],
    active: true,
    closed: false,
    acceptingOrders: true,
    enableOrderBook: true,
    archived: false,
    restricted: false,
    minimumOrderSize: "1",
    minimumTickSize: "0.01",
    endDate: null,
    startDate: null,
    createdAt: null,
    closedTime: null,
    liquidity: "1000",
    volume: "5000",
  };
  paperOrderBooks = new Map<string, unknown>();
  paperFeeRates = new Map<string, string>();

  async searchMarkets() { return { events: [] }; }
  async getMarket() { return { market: {} }; }
  async getMarketByCondition() {
    return { market: this.paperMarket, observedAt: "2026-08-03T00:00:00.000Z" };
  }
  async getOrderBook(tokenId: string) {
    return this.paperOrderBooks.get(tokenId) ?? {
      bids: [],
      asks: [],
      observedAt: "2026-08-03T00:00:00.000Z",
    };
  }
  async getFeeRate(tokenId: string) { return this.paperFeeRates.get(tokenId) ?? "0.000000"; }
  async getPriceHistory() { return { points: [] }; }
  async getRecentTrades() { return { trades: [] }; }
  async exchangeL1Credentials(): Promise<ApiKeyCreds> {
    return { key: "key", secret: "secret", passphrase: "passphrase" };
  }
  async buildOrderIntent(session: WalletSessionRecord, proposal: CreateOrderProposal): Promise<BuiltOrderIntent> {
    const typedData = orderTypedData(session.walletAddress, proposal.tokenId, proposal.side);
    return {
      typedData,
      unsignedOrder: { maker: session.walletAddress, tokenId: proposal.tokenId, side: proposal.side },
    };
  }
  async preflight(_session: WalletSessionRecord, _credentials: ApiKeyCreds, proposal: CreateOrderProposal) {
    this.preflighted.push(proposal);
  }
  async reconcileOrder() { return this.reconciled; }
  async verifyOrderSignature(intent: BuiltOrderIntent, walletAddress: Address, signature: Hex) {
    const valid = await verifyTypedData({
      address: walletAddress,
      domain: intent.typedData.domain,
      types: intent.typedData.types,
      primaryType: intent.typedData.primaryType,
      message: intent.typedData.message,
      signature,
    } as never);
    if (!valid) throw new Error("invalid signature");
    return hashTypedData({
      domain: intent.typedData.domain,
      types: intent.typedData.types,
      primaryType: intent.typedData.primaryType,
      message: intent.typedData.message,
    } as never);
  }
  async submitOrder(
    _session: WalletSessionRecord,
    _credentials: ApiKeyCreds,
    _intent: BuiltOrderIntent,
    _signature: Hex,
    orderType: "GTC" | "GTD" | "FOK" | "FAK",
    postOnly: boolean,
  ): Promise<OrderResponse> {
    this.submitted.push({ orderType, postOnly });
    if (this.submitError) throw this.submitError;
    if (this.submitResponse) return this.submitResponse;
    return { success: true, orderID: `order-${orderType}`, status: "live" } as OrderResponse;
  }
  async getAccount(session: WalletSessionRecord): Promise<AccountSnapshot> {
    return this.accountSnapshot ?? {
      walletAddress: session.walletAddress,
      positions: [],
      openOrders: [],
      trades: [],
      observedAt: new Date().toISOString(),
    };
  }
  async cancel(_session: WalletSessionRecord, _credentials: ApiKeyCreds, selector: CancellationSelector) {
    this.cancellations.push(selector);
    return { canceled: true, selector };
  }
}

export function orderTypedData(maker: Address, tokenId: string, side: "BUY" | "SELL"): TypedData {
  return {
    domain: {
      name: "PolyTrade test order",
      version: "1",
      chainId: 137,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    },
    types: {
      Order: [
        { name: "maker", type: "address" },
        { name: "tokenId", type: "uint256" },
        { name: "side", type: "string" },
      ],
    },
    primaryType: "Order",
    message: { maker, tokenId, side },
  };
}
