import type { Price, Usage } from "./types.ts";

/** Cost of one call in US cents (fractional), from token counts and the route's prices. */
export function costCents(
  price: Price,
  t: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number },
): number {
  const usd = (t.inputTokens * price.input + t.cacheReadTokens * price.cacheRead +
    t.cacheWriteTokens * price.cacheWrite + t.outputTokens * price.output) / 1_000_000;
  return usd * 100;
}

export function usage(
  price: Price,
  t: { inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; outputTokens: number },
): Usage {
  return { ...t, costCents: costCents(price, t) };
}
