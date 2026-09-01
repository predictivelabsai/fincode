import type {
  AlertChannelKind,
  AlertEventKind,
  PaperFill,
  PaperMarkStatus,
  PaperStrategyAction,
  PaperShareStatus,
  TypedData,
  CancellationSelector,
  CreateOrderProposal,
  MarketSearchMarket,
  PublicMarket,
  PublicMarketSummary,
} from "@polytrade/contracts";
import type { OrderResponse } from "@polymarket/clob-client-v2";
import { hashTypedData, verifyTypedData, type Address, type Hex } from "viem";
import { randomBytes, randomUUID } from "node:crypto";

import type {
  AlertChannelRecord,
  AlertDeliveryRecord,
  AlertStore,
} from "../src/alert-store.js";
import { notFound } from "../src/errors.js";
import type { PolymarketPort } from "../src/polymarket.js";
import type {
  TrackRecordSnapshot,
  TrackRecordStore,
  TrackRecordTotals,
} from "../src/track-record-store.js";
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
  publicActiveMarkets: PublicMarketSummary[] = [];
  publicMarketDetail: PublicMarket | null = null;
  requestCounts = { list: 0, detail: 0, orderBook: 0, priceHistory: 0 };

  async searchMarkets() { return { events: [] }; }
  async listActiveMarkets(input: { limit: number; offset: number; order: string }) {
    this.requestCounts.list += 1;
    const start = input.offset;
    const markets = this.publicActiveMarkets.slice(start, start + input.limit);
    return {
      markets,
      hasMore: start + input.limit < this.publicActiveMarkets.length,
      observedAt: "2026-08-03T00:00:00.000Z",
    };
  }
  async getMarket() { return { market: {} }; }
  async getPublicMarket(slug: string) {
    this.requestCounts.detail += 1;
    if (!this.publicMarketDetail || this.publicMarketDetail.slug !== slug) {
      throw notFound("Public market not found");
    }
    return { market: this.publicMarketDetail, observedAt: "2026-08-03T00:00:00.000Z" };
  }
  async getMarketByCondition() {
    return { market: this.paperMarket, observedAt: "2026-08-03T00:00:00.000Z" };
  }
  async getOrderBook(tokenId: string) {
    this.requestCounts.orderBook += 1;
    return this.paperOrderBooks.get(tokenId) ?? {
      bids: [],
      asks: [],
      observedAt: "2026-08-03T00:00:00.000Z",
    };
  }
  async getFeeRate(tokenId: string) { return this.paperFeeRates.get(tokenId) ?? "0.000000"; }
  async getPriceHistory() {
    this.requestCounts.priceHistory += 1;
    return { points: [] };
  }
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

export function publicMarketSummaryFixture(overrides: Partial<PublicMarketSummary> = {}): PublicMarketSummary {
  return {
    id: "market-1",
    conditionId: "0xcondition",
    slug: "fed-rates-september",
    question: "Will the Fed hold rates in September?",
    outcomes: ["Yes", "No"],
    outcomePrices: ["0.435", "0.565"],
    clobTokenIds: ["123", "456"],
    active: true,
    closed: false,
    acceptingOrders: true,
    endDate: "2026-09-16T00:00:00.000Z",
    liquidity: "751367.0807",
    volume: "17442271.5916",
    ...overrides,
  };
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

export function paperFillFixture(overrides: Partial<PaperFill> = {}): PaperFill {
  return {
    fillId: randomUUID(),
    kind: "BUY",
    conditionId: "0xcondition",
    tokenId: "123",
    marketQuestion: "Will the Fed hold rates in September?",
    outcome: "Yes",
    shares: "10.000000",
    averagePrice: "0.500000",
    grossNotional: "5.000000",
    feeRate: "0.000000",
    fee: "0.00000",
    cashEffect: "-5.000000",
    realizedPnl: "0.000000",
    observedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function trackRecordSnapshotFixture(overrides: {
  account?: { initialCash?: string; cash?: string };
  positions?: Array<{
    marketQuestion: string;
    outcome: string;
    shares: string;
    averageCost: string;
    liquidationValue: string;
    unrealizedPnl: string;
    markStatus: PaperMarkStatus;
  }>;
  totals?: Partial<TrackRecordTotals>;
  recentFills?: PaperFill[];
  curve?: TrackRecordSnapshot["curve"];
} = {}): TrackRecordSnapshot {
  return {
    profile: { startedAt: "2026-08-01T00:00:00.000Z" },
    account: {
      initialCash: "10000.000000",
      cash: "9500.000000",
      ...overrides.account,
    },
    positions: overrides.positions ?? [
      {
        marketQuestion: "Will the Fed hold rates in September?",
        outcome: "Yes",
        shares: "10.000000",
        averageCost: "0.500000",
        liquidationValue: "5.200000",
        unrealizedPnl: "0.200000",
        markStatus: "current",
      },
    ],
    totals: {
      realizedPnl: "10.000000",
      totalFees: "1.000000",
      tradeCount: 2,
      wins: 1,
      closed: 1,
      ...overrides.totals,
    },
    recentFills: overrides.recentFills ?? [
      paperFillFixture({ kind: "SELL", cashEffect: "3.000000", realizedPnl: "10.000000" }),
      paperFillFixture({ kind: "BUY", cashEffect: "-5.000000" }),
    ],
    curve: overrides.curve ?? {
      totalCashEffect: "-2.000000",
      fills: [
        { createdAt: "2026-09-01T00:00:00.000Z", cashEffect: "-5.000000" },
        { createdAt: "2026-09-01T12:00:00.000Z", cashEffect: "3.000000" },
      ],
    },
  };
}

interface ShareLinkRow {
  principalId: string;
  shareToken: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class MemoryTrackRecordStore implements TrackRecordStore {
  readonly links = new Map<string, ShareLinkRow>();
  snapshots: Record<string, TrackRecordSnapshot> = {};
  resolveCount = 0;
  snapshotCount = 0;

  async status(principalId: string): Promise<PaperShareStatus> {
    const row = this.links.get(principalId);
    if (!row) return { token: null, enabled: false, createdAt: null, updatedAt: null };
    return {
      token: row.shareToken,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async enable(principalId: string): Promise<PaperShareStatus> {
    const existing = this.links.get(principalId);
    const now = "2026-09-02T00:00:00.000Z";
    this.links.set(principalId, existing
      ? { ...existing, enabled: true, updatedAt: now }
      : {
          principalId,
          shareToken: randomBytes(24).toString("base64url"),
          enabled: true,
          createdAt: now,
          updatedAt: now,
        });
    return this.status(principalId);
  }

  async rotate(principalId: string): Promise<PaperShareStatus> {
    const now = "2026-09-02T00:00:00.000Z";
    const row = this.links.get(principalId);
    this.links.set(principalId, {
      principalId,
      shareToken: randomBytes(24).toString("base64url"),
      enabled: true,
      createdAt: row?.createdAt ?? now,
      updatedAt: now,
    });
    return this.status(principalId);
  }

  async disable(principalId: string): Promise<PaperShareStatus> {
    const row = this.links.get(principalId);
    if (row) this.links.set(principalId, { ...row, enabled: false, updatedAt: "2026-09-02T00:00:00.000Z" });
    return this.status(principalId);
  }

  async resolvePrincipal(token: string): Promise<string | null> {
    this.resolveCount += 1;
    for (const [principalId, row] of this.links) {
      if (row.shareToken === token && row.enabled) return principalId;
    }
    return null;
  }

  async snapshot(principalId: string): Promise<TrackRecordSnapshot> {
    this.snapshotCount += 1;
    const snapshot = this.snapshots[principalId];
    if (!snapshot) throw notFound("Track record not found");
    return snapshot;
  }
}
