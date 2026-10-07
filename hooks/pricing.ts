import type { Usage } from '../types'

/** US dollars per million tokens. */
type Rates = { input: number; output: number; cacheRead: number }

/**
 * First-party API list prices (Claude API reference, cached 2026-09-25), most
 * specific pattern first. A 5-minute cache write is 1.25x the input price.
 */
const PRICES: ReadonlyArray<[RegExp, Rates]> = [
  [/(fable|mythos)\W*5\W*1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable|mythos/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus\W*5\W*5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus\W*(5|4)/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/opus/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/sonnet\W*4/, { input: 3, output: 15, cacheRead: 0.3 }],
  [/sonnet/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1 }],
]

const CACHE_WRITE = 1.25

export type TokenCounts = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** What the tokens would cost at API list price on `model`, or null for a model with no known price. */
export const priceOf = (model: string, used: TokenCounts): number | null => {
  const name = model.toLowerCase()
  const rates = PRICES.find(([pattern]) => pattern.test(name))?.[1]
  if (!rates) return null

  return (
    (used.input_tokens * rates.input +
      used.output_tokens * rates.output +
      used.cache_read_input_tokens * rates.cacheRead +
      used.cache_creation_input_tokens * rates.input * CACHE_WRITE) /
    1_000_000
  )
}

/** Adds one call's tokens and cost to a sum; a sum an earlier version kept may lack `cost` and `unpriced`. */
export const addUsage = (sum: Usage, used: TokenCounts, cost: number | null): Usage => ({
  runs: sum.runs + 1,
  input: sum.input + used.input_tokens,
  output: sum.output + used.output_tokens,
  cacheRead: sum.cacheRead + used.cache_read_input_tokens,
  cacheWrite: sum.cacheWrite + used.cache_creation_input_tokens,
  cost: (sum.cost ?? 0) + (cost ?? 0),
  unpriced: (sum.unpriced ?? 0) + (cost === null ? 1 : 0),
})

export const dollars = (cost: number) =>
  cost >= 1 ? `$${cost.toFixed(2)}` : cost >= 0.01 ? `$${cost.toFixed(3)}` : `$${cost.toFixed(4)}`
