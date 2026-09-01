import type {
  AlertChannelKind,
  AlertEventKind,
  PaperStrategyAction,
  TypedData,
  CancellationSelector,
  CreateOrderProposal,
  MarketSearchMarket,
} from "@polytrade/contracts";
import type { OrderResponse } from "@polymarket/clob-client-v2";
import { hashTypedData, verifyTypedData, type Address, type Hex } from "viem";
import { randomUUID } from "node:crypto";

import type {
  AlertChannelRecord,
  AlertDeliveryRecord,
  AlertStore,
} from "../src/alert-store.js";
import type { PolymarketPort } from "../src/polymarket.js";
import type { IdempotencyClaim, TradingStore } from "../src/store.js";
import { IDEMPOTENCY_STALE_SECONDS } from "../src/store.js";
import type {
  AccountSnapshot,
  ApiKeyCreds,
  BuiltOrderIntent,
  ChallengeRecord,
  OrderIntentRecord,
  WalletSessionRecord,
} from "../src/types.js";

function isFailedResponse(response: unknown): boolean {
  return Boolean(response && typeof response === "object" && (response as { ok?: unknown }).ok === false);
}

export class MemoryTradingStore implements TradingStore {
  readonly challenges = new Map<string, ChallengeRecord>();
  readonly sessions = new Map<string, WalletSessionRecord>();
  readonly intents = new Map<string, OrderIntentRecord>();
  readonly audits: Array<{ principalId: string; action: string; entityId?: string; detail?: unknown }> = [];
  readonly idempotency = new Map<string, { hash: string; response?: unknown; createdAt: Date }>();
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

  async releaseChallenge(id: string, principalId: string, usedAt: Date) {
    const value = this.challenges.get(id);
    if (!value || value.principalId !== principalId || value.usedAt !== usedAt) return false;
    value.usedAt = undefined;
    return true;
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
      this.idempotency.set(mapKey, { hash: requestHash, createdAt: new Date() });
      return { state: "claimed" };
    }
    const stale = Date.now() - value.createdAt.getTime() >= IDEMPOTENCY_STALE_SECONDS * 1_000;
    if (stale && (value.response === undefined || isFailedResponse(value.response))) {
      this.idempotency.set(mapKey, { hash: requestHash, createdAt: new Date() });
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

  async releaseIdempotency(principalId: string, operation: string, key: string) {
    const mapKey = `${principalId}:${operation}:${key}`;
    const value = this.idempotency.get(mapKey);
    if (!value || value.response !== undefined) return false;
    this.idempotency.delete(mapKey);
    return true;
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
  l1CredentialsError: Error | null = null;
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
    if (this.l1CredentialsError) throw this.l1CredentialsError;
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

export interface MemoryAlertEvent {
  eventSeq: number;
  eventId: string;
  strategyId: string;
  action: PaperStrategyAction;
  message: string;
  side: "BUY" | "SELL" | null;
  price: string | null;
  principalId: string;
  marketQuestion: string;
  outcome: string;
}

interface StoredAlertDelivery extends AlertDeliveryRecord {
  ownerPrincipalId: string;
  target: string;
  nextAttemptAtMs: number;
  leaseOwner: string | null;
  leaseUntilMs: number | null;
  exhaustedAtMs?: number;
}

export class MemoryAlertStore implements AlertStore {
  readonly channels = new Map<string, AlertChannelRecord>();
  readonly deliveries = new Map<string, StoredAlertDelivery>();
  /** Tests push paper-strategy events here; fanOutNewEvents drains them by seq. */
  readonly events: MemoryAlertEvent[] = [];
  private cursor = 0;

  async listChannels(principalId: string): Promise<AlertChannelRecord[]> {
    return [...this.channels.values()]
      .filter((channel) => channel.principalId === principalId)
      .map((channel) => ({ ...channel, eventKinds: [...channel.eventKinds] }));
  }

  async getChannel(principalId: string, channelId: string): Promise<AlertChannelRecord | undefined> {
    const channel = this.channels.get(channelId);
    return channel?.principalId === principalId ? { ...channel, eventKinds: [...channel.eventKinds] } : undefined;
  }

  async countChannels(principalId: string): Promise<number> {
    return (await this.listChannels(principalId)).length;
  }

  async createChannel(channel: AlertChannelRecord): Promise<void> {
    this.channels.set(channel.channelId, { ...channel, eventKinds: [...channel.eventKinds] });
  }

  async deleteChannel(principalId: string, channelId: string): Promise<boolean> {
    const channel = await this.getChannel(principalId, channelId);
    if (!channel) return false;
    this.channels.delete(channelId);
    for (const [deliveryId, delivery] of this.deliveries) {
      if (delivery.channelId === channelId) this.deliveries.delete(deliveryId);
    }
    return true;
  }

  async fanOutNewEvents(now: Date, limit: number): Promise<number> {
    const pending = this.events
      .filter((event) => event.eventSeq > this.cursor && event.action !== "WAIT")
      .sort((left, right) => left.eventSeq - right.eventSeq)
      .slice(0, limit);
    for (const event of pending) {
      for (const channel of this.channels.values()) {
        if (channel.principalId !== event.principalId || !channel.enabled) continue;
        if (!channel.eventKinds.includes(event.action as AlertEventKind)) continue;
        const deliveryId = randomUUID();
        this.deliveries.set(deliveryId, {
          deliveryId,
          channelId: channel.channelId,
          ownerPrincipalId: channel.principalId,
          channelLabel: channel.label,
          channelKind: channel.kind,
          target: channel.encryptedTarget,
          eventSeq: event.eventSeq,
          action: event.action,
          message: event.message,
          context: {
            marketQuestion: event.marketQuestion,
            outcome: event.outcome,
            side: event.side,
            price: event.price,
          },
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
          lastError: null,
          createdAt: now.toISOString(),
          deliveredAt: null,
          nextAttemptAtMs: now.getTime(),
          leaseOwner: null,
          leaseUntilMs: null,
        });
      }
      this.cursor = event.eventSeq;
    }
    return pending.length;
  }

  async claimDeliveries(owner: string, now: Date, leaseUntil: Date, limit: number): Promise<AlertDeliveryRecord[]> {
    const due = [...this.deliveries.values()]
      .filter((delivery) => delivery.status === "pending"
        && delivery.nextAttemptAtMs <= now.getTime()
        && (delivery.leaseUntilMs === null || delivery.leaseUntilMs <= now.getTime()))
      .sort((left, right) => left.nextAttemptAtMs - right.nextAttemptAtMs)
      .slice(0, limit);
    for (const delivery of due) {
      delivery.attempts += 1;
      delivery.leaseOwner = owner;
      delivery.leaseUntilMs = leaseUntil.getTime();
    }
    return due.map((delivery) => claimedRecord(delivery, delivery.ownerPrincipalId, delivery.target));
  }

  async markDelivered(deliveryId: string, owner: string, deliveredAt: Date): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || delivery.leaseOwner !== owner || delivery.status !== "pending") return false;
    delivery.status = "delivered";
    delivery.deliveredAt = deliveredAt.toISOString();
    delivery.leaseOwner = null;
    delivery.leaseUntilMs = null;
    return true;
  }

  async markRetry(deliveryId: string, owner: string, error: string, nextAttemptAt: Date, _now: Date): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || delivery.leaseOwner !== owner || delivery.status !== "pending") return false;
    delivery.lastError = error;
    delivery.nextAttemptAtMs = nextAttemptAt.getTime();
    delivery.leaseOwner = null;
    delivery.leaseUntilMs = null;
    return true;
  }

  async markExhausted(deliveryId: string, owner: string, error: string, now: Date): Promise<boolean> {
    const delivery = this.deliveries.get(deliveryId);
    if (!delivery || delivery.leaseOwner !== owner || delivery.status !== "pending") return false;
    delivery.status = "failed";
    delivery.lastError = error;
    delivery.leaseOwner = null;
    delivery.leaseUntilMs = null;
    delivery.exhaustedAtMs = now.getTime();
    return true;
  }

  async listDeliveries(principalId: string, limit: number): Promise<AlertDeliveryRecord[]> {
    return [...this.deliveries.values()]
      .filter((delivery) => this.channels.get(delivery.channelId)?.principalId === principalId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((delivery) => claimedRecord(delivery, delivery.ownerPrincipalId, null));
  }

  async pruneDeliveries(now: Date, olderThanDays: number): Promise<void> {
    const cutoff = now.getTime() - olderThanDays * 86_400_000;
    for (const [deliveryId, delivery] of this.deliveries) {
      if (delivery.status !== "pending" && Date.parse(delivery.createdAt) < cutoff) this.deliveries.delete(deliveryId);
    }
  }
}

function claimedRecord(delivery: StoredAlertDelivery, principalId: string, encryptedTarget: string | null): AlertDeliveryRecord {
  return {
    deliveryId: delivery.deliveryId,
    channelId: delivery.channelId,
    principalId,
    channelLabel: delivery.channelLabel,
    channelKind: delivery.channelKind,
    ...(encryptedTarget === null ? {} : { encryptedTarget }),
    eventSeq: delivery.eventSeq,
    action: delivery.action,
    message: delivery.message,
    context: { ...delivery.context },
    status: delivery.status,
    attempts: delivery.attempts,
    maxAttempts: delivery.maxAttempts,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
  };
}
