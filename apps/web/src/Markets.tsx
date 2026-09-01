import {
  ArrowLeft,
  CircleAlert,
  CircleDot,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";

import type {
  PublicMarketDetail,
  PublicMarketListResponse,
  PublicMarketSummary,
  PublicOrderBook,
  PublicOrderBookLevel,
  PublicPriceHistory,
} from "@polytrade/contracts";

import { GatewayClient, GatewayError, type MarketHistoryInterval } from "./api";
import { useAuthentication } from "./auth";
import { env } from "./env";

const PAGE_SIZE = 12;
const REFRESH_MS = 10_000;
const MARKET_ORDERS = [
  { label: "24h volume", value: "volume24hr" },
  { label: "Liquidity", value: "liquidity" },
  { label: "Ending soon", value: "endDate" },
] as const;
const TAPE_INTERVALS: MarketHistoryInterval[] = ["1h", "6h", "1d", "1w", "max"];
type MarketOrder = (typeof MARKET_ORDERS)[number]["value"];

export default function PublicApp() {
  const authentication = useAuthentication();
  const navigate = useNavigate();
  const client = useMemo(
    () => new GatewayClient(env.VITE_API_URL, authentication.getToken),
    [authentication.getToken],
  );

  return (
    <div className="market-shell">
      <header className="market-header">
        <Link className="market-brand" to="/markets">
          <span className="brand-glyph" aria-hidden="true"><CircleDot /></span>
          <span>PolyTrade</span>
        </Link>
        <nav className="market-nav" aria-label="Public navigation">
          <NavLink to="/markets" className={({ isActive }) => (isActive ? "nav-active" : "")}>
            <TrendingUp aria-hidden="true" /> Markets
          </NavLink>
        </nav>
        <div className="market-authentication">{authentication.accountControl}</div>
      </header>

      <Routes>
        <Route
          path="/markets"
          element={
            <MarketsWorkspace
              client={client}
              onSelectMarket={(slug) => navigate(`/markets/${slug}`)}
            />
          }
        />
        <Route
          path="/markets/:slug"
          element={
            <MarketDetailRoute
              client={client}
              onAskAgent={(slug) => navigate(`/chat/new?market=${encodeURIComponent(slug)}`)}
            />
          }
        />
        <Route path="*" element={<Navigate replace to="/markets" />} />
      </Routes>

      <footer className="market-footer">
        <span>
          Live data from Polymarket. Read-only research — sign in to open the decision desk.
        </span>
      </footer>
    </div>
  );
}

function MarketDetailRoute({
  client,
  onAskAgent,
}: {
  client: GatewayClient;
  onAskAgent: (slug: string) => void;
}) {
  const { slug } = useParams();
  const navigate = useNavigate();
  if (!slug) return <Navigate replace to="/markets" />;
  return (
    <MarketDetailWorkspace
      client={client}
      slug={slug}
      onBack={() => navigate("/markets")}
      onAskAgent={onAskAgent}
    />
  );
}

export function MarketsWorkspace(props: {
  client: GatewayClient;
  onSelectMarket: (slug: string) => void;
}) {
  const [order, setOrder] = useState<MarketOrder>("volume24hr");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PublicMarketListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await props.client.publicMarkets(PAGE_SIZE, offset, order);
      setPage(response);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [offset, order, props.client]);

  // Browse refreshes on a cadence; the cancelled flag keeps a late response
  // from painting after the query changed.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load();
    const timer = window.setInterval(() => {
      if (!cancelled) void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [load]);

  return (
    <main className="detail-page market-browse">
      <header className="page-title">
        <div>
          <span className="eyebrow">Live Polymarket</span>
          <h1>Markets</h1>
          <p>Real-time prices, order books, and history — no sign-in required.</p>
        </div>
        <div className="page-title-actions">
          <label className="market-order">
            <span className="eyebrow">Order</span>
            <select
              value={order}
              onChange={(event) => {
                setOffset(0);
                setOrder(event.target.value as MarketOrder);
              }}
            >
              {MARKET_ORDERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <section className="market-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <div>
            <strong>Live market data could not be loaded</strong>
            <p>{error}</p>
          </div>
          <button className="button button-quiet" type="button" onClick={() => void load()}>
            Try again
          </button>
        </section>
      )}

      {loading && !page && <PageLoading label="Loading markets" />}

      <section className="market-grid" aria-label="Active markets">
        {page?.markets.map((market) => (
          <MarketCard
            key={market.id || market.slug}
            market={market}
            onSelect={() => props.onSelectMarket(market.slug)}
          />
        ))}
      </section>

      {page && page.markets.length === 0 && !error && (
        <section className="empty-page-card">
          <h2>No active markets</h2>
          <p>Polymarket has no bookable active markets right now.</p>
        </section>
      )}

      {page && (offset > 0 || page.hasMore) && (
        <nav className="market-pagination" aria-label="Market pages">
          <button
            className="button button-quiet"
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >Previous</button>
          <button
            className="button button-primary"
            type="button"
            disabled={!page.hasMore}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >Next</button>
        </nav>
      )}
    </main>
  );
}

function MarketCard({
  market,
  onSelect,
}: {
  market: PublicMarketSummary;
  onSelect: () => void;
}) {
  return (
    <button className="market-card" type="button" onClick={onSelect}>
      <span className="market-card-head">
        {market.icon
          ? <img className="market-icon" src={market.icon} alt="" loading="lazy" />
          : <CircleDot aria-hidden="true" />}
        <span className="market-card-question">{market.question}</span>
      </span>
      <span className="market-card-outcomes">
        {market.outcomes.map((outcome, index) => (
          <span key={outcome ?? index}>
            <span>{outcome}</span>
            <strong>{formatPrice(market.outcomePrices[index]) ?? "—"}</strong>
          </span>
        ))}
      </span>
      <span className="market-card-meta">
        <span>24h {formatCompact(market.volume24hr ?? market.volume)}</span>
        <span>Liq {formatCompact(market.liquidity)}</span>
        {market.endDate && <span>Ends {formatDate(market.endDate)}</span>}
      </span>
    </button>
  );
}

export function MarketDetailWorkspace(props: {
  client: GatewayClient;
  slug: string;
  onBack: () => void;
  onAskAgent: (slug: string) => void;
}) {
  const [detail, setDetail] = useState<PublicMarketDetail | null>(null);
  const [book, setBook] = useState<PublicOrderBook | null>(null);
  const [history, setHistory] = useState<PublicPriceHistory | null>(null);
  const [tapeInterval, setTapeInterval] = useState<MarketHistoryInterval>("1d");
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenIds = detail?.market.clobTokenIds ?? [];
  const activeToken = tokenIds.includes(selectedToken ?? "")
    ? selectedToken!
    : tokenIds[0] ?? null;
  const market = detail?.market ?? null;

  // Metadata refreshes on a cadence; the cancelled flag keeps a late response
  // for a previous slug from painting onto this one.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await props.client.publicMarket(props.slug);
        if (cancelled) return;
        setDetail(next);
        setMissing(false);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof GatewayError && caught.status === 404) {
          setMissing(true);
        } else {
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!cancelled) void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attempt, props.client, props.slug]);

  // The active outcome's book refreshes on its own cadence so switching
  // outcomes feels instant and a failed book never blanks the page.
  useEffect(() => {
    if (!activeToken) return;
    let cancelled = false;
    const load = async () => {
      try {
        const next = await props.client.publicOrderBook(activeToken);
        if (!cancelled) setBook(next);
      } catch {
        if (!cancelled) setBook(null);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!cancelled) void load();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeToken, props.client]);

  // The tape only changes shape with the token or interval, so it refreshes on
  // selection rather than on the metadata cadence.
  useEffect(() => {
    if (!activeToken) return;
    let cancelled = false;
    setHistory(null);
    void props.client
      .publicPriceHistory(activeToken, tapeInterval)
      .then((value) => {
        if (!cancelled) setHistory(value);
      })
      .catch(() => {
        if (!cancelled) setHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeToken, tapeInterval, props.client]);

  useDocumentMeta({
    title: market ? `${market.question} · PolyTrade` : "Market · PolyTrade",
    description: market
      ? `Live prices, order book depth, and history for "${market.question}" on Polymarket.`
      : undefined,
    path: `/markets/${props.slug}`,
  });

  if (missing) {
    return (
      <main className="detail-page market-detail">
        <section className="empty-page-card" role="alert">
          <CircleAlert aria-hidden="true" />
          <h2>Market not found</h2>
          <p>“{props.slug}” is not an active Polymarket market.</p>
          <button className="button button-quiet" type="button" onClick={props.onBack}>
            Back to all markets
          </button>
        </section>
      </main>
    );
  }

  if (!market) {
    return (
      <main className="detail-page market-detail">
        {error ? (
          <section className="market-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <div>
              <strong>This market could not be loaded</strong>
              <p>{error}</p>
            </div>
            <button
              className="button button-quiet"
              type="button"
              onClick={() => setAttempt((current) => current + 1)}
            >Try again</button>
          </section>
        ) : (
          <PageLoading label="Loading market" />
        )}
      </main>
    );
  }

  const quotes = detail!.quotes;
  const activeOutcome =
    market.outcomes[market.clobTokenIds.indexOf(activeToken ?? "")] ?? null;
  const spread = book?.bids[0] && book?.asks[0]
    ? `${formatPercent(book.asks[0]?.price)} / ${formatPercent(book.bids[0]?.price)}`
    : "—";

  return (
    <main className="detail-page market-detail">
      <header className="page-title">
        <div>
          <button className="market-back" type="button" onClick={props.onBack}>
            <ArrowLeft aria-hidden="true" /> All markets
          </button>
          <h1>{market.question}</h1>
          <p>{market.closed ? "This market is closed." : "Live Polymarket read-only research view."}</p>
        </div>
        <div className="page-title-actions">
          <span className={`status-pill ${market.acceptingOrders && !market.closed ? "status-pill-open" : "status-pill-sell"}`}>
            {market.closed ? "Closed" : market.acceptingOrders ? "Accepting orders" : "Not accepting orders"}
          </span>
          <button
            className="button button-primary"
            type="button"
            onClick={() => props.onAskAgent(market.slug)}
          >Ask the agent</button>
        </div>
      </header>

      <section className="metric-ribbon market-ribbon">
        {quotes.map((quote) => (
          <div className="result-metric" key={quote.tokenId || quote.outcome}>
            <span>{quote.outcome}</span>
            <strong>{formatPrice(quote.price) ?? "—"}</strong>
            <em>
              {quote.source === "order-book"
                ? `${formatPercent(quote.bestBid)} / ${formatPercent(quote.bestAsk)}`
                : "Gamma prices"}
            </em>
          </div>
        ))}
        <div className="result-metric">
          <span>24h volume</span>
          <strong>{formatCompact(market.volume24hr ?? market.volume)}</strong>
        </div>
        <div className="result-metric">
          <span>Liquidity</span>
          <strong>{formatCompact(market.liquidity)}</strong>
        </div>
        <div className="result-metric">
          <span>Total volume</span>
          <strong>{formatCompact(market.volume)}</strong>
        </div>
        <div className="result-metric">
          <span>End date</span>
          <strong>{market.endDate ? formatDate(market.endDate) : "—"}</strong>
        </div>
      </section>

      <section className="data-section market-tape-section">
        <header>
          <div>
            <span className="eyebrow">Price tape</span>
            <h2>{activeOutcome ? `${activeOutcome} price history` : "Price history"}</h2>
          </div>
          <div className="market-tape-controls">
            {market.clobTokenIds.map((tokenId, index) => (
              <button
                className={`market-toggle ${activeToken === tokenId ? "market-toggle-active" : ""}`}
                key={tokenId || index}
                type="button"
                onClick={() => setSelectedToken(tokenId)}
              >{market.outcomes[index] ?? `Outcome ${index + 1}`}</button>
            ))}
            <span className="market-tape-intervals" role="group" aria-label="History interval">
              {TAPE_INTERVALS.map((value) => (
                <button
                  className={`market-toggle ${tapeInterval === value ? "market-toggle-active" : ""}`}
                  key={value}
                  type="button"
                  onClick={() => setTapeInterval(value)}
                >{value}</button>
              ))}
            </span>
          </div>
        </header>
        {history
          ? <MarketPriceTape points={history.points} />
          : <p className="table-empty">Loading price history…</p>}
        <p className="market-spread mono">Best ask / best bid: {spread}</p>
      </section>

      <section className="data-section market-book-section">
        <header>
          <div>
            <span className="eyebrow">Order book</span>
            <h2>{activeOutcome ? `${activeOutcome} depth` : "Depth"}</h2>
          </div>
          <span className="count-pill">
            {(book?.bids.length ?? 0) + (book?.asks.length ?? 0)} levels
          </span>
        </header>
        {book && (book.bids.length > 0 || book.asks.length > 0) ? (
          <div className="market-book">
            <BookSide heading="Bids" levels={book.bids} />
            <BookSide heading="Asks" levels={book.asks} />
          </div>
        ) : (
          <p className="table-empty">The order book is empty right now.</p>
        )}
      </section>

      <section className="data-section market-info-section">
        <header>
          <div>
            <span className="eyebrow">Market details</span>
            <h2>About this market</h2>
          </div>
          <a
            className="button button-quiet"
            href={`https://polymarket.com/event/${market.slug}`}
            target="_blank"
            rel="noreferrer"
          >Open on Polymarket</a>
        </header>
        {market.description && <p className="market-description">{market.description}</p>}
        <table className="market-facts">
          <tbody>
            <tr><th scope="row">Slug</th><td><code>{market.slug}</code></td></tr>
            <tr><th scope="row">Condition</th><td><code>{market.conditionId}</code></td></tr>
            <tr><th scope="row">Minimum order size</th><td>{market.minimumOrderSize || "—"}</td></tr>
            <tr><th scope="row">Tick size</th><td>{market.minimumTickSize || "—"}</td></tr>
            <tr><th scope="row">Start</th><td>{market.startDate ? formatDate(market.startDate) : "—"}</td></tr>
            <tr><th scope="row">End</th><td>{market.endDate ? formatDate(market.endDate) : "—"}</td></tr>
          </tbody>
        </table>
      </section>
    </main>
  );
}

// Custom SVG tape following the ReplayTape idiom: grid lines, text axis
// labels, and text descriptions instead of a chart library.
function MarketPriceTape({ points }: { points: PublicPriceHistory["points"] }) {
  if (points.length < 2) {
    return <p className="table-empty">Not enough history to draw a tape yet.</p>;
  }
  const width = 960;
  const height = 320;
  const pad = { top: 16, right: 20, bottom: 30, left: 56 };
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const prices = points.map((point) => Number(point.price));
  const low = Math.max(0, Math.min(...prices) - 0.05);
  const high = Math.min(1, Math.max(...prices) + 0.05);
  const span = Math.max(0.01, high - low);
  const timeSpan = Math.max(1, last.timestamp - first.timestamp);
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const x = (timestamp: number) =>
    pad.left + ((timestamp - first.timestamp) / timeSpan) * innerWidth;
  const y = (price: number) =>
    pad.top + (1 - (price - low) / span) * innerHeight;
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${x(point.timestamp).toFixed(1)} ${y(Number(point.price)).toFixed(1)}`,
    )
    .join(" ");
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg
      className="market-tape"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Price history chart"
    >
      {gridLines.map((fraction) => {
        const value = low + fraction * span;
        return (
          <g key={fraction}>
            <line
              className="market-tape-grid"
              x1={pad.left}
              x2={width - pad.right}
              y1={y(value)}
              y2={y(value)}
            />
            <text className="market-tape-axis" x={pad.left - 8} y={y(value) + 4} textAnchor="end">
              {Math.round(value * 100)}¢
            </text>
          </g>
        );
      })}
      <path className="market-tape-path" d={path} fill="none" />
      <text className="market-tape-axis" x={pad.left} y={height - 8}>
        {formatAxisTime(first.timestamp)}
      </text>
      <text className="market-tape-axis" x={width - pad.right} y={height - 8} textAnchor="end">
        {formatAxisTime(last.timestamp)}
      </text>
    </svg>
  );
}

function BookSide({ heading, levels }: { heading: string; levels: PublicOrderBookLevel[] }) {
  if (levels.length === 0) return <p className="table-empty">{heading}: none.</p>;
  const maxSize = Math.max(...levels.map((level) => Number(level.size)), 1);
  return (
    <div className="market-book-side">
      <h3>{heading}</h3>
      <table className="market-book-table">
        <thead>
          <tr><th scope="col">Price</th><th scope="col">Size</th></tr>
        </thead>
        <tbody>
          {levels.slice(0, 10).map((level, index) => (
            <tr key={`${level.price}-${index}`}>
              <td className={`mono ${heading === "Bids" ? "value-positive" : "value-negative"}`}>
                <span className="market-depth" aria-hidden="true">
                  <span
                    style={{ width: `${Math.min(100, (Number(level.size) / maxSize) * 100)}%` }}
                  />
                </span>
                {formatPrice(level.price) ?? level.price}
              </td>
              <td>{formatNumber(level.size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageLoading({ label }: { label: string }) {
  return (
    <section className="page-loading" role="status">
      <RefreshCw aria-hidden="true" />
      <span>{label}</span>
    </section>
  );
}

function useDocumentMeta({
  title,
  description,
  path,
}: {
  title: string;
  description?: string;
  path?: string;
}) {
  useEffect(() => {
    document.title = title;
    const descriptionTag = document.querySelector("meta[name='description']");
    if (description && descriptionTag) descriptionTag.setAttribute("content", description);
    const ogTitle = document.querySelector("meta[property='og:title']");
    if (ogTitle) ogTitle.setAttribute("content", title);
    const ogDescription = document.querySelector("meta[property='og:description']");
    if (description && ogDescription) ogDescription.setAttribute("content", description);
    const siteUrl = env.VITE_PUBLIC_SITE_URL;
    if (!siteUrl || !path) return;
    const url = `${siteUrl.replace(/\/$/, "")}${path}`;
    let canonical = document.querySelector("link[rel='canonical']");
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.setAttribute("rel", "canonical");
      document.head.appendChild(canonical);
    }
    canonical.setAttribute("href", url);
    let ogUrl = document.querySelector("meta[property='og:url']");
    if (!ogUrl) {
      ogUrl = document.createElement("meta");
      ogUrl.setAttribute("property", "og:url");
      document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute("content", url);
  }, [description, path, title]);
}

function errorMessage(error: unknown): string {
  if (error instanceof GatewayError) return error.message;
  return error instanceof Error && error.message ? error.message : "Something went wrong";
}

function formatPrice(value?: string | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  const price = Number(value);
  if (!Number.isFinite(price)) return null;
  if (price <= 0) return "0¢";
  if (price >= 1) return "100¢";
  const cents = price * 100;
  return `${Number.isInteger(cents) ? cents.toFixed(0) : cents.toFixed(1).replace(/\.0$/, "")}¢`;
}

function formatPercent(value?: string | null): string {
  if (!value) return "—";
  const price = Number(value);
  return Number.isFinite(price) ? `${Math.round(price * 100)}¢` : "—";
}

function formatCompact(value?: string | null): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

function formatNumber(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : value;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAxisTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}