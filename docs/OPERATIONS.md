# Operations

## Deployment order

Provision the remote PostgreSQL database before deploying the root Compose
project as one always-on application. Assign HTTPS domains to `web`, `gateway`,
`agent`, and `backtest-api`; keep Redis and `backtest-worker` private. Configure
the matching public Vite URLs and list the exact browser origins in
`CORS_ORIGINS`.

Clerk configuration is required for the standalone PolyTrade web application.
AssetHero API access is optional: set `ASSETHERO_API_ISSUER` and
`ASSETHERO_API_JWKS_URL` together on the gateway, agent, backtest API, and worker
only when the integration is enabled. Add AssetHero's origin to `CORS_ORIGINS`
only when its browser calls PolyTrade directly.

Compose starts components in this order:

1. The remote PostgreSQL database is reachable and Redis becomes healthy.
2. The gateway connects through `DATABASE_URL`, runs the idempotent schema
   bootstrap, and passes health.
3. The backtest API, workers, and agent start with the same `DATABASE_URL`.
4. The web application starts after all public APIs are ready.

Compose connects only to the existing remote database supplied through
`DATABASE_URL`; this rule also applies to local application runs. Do not add
another database, role, or URL for the agent or backtester. The remote database
user must be able to create schemas, tables, functions, triggers, and required
extensions. An empty database is expected for this release.

## Backtest worker settings

Start with two Celery processes/slots and prefetch one. Keep
`BACKTEST_VISIBILITY_TIMEOUT_SECONDS` greater than
`BACKTEST_HARD_TIME_LIMIT_SECONDS`, and keep `BACKTEST_STALE_SECONDS` greater
than the hard limit. The defaults are 840 seconds soft, 900 seconds hard, 1,200
seconds visibility, and 960 seconds stale detection. The normalized dataset cap
is two million points.

Redis uses append-only persistence. It is still not authoritative: queued,
running, progress, cancellation, failure, and result state live in PostgreSQL.
If Redis is unavailable, creates remain safely committed in the outbox and are
published after recovery. If a worker disappears, stale reconciliation requeues
the run. Monitor outbox attempts, stale recovery counts, task runtime, and worker
heartbeats.

Workers need outbound HTTPS only to the configured public Gamma and CLOB hosts,
plus private PostgreSQL and Redis connectivity. Do not provide gateway wallet
secrets, a CLOB API credential, a wallet key, or an order endpoint to a worker.

## Readiness and backup

- Gateway `/health` confirms database access after bootstrap.
- Agent `/readyz` confirms its schema and internal gateway reachability.
- Backtest `/readyz` confirms its assigned schema.
- Redis health uses `PING`; worker monitoring uses Celery heartbeats/events.

Back up the single PostgreSQL database as one unit. A restore must keep all three
schemas at the same point in time. Agent checkpoints also require the matching
`LANGGRAPH_AES_KEY`; gateway sessions require `CREDENTIALS_KEK_BASE64`. Redis can
be rebuilt from PostgreSQL, though AOF reduces recovery latency.

## Secret rotation

- Rotate enabled AssetHero API and Clerk signing keys through overlapping JWKS entries.
- Do not replace `LANGGRAPH_AES_KEY` in place without expiring or re-encrypting
  old checkpoints.
- Revoke wallet sessions before replacing `CREDENTIALS_KEK_BASE64`.
- Never configure LangSmith tracing or put authorization headers, prompts,
  signatures, credentials, or raw upstream bodies in access logs.
