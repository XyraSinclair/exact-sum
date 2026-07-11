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
 * Error grows O(log n) instead of O(n), at nearly naive speed — blocks of
 * `blockSize` at the bottom are summed naively so the recursion overhead
 * amortizes away. Recursion depth is ⌈log₂(n / blockSize)⌉ ≤ 46, so no
 * stack guard is needed at any array length.
 */
export function pairwiseSum(xs: ArrayLike<number>, blockSize = 16): number {
    if (blockSize < 2) throw new RangeError('exact-sum: blockSize must be >= 2')
    return pairwise(xs, 0, xs.length, blockSize)
}

function pairwise(xs: ArrayLike<number>, lo: number, hi: number, block: number): number {
    const n = hi - lo
    if (n <= block) {
        let s = 0
        for (let i = lo; i < hi; i++) s += xs[i]
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
