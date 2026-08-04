import { z } from "zod";

const envSchema = z.object({
  VITE_AGENT_URL: z.string().url(),
  VITE_BACKTEST_URL: z.string().url(),
  VITE_GATEWAY_URL: z.string().url(),
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  VITE_CLERK_JWT_TEMPLATE: z.string().min(1).default("polytrade"),
});

export const env = envSchema.parse(import.meta.env);

if (import.meta.env.PROD) {
  for (const [name, value] of [
    ["VITE_AGENT_URL", env.VITE_AGENT_URL],
    ["VITE_BACKTEST_URL", env.VITE_BACKTEST_URL],
    ["VITE_GATEWAY_URL", env.VITE_GATEWAY_URL],
  ] as const) {
    const parsed = new URL(value);
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
      throw new Error(`${name} must use HTTPS outside local loopback development`);
    }
  }
}
