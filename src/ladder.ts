/**
 * The accuracy ladder: four ways to sum an array, each buying more accuracy
 * for more work. With u = 2⁻⁵³ (unit roundoff) and S = Σ|xᵢ|:
 *
 *   | rung           | worst-case error   | cost per element        |
 *   |----------------|--------------------|-------------------------|
 *   | `sum`          | O(n·u)·S           | 1 add                   |
 *   | `pairwiseSum`  | O(log n·u)·S       | 1 add (+ tiny overhead) |
 *   | `kahanSum`     | O(u)·S (usually)   | 4 flops                 |
 *   | `neumaierSum`  | O(u)·S (robust)    | 7 flops + 1 branch      |
 *
 * The rung above all of these — `fsum`, exact to the last bit — lives in
 * fsum.ts. Error analyses and the Kahan-vs-Neumaier distinction are proved
 * in DESIGN.md §3–4.
 */

/** Plain left-to-right summation. The fastest rung and the error baseline. */
export function sum(xs: ArrayLike<number>): number {
    let s = 0
    const len = xs.length
    for (let i = 0; i < len; i++) s += xs[i]
    return s
}

/**
 * Pairwise (cascade) summation: recursively halve, sum the halves, add.
 * Error grows O(log n) instead of O(n) — and it is *faster* than the naive
 * loop, because the base case runs eight independent accumulators, breaking
 * the serial add dependency chain (see the receipts in README). Recursion
 * depth is ⌈log₂(n / blockSize)⌉ ≤ 46, so no stack guard is needed at any
 * array length.
 */
export function pairwiseSum(xs: ArrayLike<number>, blockSize = 128): number {
    if (blockSize < 2) throw new RangeError('exact-sum: blockSize must be >= 2')
    return pairwise(xs, 0, xs.length, blockSize)
}

function pairwise(xs: ArrayLike<number>, lo: number, hi: number, block: number): number {
    const n = hi - lo
    if (n <= block) {
        // Eight independent accumulators: an in-block pairwise tree that cuts
        // the base-case error term ~8x AND breaks the serial add dependency
        // chain, so the block runs at full ILP — faster than a naive loop.
        let s0 = 0
        let s1 = 0
        let s2 = 0
        let s3 = 0
        let s4 = 0
        let s5 = 0
        let s6 = 0
        let s7 = 0
        let i = lo
        const cut = lo + (n & ~7)
        for (; i < cut; i += 8) {
            s0 += xs[i]
            s1 += xs[i + 1]
            s2 += xs[i + 2]
            s3 += xs[i + 3]
            s4 += xs[i + 4]
            s5 += xs[i + 5]
            s6 += xs[i + 6]
            s7 += xs[i + 7]
        }
        let s = (s0 + s1) + (s2 + s3) + ((s4 + s5) + (s6 + s7))
        for (; i < hi; i++) s += xs[i]
        return s
    }
    const mid = lo + (n >> 1)
    return pairwise(xs, lo, mid, block) + pairwise(xs, mid, hi, block)
}

/**
 * Kahan's compensated summation: carries the running rounding error in a
 * second accumulator. Error is O(u)·Σ|xᵢ| — independent of n — **except**
 * when an addend exceeds the running sum in magnitude, where the correction
 * itself gets truncated: `kahanSum([1, 1e100, 1, -1e100])` is 0, not 2.
 * That failure is exactly what `neumaierSum` repairs.
 */
export function kahanSum(xs: ArrayLike<number>): number {
    let s = 0
    let c = 0
    const len = xs.length
    for (let i = 0; i < len; i++) {
        const y = xs[i] - c
        const t = s + y
        c = t - s - y
        s = t
    }
    return s
}

/**
 * Neumaier's improved compensated summation (Kahan–Babuška): compares
 * magnitudes so the compensation term is computed from whichever operand
 * survived the rounding. Handles the addend-larger-than-sum case Kahan
 * drops: `neumaierSum([1, 1e100, 1, -1e100])` is 2. The best
 * constant-memory rung; when even O(u)·Σ|xᵢ| is too much error, use `fsum`.
 */
export function neumaierSum(xs: ArrayLike<number>): number {
    let s = 0
    let c = 0
    const len = xs.length
    for (let i = 0; i < len; i++) {
        const x = xs[i]
        const t = s + x
        c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s
        s = t
    }
    return s + c
}
