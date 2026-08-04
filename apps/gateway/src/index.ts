import pg from "pg";

import { createJwtVerifier } from "./auth.js";
import { buildApp } from "./app.js";
import { parseConfig } from "./config.js";
import { CredentialCipher } from "./crypto.js";
import { GeoblockService } from "./geoblock.js";
import { PostgresPaperStore } from "./paper-store.js";
import { PaperTradingService } from "./paper.js";
import { PolymarketAdapter } from "./polymarket.js";
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
const geoblock = new GeoblockService(
  config.POLYMARKET_GEOBLOCK_URL,
  config.POLYMARKET_REQUEST_TIMEOUT_MS,
);
const trading = new TradingService(config, store, cipher, polymarket, geoblock);
const paper = new PaperTradingService(new PostgresPaperStore(pool), polymarket);
const app = await buildApp({
  config,
  verifier: createJwtVerifier(config),
  store,
  polymarket,
  trading,
  paper,
});

await app.listen({ host: "0.0.0.0", port: config.PORT });
