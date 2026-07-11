import { compare } from 'cyclebench'
// @ts-expect-error d3-array does not expose declarations to this TS configuration.
import { fsum as d3Fsum } from 'd3-array'
// @ts-expect-error kahan@0.0.3 predates TypeScript declarations.
import kahanPackage from 'kahan'
import { describe, expect, it } from 'vitest'

import { exactSum, neumaierSum, pairwiseSum, sum, type Summable } from './index.js'
import { oracleSum, ulp } from './testKit.js'

const random = (() => {
    let state = 0x243f6a88
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 2 ** 32
    }
})()

function randomArray(length: number): Float64Array {
    return Float64Array.from({ length }, () => (random() * 2 - 1) * 2 ** (random() * 40 - 20))
}

function cancellationArray(): Float64Array {
    const values: number[] = []
    for (let i = 0; i < 1365; i++) values.push(1e16, 1, -1e16)
    values.push(1)
    return Float64Array.from(values)
}

const candidates = {
    sum: (xs: Summable) => sum(xs),
    pairwiseSum: (xs: Summable) => pairwiseSum(xs),
    neumaierSum: (xs: Summable) => neumaierSum(xs),
    exactSum: (xs: Summable) => exactSum(xs),
    'd3-array fsum': (xs: Summable) => d3Fsum(xs) as number,
    'kahan@0.0.3': (xs: Summable) => kahanPackage.sum(xs),
}

const workloads: [label: string, values: Float64Array][] = [
    ['f64×1k', randomArray(1_000)],
    ['f64×100k', randomArray(100_000)],
    ['f64×1M', randomArray(1_000_000)],
    ['cancellation', cancellationArray()],
]

function formatRate(value: number): string {
    if (value >= 100) return value.toFixed(0)
    if (value >= 10) return value.toFixed(1)
    if (value >= 1) return value.toFixed(2)
    return value.toFixed(3)
}

function formatUlps(value: number): string {
    if (value === 0) return '0'
    if (!Number.isFinite(value)) return '∞'
    if (value < 1e6) return Math.ceil(value).toLocaleString('en-US')
    return value.toExponential(2)
}

describe.skipIf(!process.env.BENCH)('receipts', () => {
    it('prints calls/ms and maximum ULP error tables', async () => {
        const rates = new Map<string, number[]>()
        for (const name of Object.keys(candidates)) rates.set(name, [])

        for (const [, values] of workloads) {
            const report = await compare({
                candidates,
                inputs: [[values]],
                agree: false,
                timeMs: 350,
                warmupMs: 80,
            })
            expect(report.ok).toBe(true)
            for (const result of report.candidates) {
                rates.get(result.name)?.push(result.opsPerSec / 1000)
            }
        }

        const header = ['algorithm', ...workloads.map(([name]) => name)]
        const speedRows = Object.keys(candidates).map((name) => [
            name,
            ...(rates.get(name) ?? []).map(formatRate),
        ])

        const accuracyRows = Object.entries(candidates).map(([name, fn]) => {
            const errors = workloads.map(([, values]) => {
                const exact = oracleSum(values)
                return Math.abs(fn(values) - exact) / ulp(exact)
            })
            return [name, ...errors.map(formatUlps)]
        })

        // eslint-disable-next-line no-console
        console.info('\nCALLS/MS\n' + markdownTable(header, speedRows))
        // eslint-disable-next-line no-console
        console.info('\nMAX ULP ERROR\n' + markdownTable(header, accuracyRows))

        expect(accuracyRows.find(([name]) => name === 'exactSum')?.slice(1)).toEqual([
            '0',
            '0',
            '0',
            '0',
        ])
    }, 60_000)
})

function markdownTable(header: string[], rows: string[][]): string {
    return [
        `| ${header.join(' | ')} |`,
        `|${header.map(() => '---').join('|')}|`,
        ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n')
}
