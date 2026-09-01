// Routes reachable without signing in: served to signed-out visitors and
// crawlers with the public read-only market data from the gateway.
export const PUBLIC_ROUTE_PREFIX = "/markets";

export function isPublicRoute(pathname: string): boolean {
  return pathname === PUBLIC_ROUTE_PREFIX || pathname.startsWith(`${PUBLIC_ROUTE_PREFIX}/`);
}