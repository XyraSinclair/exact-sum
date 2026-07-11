/* Opt-in receipts: `BENCH=1 vitest run src/exactSum.bench.test.ts` (or `npm run bench`).
 *
 * Two tables, one story:
 *   speed    — ns/op over Float64Array(2048) and number[](2048)
 *   accuracy — ulps from the exact sum (BigInt oracle) on three conditioning regimes
 *
 * Incumbent rows: d3-array `fsum` (Shewchuk Adder — the serious one) prints
 * alongside ours. The npm `kahan` package (2014) does not survive
 * `npm install` on modern Node (native jscoverage build), which is its row.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error d3-array ships no types; bench-only dep
import { fsum as d3Fsum } from 'd3-array'

import { fsum } from './fsum.js'
import { kahanSum, neumaierSum, pairwiseSum, sum } from './ladder.js'
import { referenceSum } from './reference.js'

let seed = 0x9e3779b9
const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
}

const F64 = new Float64Array(1)
const U64 = new BigUint64Array(F64.buffer)
const ordinal = (x: number): bigint => {
    F64[0] = x
    const u = U64[0]
    return u < 1n << 63n ? u : (1n << 63n) - u
}
const ulpsFrom = (approx: number, exact: number): bigint => {
    const d = ordinal(approx) - ordinal(exact)
    return d < 0n ? -d : d
}

const time = (label: string, fn: () => number, iters: number): number => {
    for (let i = 0; i < 200; i++) fn() // warmup
    const t0 = performance.now()
    let acc = 0
    for (let i = 0; i < iters; i++) acc += fn()
    const dt = performance.now() - t0
    // eslint-disable-next-line no-console
    console.info(`  ${label.padEnd(22)} ${((dt / iters) * 1e6).toFixed(0).padStart(8)} ns/op`)
    return acc
}

describe.skipIf(!process.env.BENCH)('exact-sum receipts', () => {
    const N = 2048
    const f64 = Float64Array.from({ length: N }, () => rand())
    const arr = Array.from(f64)

    it(`speed: Float64Array(${N}), uniform [0,1)`, () => {
        const iters = 3000
        time('naive sum', () => sum(f64), iters)
        time('pairwiseSum(16)', () => pairwiseSum(f64, 16), iters)
        time('pairwiseSum(128)', () => pairwiseSum(f64, 128), iters)
        time('kahanSum', () => kahanSum(f64), iters)
        time('neumaierSum', () => neumaierSum(f64), iters)
        time('fsum', () => fsum(f64), iters)
        time('d3-array fsum', () => d3Fsum(f64) as number, iters)
        expect(time('referenceSum (oracle)', () => referenceSum(f64), 50)).toBeGreaterThan(0)
    })

    it(`speed: number[](${N}), uniform [0,1)`, () => {
        const iters = 3000
        time('naive sum', () => sum(arr), iters)
        time('pairwiseSum(16)', () => pairwiseSum(arr, 16), iters)
        time('pairwiseSum(128)', () => pairwiseSum(arr, 128), iters)
        time('kahanSum', () => kahanSum(arr), iters)
        time('neumaierSum', () => neumaierSum(arr), iters)
        time('fsum', () => fsum(arr), iters)
        expect(time('d3-array fsum', () => d3Fsum(arr) as number, iters)).toBeGreaterThan(0)
    })

    it('accuracy: ulps from the exact sum, three conditioning regimes', () => {
        const regimes: [string, number[]][] = [
            ['well-conditioned (all +, n=10k)', Array.from({ length: 10_000 }, () => rand())],
            [
                'exponent spread 2^±40 (n=2048)',
                Array.from(
                    { length: 2048 },
                    () => (rand() * 2 - 1) * 2 ** Math.floor(rand() * 80 - 40)
                ),
            ],
            [
                'massive cancellation (n=2048)',
                (() => {
                    const xs: number[] = []
                    for (let i = 0; i < 1023; i++) {
                        const x = (rand() * 2 - 1) * 2 ** Math.floor(rand() * 60 - 30)
                        xs.push(x, -x)
                    }
                    xs.push(1e-30, 2 ** -40)
                    for (let i = xs.length - 1; i > 0; i--) {
                        const j = (rand() * (i + 1)) | 0
                        const t = xs[i]
                        xs[i] = xs[j]
                        xs[j] = t
                    }
                    return xs
                })(),
            ],
        ]
        for (const [name, v] of regimes) {
            const exact = referenceSum(v)
            // eslint-disable-next-line no-console
            console.info(`  ${name}  (exact = ${exact})`)
            const rows: [string, number][] = [
                ['naive sum', sum(v)],
                ['pairwiseSum(16)', pairwiseSum(v, 16)],
                ['pairwiseSum(128)', pairwiseSum(v, 128)],
                ['kahanSum', kahanSum(v)],
                ['neumaierSum', neumaierSum(v)],
                ['fsum', fsum(v)],
                ['d3-array fsum', d3Fsum(v) as number],
            ]
            for (const [label, got] of rows) {
                // eslint-disable-next-line no-console
                console.info(`    ${label.padEnd(20)} ${ulpsFrom(got, exact)} ulps`)
            }
            expect(fsum(v)).toBe(exact)
        }
    })
})
