import { describe, expect, it } from 'vitest'

import { fsum } from './fsum.js'
import { kahanSum, neumaierSum, pairwiseSum, sum } from './ladder.js'
import { referenceSum } from './reference.js'
import { fast2Sum, twoSum } from './twoSum.js'

/* ------------------------------------------------------------------ */
/* Test kit: deterministic vectors + ulp distance                      */
/* ------------------------------------------------------------------ */

// LCG (Numerical Recipes constants) — deterministic adversarial vectors.
let seed = 0x2f6e2b1
const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
}

const F64 = new Float64Array(1)
const U64 = new BigUint64Array(F64.buffer)
/** Map a finite double to its rank in the total order, so ulp distance is a subtraction. */
const ordinal = (x: number): bigint => {
    F64[0] = x
    const u = U64[0]
    return u < 1n << 63n ? u : (1n << 63n) - u
}
const ulpsBetween = (a: number, b: number): bigint => {
    const d = ordinal(a) - ordinal(b)
    return d < 0n ? -d : d
}

const shuffled = <T>(xs: readonly T[]): T[] => {
    const out = xs.slice()
    for (let i = out.length - 1; i > 0; i--) {
        const j = (rand() * (i + 1)) | 0
        const t = out[i]
        out[i] = out[j]
        out[j] = t
    }
    return out
}

/** Values spanning 2^±spread — the exponent spread is what makes summation hard. */
const expSpread = (n: number, spread: number): number[] =>
    Array.from({ length: n }, () => (rand() * 2 - 1) * 2 ** Math.floor(rand() * 2 * spread - spread))

/** Exact powers of two: halfway cases (rounding ties) abound. */
const powersOfTwo = (n: number): number[] =>
    Array.from({ length: n }, () => (rand() < 0.5 ? -1 : 1) * 2 ** -Math.floor(rand() * 60))

/** Massive cancellation: shuffled ±pairs plus a tiny residual tail. */
const cancelling = (n: number): number[] => {
    const xs: number[] = []
    for (let i = 0; i < n / 2; i++) {
        const x = (rand() * 2 - 1) * 2 ** Math.floor(rand() * 60 - 30)
        xs.push(x, -x)
    }
    xs.push(rand() * 2 ** -40)
    return shuffled(xs)
}

const subnormalish = (n: number): number[] => expSpread(n, 20).map((x) => x * 2 ** -1050)

/* ------------------------------------------------------------------ */
/* fsum ≡ referenceSum — the central property                          */
/* ------------------------------------------------------------------ */

describe('fsum agrees exactly with the BigInt oracle', () => {
    const families: [string, () => number[]][] = [
        ['uniform', () => Array.from({ length: 500 }, () => rand() * 2 - 1)],
        ['exponent spread ±30', () => expSpread(300, 30)],
        ['exponent spread ±300', () => expSpread(200, 300)],
        ['powers of two (ties)', () => powersOfTwo(400)],
        ['massive cancellation', () => cancelling(300)],
        ['subnormal range', () => subnormalish(200)],
        ['short vectors', () => expSpread(1 + ((rand() * 4) | 0), 40)],
    ]
    for (const [name, gen] of families) {
        it(name, () => {
            for (let round = 0; round < 40; round++) {
                const v = gen()
                const expected = referenceSum(v)
                expect(fsum(v)).toBe(expected) // toBe is Object.is: catches -0 too
            }
        })
    }

    it('is permutation-invariant (exactness has no order)', () => {
        const v = expSpread(300, 40)
        const expected = referenceSum(v)
        for (let round = 0; round < 8; round++) {
            expect(fsum(shuffled(v))).toBe(expected)
        }
    })
})

/* ------------------------------------------------------------------ */
/* Correct rounding at the boundaries                                  */
/* ------------------------------------------------------------------ */

describe('correct rounding, ties-to-even', () => {
    it('halfway down to even mantissa', () => {
        expect(fsum([1, 2 ** -53])).toBe(1)
        expect(referenceSum([1, 2 ** -53])).toBe(1)
    })
    it('a crumb above halfway rounds up', () => {
        expect(fsum([1, 2 ** -53, 2 ** -107])).toBe(1 + 2 ** -52)
        expect(referenceSum([1, 2 ** -53, 2 ** -107])).toBe(1 + 2 ** -52)
    })
    it('a crumb below halfway rounds down', () => {
        expect(fsum([1, 2 ** -53, -(2 ** -107)])).toBe(1)
        expect(referenceSum([1, 2 ** -53, -(2 ** -107)])).toBe(1)
    })
    it('halfway up from odd mantissa (ties to even)', () => {
        expect(fsum([1 + 2 ** -52, 2 ** -53])).toBe(1 + 2 ** -51)
        expect(referenceSum([1 + 2 ** -52, 2 ** -53])).toBe(1 + 2 ** -51)
    })
    it('overflow boundary: MAX + 2^970 is the exact midpoint and ties to Infinity', () => {
        expect(referenceSum([Number.MAX_VALUE, 2 ** 970])).toBe(Infinity)
        expect(referenceSum([Number.MAX_VALUE, 2 ** 969])).toBe(Number.MAX_VALUE)
    })
    it('exact subnormal results', () => {
        expect(fsum([Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE])).toBe(
            3 * Number.MIN_VALUE
        )
        expect(referenceSum([2 ** -1022, -(2 ** -1022 * (1 - 2 ** -52))])).toBe(
            fsum([2 ** -1022, -(2 ** -1022 * (1 - 2 ** -52))])
        )
    })
})

/* ------------------------------------------------------------------ */
/* Non-finite and zero semantics                                       */
/* ------------------------------------------------------------------ */

describe('specials', () => {
    const both = (v: number[]) => [fsum(v), referenceSum(v)]
    it('NaN anywhere poisons', () => {
        for (const r of both([1, NaN, 2])) expect(r).toBeNaN()
        for (const r of both([Infinity, NaN])) expect(r).toBeNaN()
    })
    it('mixed infinities → NaN; single-signed → that infinity', () => {
        for (const r of both([Infinity, -Infinity])) expect(r).toBeNaN()
        for (const r of both([1, Infinity, 2])) expect(r).toBe(Infinity)
        for (const r of both([-Infinity, -1])) expect(r).toBe(-Infinity)
        for (const r of both([Infinity, Infinity])) expect(r).toBe(Infinity)
    })
    it('empty sum is +0; a sum of only -0s is -0 (IEEE addition chain)', () => {
        expect(fsum([])).toBe(0)
        expect(referenceSum([])).toBe(0)
        for (const r of both([-0, -0, -0])) expect(Object.is(r, -0)).toBe(true)
        for (const r of both([-0, 0])) expect(Object.is(r, 0)).toBe(true)
        for (const r of both([1, -1])) expect(Object.is(r, 0)).toBe(true)
    })
    it('finite inputs whose partials overflow: fsum refuses loudly, reference answers exactly', () => {
        expect(() => fsum([1e308, 1e308])).toThrow(RangeError)
        expect(referenceSum([1e308, 1e308])).toBe(Infinity)
        expect(() => fsum([1e308, 1e308, -1e308, -1e308])).toThrow(RangeError)
        expect(referenceSum([1e308, 1e308, -1e308, -1e308])).toBe(0)
    })
})

/* ------------------------------------------------------------------ */
/* The ladder: each rung within its proven bound                       */
/* ------------------------------------------------------------------ */

describe('the accuracy ladder', () => {
    it('the classic Kahan failure: [1, 1e100, 1, -1e100]', () => {
        expect(sum([1, 1e100, 1, -1e100])).toBe(0) // naive loses both 1s
        expect(kahanSum([1, 1e100, 1, -1e100])).toBe(0) // Kahan truncates its own correction
        expect(neumaierSum([1, 1e100, 1, -1e100])).toBe(2) // Neumaier keeps it
        expect(fsum([1, 1e100, 1, -1e100])).toBe(2)
        expect(referenceSum([1, 1e100, 1, -1e100])).toBe(2)
    })

    it('well-conditioned n=10000: compensated rungs land within ulps of exact', () => {
        const v = Array.from({ length: 10_000 }, () => rand())
        const exact = fsum(v)
        expect(fsum(v)).toBe(referenceSum(v))
        expect(ulpsBetween(kahanSum(v), exact)).toBeLessThanOrEqual(2n)
        expect(ulpsBetween(neumaierSum(v), exact)).toBeLessThanOrEqual(2n)
        expect(ulpsBetween(pairwiseSum(v), exact)).toBeLessThanOrEqual(64n)
        // the baseline drifts but stays within its O(n·u) worst case
        expect(ulpsBetween(sum(v), exact)).toBeLessThanOrEqual(10_000n)
    })

    it('typed arrays are first-class', () => {
        const v = Float64Array.from({ length: 2048 }, () => rand() * 2 - 1)
        const exact = fsum(v)
        expect(exact).toBe(referenceSum(v))
        expect(ulpsBetween(neumaierSum(v), exact)).toBeLessThanOrEqual(2n)
        expect(ulpsBetween(pairwiseSum(v), exact)).toBeLessThanOrEqual(64n)
    })
})

/* ------------------------------------------------------------------ */
/* pairwiseSum mechanics                                               */
/* ------------------------------------------------------------------ */

describe('pairwiseSum', () => {
    it('equals naive summation exactly up to one block', () => {
        for (const n of [0, 1, 2, 15, 16]) {
            const v = expSpread(n, 30)
            expect(pairwiseSum(v, 16)).toBe(sum(v))
        }
    })
    it('handles empty and singleton', () => {
        expect(pairwiseSum([])).toBe(0)
        expect(pairwiseSum([42.5])).toBe(42.5)
    })
    it('rejects blockSize < 2', () => {
        expect(() => pairwiseSum([1, 2, 3], 1)).toThrow(RangeError)
    })
    it('deep recursion is safe (n = 2^20)', () => {
        const v = new Float64Array(1 << 20).fill(0.1)
        expect(Number.isFinite(pairwiseSum(v, 2))).toBe(true)
    })
})

/* ------------------------------------------------------------------ */
/* Error-free transformations                                          */
/* ------------------------------------------------------------------ */

describe('twoSum / fast2Sum are error-free', () => {
    it('a + b === s + e exactly, verified in exact rational arithmetic', () => {
        for (let round = 0; round < 2000; round++) {
            const a = (rand() * 2 - 1) * 2 ** Math.floor(rand() * 600 - 300)
            const b = (rand() * 2 - 1) * 2 ** Math.floor(rand() * 600 - 300)
            for (const [s, e] of [twoSum(a, b), fast2Sum(a, b)]) {
                expect(s).toBe(a + b)
                // (a + b) - (s + e) must be exactly zero as a real number
                expect(referenceSum([a, b, -s, -e])).toBe(0)
            }
        }
    })
})
