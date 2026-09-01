import pg from "pg";

import { createJwtVerifier } from "./auth.js";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";
import { CredentialCipher } from "./crypto.js";
import { PostgresPaperStore } from "./paper-store.js";
import { PostgresPaperStrategyStore } from "./paper-strategy-store.js";
import { PaperStrategyBackgroundRunner, PaperStrategyService } from "./paper-strategy.js";
import { PaperTradingService } from "./paper.js";
import { PolymarketAdapter } from "./polymarket.js";
import { PublicMarketService } from "./public-market.js";
import { TtlCache } from "./public-cache.js";
import { PostgresTradingStore } from "./store.js";
import { TradingService } from "./trading.js";

const config = parseConfig(process.env);
const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "polytrade-gateway",
  options: "-c search_path=polytrade,public",
});
const store = new PostgresTradingStore(pool);
const cipher = new CredentialCipher(config.credentialKey);
const polymarket = new PolymarketAdapter(config);
const trading = new TradingService(config, store, cipher, polymarket);
const paperStore = new PostgresPaperStore(pool);
const paper = new PaperTradingService(paperStore, polymarket);
const paperStrategyStore = new PostgresPaperStrategyStore(pool);
const paperStrategy = new PaperStrategyService(paperStrategyStore, paper);
const publicMarkets = new PublicMarketService(polymarket, new TtlCache());
let reportStrategyError: (error: unknown) => void = () => undefined;
const paperStrategyRunner = new PaperStrategyBackgroundRunner(paperStrategyStore, paper, {
  onError: (error) => reportStrategyError(error),
});
const app = await buildApp({
  config,
  verifier: createJwtVerifier(config),
  store,
  polymarket,
  trading,
  paper,
  paperStrategy,
  publicMarkets,
  paperStrategyRunner,
});
reportStrategyError = (error) => app.log.error({ err: error }, "paper strategy runner failed");
paperStrategyRunner.start();

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "gateway shutdown requested");
  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, "gateway shutdown failed");
    process.exitCode = 1;
  }
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: "0.0.0.0", port: config.PORT });
