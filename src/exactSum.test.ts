import { describe, expect, it } from 'vitest'

import {
    cumulativeSum,
    exactSum,
    fast2Sum,
    neumaierSum,
    pairwiseSum,
    sum,
    twoSum,
} from './index.js'
import { oracleSum, ulp, ulpsBetween } from './testKit.js'

function generator(initialSeed = 0x6d2b79f5): () => number {
    let state = initialSeed >>> 0
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 2 ** 32
    }
}

function shuffle(xs: readonly number[], random: () => number): number[] {
    const result = xs.slice()
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

function assertWithinForwardBound(
    name: 'sum' | 'pairwise' | 'neumaier',
    actual: number,
    exact: number,
    length: number,
    absoluteSum: number
): void {
    const unitRoundoff = 2 ** -53
    let steps: number
    if (name === 'sum') steps = Math.max(0, length - 1)
    else if (name === 'pairwise') steps = Math.ceil(Math.log2(Math.max(1, length / 8))) + 7
    else steps = 2 + length * unitRoundoff

    const gamma = (steps * unitRoundoff) / (1 - steps * unitRoundoff)
    const theoreticalUlps = Math.ceil((gamma * absoluteSum) / ulp(exact) + 0.5)
    const measuredUlps = Math.abs(actual - exact) / ulp(exact)
    expect(measuredUlps, `${name} exceeded its forward-error bound`).toBeLessThanOrEqual(
        theoreticalUlps
    )
}

function measureAll(xs: readonly number[] | Float64Array): void {
    const exact = oracleSum(xs)
    const absoluteSum = oracleSum(Array.from(xs, Math.abs))
    const naive = sum(xs)
    const pairwise = pairwiseSum(xs)
    const neumaier = neumaierSum(xs)
    const ceiling = exactSum(xs)

    expect(Object.is(ceiling, exact), `exactSum differed: ${ceiling} vs ${exact}`).toBe(true)
    if (Number.isFinite(exact) && Number.isFinite(absoluteSum)) {
        assertWithinForwardBound('sum', naive, exact, xs.length, absoluteSum)
        assertWithinForwardBound('pairwise', pairwise, exact, xs.length, absoluteSum)
        assertWithinForwardBound('neumaier', neumaier, exact, xs.length, absoluteSum)
    }
}

describe('the four-rung accuracy ladder', () => {
    it('ships the classic case that plain Kahan misses', () => {
        const xs = [1, 1e100, 1, -1e100]
        expect(sum(xs)).toBe(0)
        expect(neumaierSum(xs)).toBe(2)
        expect(exactSum(xs)).toBe(2)
        measureAll(xs)
    })

    it('cross-checks adversarial cancellation sets against the exact oracle', () => {
        const cases = [
            [1e16, 1, -1e16],
            [1e16, 1, 1, -1e16],
            [1, 1e100, 1, -1e100],
            [2 ** 53, 1, 1, -(2 ** 53)],
            [1, 2 ** -53],
            [1, 2 ** -53, 2 ** -107],
            [1 + 2 ** -52, 2 ** -53],
            [Number.MIN_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE],
        ]
        for (const xs of cases) measureAll(xs)
    })

    it(
        'measures every rung on seeded mixed-sign, mixed-scale arrays through n = 2^20',
        () => {
            const random = generator()
            for (let power = 1; power <= 20; power++) {
                const xs = new Float64Array(2 ** power)
                for (let i = 0; i < xs.length; i++) {
                    const exponent = Math.floor(random() * 1001) - 500
                    xs[i] = (random() * 2 - 1) * 2 ** exponent
                }
                // Prevent an exact zero from making a cancellation-conditioned ULP bound infinite.
                xs[0] += 2 ** -500
                measureAll(xs)
            }
        },
        30_000
    )
})

describe('exactSum', () => {
    it('is permutation invariant', () => {
        const random = generator(0x12345678)
        const xs = Array.from({ length: 2000 }, () => {
            const exponent = Math.floor(random() * 801) - 400
            return (random() * 2 - 1) * 2 ** exponent
        })
        const expected = oracleSum(xs)
        for (let i = 0; i < 12; i++) expect(exactSum(shuffle(xs, random))).toBe(expected)
    })

    it('rounds ties to even and handles overflow without losing cancellation', () => {
        expect(exactSum([1, 2 ** -53])).toBe(1)
        expect(exactSum([1, 2 ** -53, 2 ** -107])).toBe(1 + 2 ** -52)
        expect(exactSum([1 + 2 ** -52, 2 ** -53])).toBe(1 + 2 ** -51)
        expect(exactSum([Number.MAX_VALUE, 2 ** 970])).toBe(Infinity)
        expect(exactSum([Number.MAX_VALUE, 2 ** 969])).toBe(Number.MAX_VALUE)
        expect(exactSum([1e308, 1e308, -1e308, -1e308])).toBe(0)
    })
})

describe('edge semantics', () => {
    for (const fn of [sum, pairwiseSum, neumaierSum, exactSum]) {
        it(`${fn.name}: empty, singleton, zeros, NaN, and infinities`, () => {
            expect(fn([])).toBe(0)
            expect(fn([42.5])).toBe(42.5)
            expect(fn([1, NaN, 2])).toBeNaN()
            expect(fn([1, Infinity, 2])).toBe(Infinity)
            expect(fn([-Infinity, -1])).toBe(-Infinity)
            expect(fn([Infinity, -Infinity])).toBeNaN()
        })
    }

    it('non-finite elements AFTER the overflow point still win (review R1)', () => {
        const MAX = Number.MAX_VALUE
        // The BigInt fallback trips mid-scan on intermediate overflow; a
        // special value later in the array must not be decoded as a finite
        // exponent-2047 bit pattern.
        expect(exactSum([MAX, MAX, NaN])).toBeNaN()
        expect(exactSum([MAX, MAX, -Infinity])).toBe(-Infinity)
        expect(exactSum([MAX, MAX, Infinity])).toBe(Infinity)
        expect(exactSum([1e308, 1e308, -1e308, NaN])).toBeNaN()
        // Control: the same specials before the overflow point.
        expect(exactSum([NaN, MAX, MAX])).toBeNaN()
        expect(exactSum([-Infinity, MAX, MAX])).toBe(-Infinity)
    })

    it('non-numeric garbage outside the TS contract yields NaN, not an infinity (review R2)', () => {
        const junk = (v: unknown) => exactSum(v as number[])
        expect(junk(new Array(3))).toBeNaN()
        expect(junk([1, undefined, 2])).toBeNaN()
        expect(junk([Infinity, undefined])).toBeNaN()
    })

    it('documents zero behavior in executable form', () => {
        expect(Object.is(exactSum([-0]), -0)).toBe(true)
        expect(Object.is(exactSum([]), 0)).toBe(true)
        expect(Object.is(exactSum([-0, 0]), 0)).toBe(true)
        expect(Object.is(exactSum([1, -1]), 0)).toBe(true)
    })

    it('handles the full denormal range', () => {
        measureAll(
            Array.from({ length: 1024 }, (_, i) =>
                (i & 1 ? -1 : 1) * (1 + (i % 31)) * Number.MIN_VALUE
            )
        )
    })
})

describe('cumulativeSum', () => {
    it('returns compensated running prefixes without mutating input', () => {
        const xs = [1, 1e100, 1, -1e100] as const
        expect(cumulativeSum(xs)).toEqual([1, 1e100, 1e100, 2])
        expect(xs).toEqual([1, 1e100, 1, -1e100])
    })

    it('accepts Float64Array and propagates non-finite prefixes', () => {
        expect(cumulativeSum(Float64Array.of(1, 2, 3))).toEqual([1, 3, 6])
        const result = cumulativeSum([1, Infinity, 2, -Infinity])
        expect(result.slice(0, 3)).toEqual([1, Infinity, Infinity])
        expect(result[3]).toBeNaN()
    })
})

describe('error-free transforms', () => {
    it('verifies twoSum and preordered fast2Sum against exact rational arithmetic', () => {
        const random = generator(0xcafef00d)
        for (let i = 0; i < 10_000; i++) {
            let a = (random() * 2 - 1) * 2 ** (Math.floor(random() * 1201) - 600)
            let b = (random() * 2 - 1) * 2 ** (Math.floor(random() * 1201) - 600)
            const [sumPart, residual] = twoSum(a, b)
            expect(oracleSum([a, b, -sumPart, -residual])).toBe(0)

            if (Math.abs(a) < Math.abs(b)) [a, b] = [b, a]
            const [fastSumPart, fastResidual] = fast2Sum(a, b)
            expect(oracleSum([a, b, -fastSumPart, -fastResidual])).toBe(0)
        }
    })
})
