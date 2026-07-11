export type Summable = readonly number[] | Float64Array

/** Plain left-to-right summation: one addition per element. */
export function sum(xs: Summable): number {
    let total = 0
    for (let i = 0; i < xs.length; i++) total += xs[i]
    return total
}

/**
 * Pairwise (cascade) summation. Adjacent blocks are summed and then combined
 * as a balanced binary tree, reducing worst-case error growth from O(nu) to
 * O(log(n)u). The recursion is stack-safe: its depth is logarithmic (17
 * frames for one million inputs, and at most 50 for any possible JS array).
 */
export function pairwiseSum(xs: Summable): number {
    return pairwise(xs, 0, xs.length)
}

const LEAF_SIZE = 8

function pairwise(xs: Summable, start: number, end: number): number {
    const length = end - start
    if (length <= LEAF_SIZE) {
        let total = 0
        for (let i = start; i < end; i++) total += xs[i]
        return total
    }
    const middle = start + Math.floor(length / 2)
    return pairwise(xs, start, middle) + pairwise(xs, middle, end)
}

/**
 * Neumaier's improved Kahan–Babuška summation. Unlike plain Kahan, it
 * retains the low-order term when the next addend is larger than the running
 * sum: `neumaierSum([1, 1e100, 1, -1e100]) === 2`.
 */
export function neumaierSum(xs: Summable): number {
    let total = 0
    let compensation = 0

    for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const next = total + x
        if (!Number.isFinite(next)) return finishNonFinite(xs, i, total + compensation)
        compensation +=
            Math.abs(total) >= Math.abs(x) ? total - next + x : x - next + total
        total = next
    }
    return total + compensation
}

/** Running prefix sums using Neumaier compensation. */
export function cumulativeSum(xs: Summable): number[] {
    const result = new Array<number>(xs.length)
    let total = 0
    let compensation = 0

    for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        const next = total + x
        if (!Number.isFinite(next)) {
            let ieeeTotal = total + compensation
            for (let j = i; j < xs.length; j++) {
                ieeeTotal += xs[j]
                result[j] = ieeeTotal
            }
            return result
        }
        compensation +=
            Math.abs(total) >= Math.abs(x) ? total - next + x : x - next + total
        total = next
        result[i] = total + compensation
    }
    return result
}

function finishNonFinite(xs: Summable, at: number, finitePrefix: number): number {
    let total = finitePrefix
    for (let i = at; i < xs.length; i++) total += xs[i]
    return total
}
