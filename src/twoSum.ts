/**
 * Error-free transformations (EFTs) — the primitives everything above them
 * is built from. For any two finite doubles `a`, `b`:
 *
 *     a + b  ===  s + e     (exactly, as real numbers)
 *
 * where `s = fl(a + b)` is the ordinary rounded sum and `e` is the rounding
 * error, itself always exactly representable as a double. See DESIGN.md §2.
 */

/**
 * Knuth's 2Sum: 6 flops, no branch, no precondition.
 * Returns `[s, e]` with `s = fl(a + b)` and `a + b === s + e` exactly.
 */
export function twoSum(a: number, b: number): [sum: number, err: number] {
    const s = a + b
    const a1 = s - b
    const b1 = s - a1
    return [s, a - a1 + (b - b1)]
}

/**
 * Dekker's Fast2Sum: 3 flops, but requires `|a| >= |b|` (or a, b share an
 * exponent relation that makes `s - a` exact). Swaps internally when the
 * precondition fails, so it is always correct — pass ordered operands to
 * get the fast path.
 */
export function fast2Sum(a: number, b: number): [sum: number, err: number] {
    if (Math.abs(a) < Math.abs(b)) {
        const t = a
        a = b
        b = t
    }
    const s = a + b
    return [s, b - (s - a)]
}
