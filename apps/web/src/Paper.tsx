import {
  Activity,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  paperQuoteRequestSchema,
  type MarketSearchMarket,
  type PaperFill,
  type PaperFillsResponse,
  type PaperPortfolio,
  type PaperQuote,
  type PaperQuoteRequest,
  type PaperStrategySnapshot,
} from "@polytrade/contracts";

import { GatewayClient, GatewayError } from "./api";
import { PaperStrategyRunner } from "./PaperStrategy";

const FILL_PAGE_SIZE = 20;

export function PaperWorkspace(props: {
  client: GatewayClient;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [fills, setFills] = useState<PaperFillsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fillOffset, setFillOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MarketSearchMarket[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<MarketSearchMarket | null>(null);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [shareQuantity, setShareQuantity] = useState("");
  const [quote, setQuote] = useState<PaperQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [orderKey, setOrderKey] = useState<string | null>(null);
  const [strategySnapshot, setStrategySnapshot] = useState<PaperStrategySnapshot | null>(null);
  const pollBusyRef = useRef(false);

  const loadFills = useCallback(async (offset: number) => {
    try {
      setFills(await props.client.paperFills(FILL_PAGE_SIZE, offset));
    } catch (error) {
      props.onError(message(error));
    }
  }, [props.client, props.onError]);

  const refreshPortfolio = useCallback(async (announce = false) => {
    setRefreshing(true);
    try {
      const next = await props.client.refreshPaperPortfolio();
      setPortfolio(next);
      if (announce) props.onNotice("Paper portfolio refreshed.");
      return next;
    } catch (error) {
      props.onError(message(error));
      return null;
    } finally {
      setRefreshing(false);
    }
  }, [props.client, props.onError, props.onNotice]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      props.client.refreshPaperPortfolio(),
      props.client.paperFills(FILL_PAGE_SIZE, 0),
      props.client.paperStrategy(),
    ]).then(([nextPortfolio, nextFills, nextStrategy]) => {
      if (cancelled) return;
      setPortfolio(nextPortfolio);
      setFills(nextFills);
      setStrategySnapshot(nextStrategy);
    }).catch((error: unknown) => {
      if (!cancelled) props.onError(message(error));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [props.client, props.onError]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const [nextPortfolio, nextStrategy, nextFills] = await Promise.all([
          props.client.paperPortfolio(),
          props.client.paperStrategy(),
          fillOffset === 0 ? props.client.paperFills(FILL_PAGE_SIZE, 0) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPortfolio(nextPortfolio);
        setStrategySnapshot(nextStrategy);
        if (nextFills) setFills(nextFills);
      } catch {
        // The next poll retries transient dashboard reads without interrupting an active strategy.
      } finally {
        pollBusyRef.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [fillOffset, props.client]);

  const selectedOutcome = useMemo(() => {
    if (!selectedMarket) return null;
    const index = selectedMarket.clobTokenIds.indexOf(selectedTokenId);
    return index < 0 ? null : selectedMarket.outcomes[index] ?? null;
  }, [selectedMarket, selectedTokenId]);

  const request = useMemo<PaperQuoteRequest | null>(() => {
    if (!selectedMarket || !selectedTokenId) return null;
    const parsed = paperQuoteRequestSchema.safeParse({
      conditionId: selectedMarket.conditionId,
      tokenId: selectedTokenId,
      side,
      shares: shareQuantity,
    });
    return parsed.success ? parsed.data : null;
  }, [selectedMarket, selectedTokenId, shareQuantity, side]);

  const clearPreview = () => {
    setQuote(null);
    setOrderKey(null);
  };

  const searchMarkets = async (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    clearPreview();
    try {
      const response = await props.client.searchMarkets(term, "active", 20);
      const markets = response.events.flatMap((eventItem) => eventItem.markets)
        .filter((market, index, all) => (
          market.active
          && !market.closed
          && market.acceptingOrders
          && market.enableOrderBook
          && all.findIndex((candidate) => candidate.conditionId === market.conditionId) === index
        ));
      setResults(markets);
    } catch (error) {
      props.onError(message(error));
    } finally {
      setSearching(false);
    }
  };

  const selectMarket = (market: MarketSearchMarket) => {
    setSelectedMarket(market);
    setSelectedTokenId(market.clobTokenIds[0] ?? "");
    setShareQuantity("");
    clearPreview();
  };

  const previewOrder = async () => {
    if (!request) return;
    setQuoting(true);
    try {
      const next = await props.client.paperQuote(request);
      setQuote(next);
      setOrderKey(crypto.randomUUID());
    } catch (error) {
      props.onError(message(error));
    } finally {
      setQuoting(false);
    }
  };

  const confirmOrder = async () => {
    if (!quote || !request || !orderKey) return;
    setOrdering(true);
    try {
      const result = await props.client.paperOrder({ ...request, limitPrice: quote.limitPrice }, orderKey);
      setPortfolio(result.portfolio);
      props.onNotice(`Paper ${result.fill.kind.toLowerCase()} filled: ${shortNumber(result.fill.shares)} ${result.fill.outcome} shares.`);
      clearPreview();
      setFillOffset(0);
      await Promise.all([refreshPortfolio(false), loadFills(0)]);
    } catch (error) {
      if (error instanceof GatewayError && error.code === "PAPER_PRICE_MOVED") clearPreview();
      props.onError(message(error));
    } finally {
      setOrdering(false);
    }
  };

  const changeFillPage = (offset: number) => {
    setFillOffset(offset);
    void loadFills(offset);
  };

  if (loading) {
    return <main className="paper-loading"><RefreshCw className="spin" /><span>Opening paper ledger…</span></main>;
  }

  return (
    <main className="detail-page paper-page">
      <header className="page-title paper-title">
        <div>
          <span className="eyebrow paper-eyebrow">Simulation ledger</span>
          <h1>Paper trading</h1>
          <p>Practice against the live public order book with virtual USDC. Every fill stays inside this sandbox.</p>
        </div>
        <button className="button button-quiet" type="button" onClick={() => void refreshPortfolio(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spin" : ""} /> Refresh portfolio
        </button>
      </header>

      <section className="paper-boundary" aria-label="Paper trading boundary">
        <ShieldCheck aria-hidden="true" />
        <strong>Paper only</strong>
        <span>No wallet, signature, real order, or withdrawable balance.</span>
      </section>

      <PaperLedger portfolio={portfolio} />

      {portfolio?.warnings.length ? (
        <section className="paper-warnings" role="status">
          <CircleAlert aria-hidden="true" />
          <div><strong>Some prices could not be refreshed</strong>{portfolio.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
        </section>
      ) : null}

      <div className="paper-grid">
        <div className="paper-data-column">
          <section className="paper-market-panel">
            <header><div><span className="eyebrow paper-eyebrow">Find a contract</span><h2>Active markets</h2></div><Activity aria-hidden="true" /></header>
            <form className="paper-market-search" onSubmit={(event) => void searchMarkets(event)}>
              <Search aria-hidden="true" />
              <label className="sr-only" htmlFor="paper-market-query">Search active Polymarket markets</label>
              <input id="paper-market-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search elections, rates, crypto…" />
              <button type="submit" disabled={searching || !query.trim()}>{searching ? "Searching…" : "Search"}</button>
            </form>
            <div className="paper-market-results">
              {results.map((market) => (
                <button
                  className={selectedMarket?.conditionId === market.conditionId ? "paper-market-selected" : ""}
                  type="button"
                  key={market.conditionId}
                  onClick={() => selectMarket(market)}
                >
                  <span><strong>{market.question}</strong><small>{market.outcomes.map((outcome, index) => `${outcome} ${formatPrice(market.outcomePrices[index])}`).join(" · ")}</small></span>
                  {selectedMarket?.conditionId === market.conditionId ? <Check /> : <ArrowRight />}
                </button>
              ))}
              {!results.length && query && !searching && <p className="paper-empty">No active CLOB markets found for this search.</p>}
              {!results.length && !query && <p className="paper-empty">Search for a market, then choose an outcome in the paper ticket.</p>}
            </div>
          </section>

          <PaperPositions portfolio={portfolio} />
          <PaperFills fills={fills} offset={fillOffset} onPage={changeFillPage} />
        </div>

        <aside className="paper-ticket-column">
          <section className="paper-ticket">
            <header>
              <div><span className="eyebrow paper-eyebrow">Fill-or-kill simulation</span><h2>Paper ticket</h2></div>
              <span className="paper-mode-chip">Virtual</span>
            </header>
            {selectedMarket ? (
              <>
                <div className="paper-selected-market"><strong>{selectedMarket.question}</strong><code>{compact(selectedMarket.conditionId)}</code></div>
                <div className="paper-side-toggle" aria-label="Paper order side">
                  {(["BUY", "SELL"] as const).map((value) => <button className={side === value ? `paper-side-${value.toLowerCase()}` : ""} type="button" key={value} aria-pressed={side === value} onClick={() => { setSide(value); clearPreview(); }}>{value}</button>)}
                </div>
                <div className="paper-ticket-fields">
                  <label><span>Outcome</span><select value={selectedTokenId} onChange={(event) => { setSelectedTokenId(event.target.value); clearPreview(); }}>{selectedMarket.clobTokenIds.map((tokenId, index) => <option key={tokenId} value={tokenId}>{selectedMarket.outcomes[index] ?? tokenId}</option>)}</select></label>
                  <label><span>Shares</span><input inputMode="decimal" value={shareQuantity} onChange={(event) => { setShareQuantity(event.target.value); clearPreview(); }} placeholder="0.000000" /></label>
                </div>
                <p className="paper-ticket-hint">{side === "BUY" ? "Buys sweep the lowest asks first." : `You own ${ownedShares(portfolio, selectedTokenId)} ${selectedOutcome ?? "outcome"} shares.`}</p>
                {quote ? <ExecutionTape quote={quote} /> : (
                  <button className="button button-primary button-wide paper-preview-button" type="button" disabled={!request || quoting} onClick={() => void previewOrder()}>{quoting ? "Reading order book…" : "Preview paper trade"} <ArrowRight /></button>
                )}
                {quote && (
                  <div className="paper-confirm-actions">
                    <button className="button button-quiet" type="button" disabled={ordering} onClick={clearPreview}>Edit</button>
                    <button className="button button-primary" type="button" disabled={ordering} onClick={() => void confirmOrder()}>{ordering ? "Filling…" : `Confirm paper ${quote.side.toLowerCase()}`}</button>
                  </div>
                )}
              </>
            ) : (
              <div className="paper-ticket-empty"><Search /><strong>Select a market</strong><p>Search active markets to prepare a simulated fill.</p></div>
            )}
            <footer>Price protection uses the preview’s worst consumed level. If the book moves beyond it, the complete order is rejected.</footer>
          </section>
          <PaperStrategyRunner
            client={props.client}
            market={selectedMarket}
            tokenId={selectedTokenId}
            portfolio={portfolio}
            snapshot={strategySnapshot}
            onSnapshot={setStrategySnapshot}
            onError={props.onError}
            onNotice={props.onNotice}
          />
        </aside>
      </div>
    </main>
  );
}

function PaperLedger({ portfolio }: { portfolio: PaperPortfolio | null }) {
  const pnl = portfolio?.totalPnl ?? "0";
  return (
    <section className="paper-ledger" aria-label="Paper account summary">
      <div className="paper-equity">
        <span>Paper equity</span>
        <strong>{formatMoney(portfolio?.equity)}</strong>
        <small>Started with 10,000.00 virtual USDC</small>
      </div>
      <dl>
        <div><dt>Cash</dt><dd>{formatMoney(portfolio?.cash)}</dd></div>
        <div><dt>Liquidation value</dt><dd>{formatMoney(portfolio?.positionsValue)}</dd></div>
        <div><dt>Realized P&amp;L</dt><dd className={tone(portfolio?.realizedPnl)}>{formatSignedMoney(portfolio?.realizedPnl)}</dd></div>
        <div><dt>Fees paid</dt><dd>{formatMoney(portfolio?.totalFees)}</dd></div>
      </dl>
      <div className={`paper-pnl-stamp ${tone(pnl)}`}><span>Net P&amp;L</span><strong>{formatSignedMoney(pnl)}</strong><small>{portfolio?.positions.length ?? 0} open positions</small></div>
    </section>
  );
}

function ExecutionTape({ quote }: { quote: PaperQuote }) {
  const cash = quote.side === "BUY" ? formatMoney(Math.abs(Number(quote.cashEffect))) : formatMoney(quote.cashEffect);
  return (
    <section className="execution-tape" aria-label="Paper trade preview">
      <div><span>Shares</span><strong>{shortNumber(quote.shares)}</strong></div><ArrowRight />
      <div><span>VWAP</span><strong>{formatPrice(quote.averagePrice)}</strong></div><ArrowRight />
      <div><span>Fee</span><strong>{formatMoney(quote.fee)}</strong></div><ArrowRight />
      <div className="execution-tape-total"><span>{quote.side === "BUY" ? "Debit" : "Proceeds"}</span><strong>{cash}</strong></div>
      <footer>Protected at {formatPrice(quote.limitPrice)} · observed {formatTime(quote.observedAt)}</footer>
    </section>
  );
}

function PaperPositions({ portfolio }: { portfolio: PaperPortfolio | null }) {
  return (
    <section className="data-section paper-table-section">
      <header><h2>Holdings</h2><span className="count-pill">{portfolio?.positions.length ?? 0}</span></header>
      <div className="table-scroll"><table><thead><tr><th>Market / outcome</th><th>Shares</th><th>Average cost</th><th>Best bid</th><th>Liquidation</th><th>Unrealized P&amp;L</th><th>Mark</th></tr></thead><tbody>
        {portfolio?.positions.map((position) => <tr key={position.tokenId}><th>{position.marketQuestion}<small>{position.outcome}</small></th><td>{shortNumber(position.shares)}</td><td>{formatPrice(position.averageCost)}</td><td>{formatPrice(position.bestBid)}</td><td>{formatMoney(position.liquidationValue)}</td><td className={tone(position.unrealizedPnl)}>{formatSignedMoney(position.unrealizedPnl)}</td><td><span className={`paper-mark paper-mark-${position.markStatus}`}>{position.markStatus}</span><small>{position.markedAt ? formatTime(position.markedAt) : "Not priced"}</small></td></tr>)}
      </tbody></table></div>
      {!portfolio?.positions.length && <p className="table-empty">No paper holdings yet. Preview a buy to start the ledger.</p>}
    </section>
  );
}

function PaperFills(props: { fills: PaperFillsResponse | null; offset: number; onPage: (offset: number) => void }) {
  const hasPrevious = props.offset > 0;
  const hasNext = Boolean(props.fills && props.offset + props.fills.items.length < props.fills.total);
  return (
    <section className="data-section paper-table-section">
      <header><h2>Paper fills</h2><div className="paper-pagination"><span className="count-pill">{props.fills?.total ?? 0}</span><button type="button" aria-label="Previous paper fills" disabled={!hasPrevious} onClick={() => props.onPage(Math.max(0, props.offset - FILL_PAGE_SIZE))}><ChevronLeft /></button><button type="button" aria-label="Next paper fills" disabled={!hasNext} onClick={() => props.onPage(props.offset + FILL_PAGE_SIZE)}><ChevronRight /></button></div></header>
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Market / outcome</th><th>Type</th><th>Shares</th><th>VWAP</th><th>Fee</th><th>Cash effect</th><th>Realized P&amp;L</th></tr></thead><tbody>
        {props.fills?.items.map((fill) => <PaperFillRow key={fill.fillId} fill={fill} />)}
      </tbody></table></div>
      {!props.fills?.items.length && <p className="table-empty">No simulated fills or settlements recorded.</p>}
    </section>
  );
}

function PaperFillRow({ fill }: { fill: PaperFill }) {
  return <tr><td>{formatDate(fill.createdAt)}</td><th>{fill.marketQuestion}<small>{fill.outcome}</small></th><td><span className={`paper-fill-kind paper-fill-${fill.kind.toLowerCase()}`}>{fill.kind}</span></td><td>{shortNumber(fill.shares)}</td><td>{formatPrice(fill.averagePrice)}</td><td>{formatMoney(fill.fee)}</td><td className={tone(fill.cashEffect)}>{formatSignedMoney(fill.cashEffect)}</td><td className={tone(fill.realizedPnl)}>{fill.kind === "BUY" ? "—" : formatSignedMoney(fill.realizedPnl)}</td></tr>;
}

function ownedShares(portfolio: PaperPortfolio | null, tokenId: string): string {
  return shortNumber(portfolio?.positions.find((position) => position.tokenId === tokenId)?.shares ?? "0");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "The paper action could not be completed";
}

function compact(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}

function tone(value: string | null | undefined): string {
  const number = Number(value ?? 0);
  return number > 0 ? "value-positive" : number < 0 ? "value-negative" : "";
}

function formatMoney(value: string | number | null | undefined): string {
  const number = Number(value ?? 0);
  return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} USDC`;
}

function formatSignedMoney(value: string | null | undefined): string {
  const number = Number(value ?? 0);
  const sign = number > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)} USDC`;
}

function formatPrice(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : "—";
}

function shortNumber(value: string): string {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(number) : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
