import { isIP } from "node:net";

import { unavailable } from "./errors.js";

export interface Eligibility {
  blocked: boolean;
  ip: string;
  country: string;
  region: string;
  verified: boolean;
  checkedAt: string;
}

export class GeoblockService {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs: number,
    private readonly request: typeof fetch = fetch,
  ) {}

  async status(clientIp: string): Promise<Eligibility> {
    try {
      return await this.check(clientIp);
    } catch {
      return {
        blocked: true,
        ip: isIP(clientIp) ? clientIp : "",
        country: "",
        region: "",
        verified: false,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async check(clientIp: string): Promise<Eligibility> {
    if (!isIP(clientIp)) throw unavailable("Unable to determine a valid client IP");
    let response: Response;
    try {
      response = await this.request(this.endpoint, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Forwarded-For": clientIp,
          "X-Real-IP": clientIp,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw unavailable("Polymarket geographic eligibility is unavailable");
    }
    if (!response.ok) throw unavailable("Polymarket geographic eligibility failed");

    const value = (await response.json()) as Partial<Eligibility>;
    const evaluatedIp = value.ip ?? "";
    const verified = normalizeIp(evaluatedIp) === normalizeIp(clientIp);
    return {
      blocked: verified ? value.blocked !== false : true,
      ip: evaluatedIp,
      country: typeof value.country === "string" ? value.country : "",
      region: typeof value.region === "string" ? value.region : "",
      verified,
      checkedAt: new Date().toISOString(),
    };
  }
}

function normalizeIp(value: string): string {
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}
