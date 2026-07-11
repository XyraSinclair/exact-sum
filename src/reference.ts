/**
 * `referenceSum` — the oracle. Sums exactly in BigInt rational arithmetic
 * (every finite double is m·2^e for integers m, e), then rounds the exact
 * rational once, to nearest, ties-to-even. No floating-point operation
 * touches the accumulation, so there is nothing to get wrong except the
 * final rounding — which is implemented directly from the IEEE 754
 * definition below and tested against `fsum` and hand-built edge cases.
 *
 * Slow (BigInt), but total: it even returns the correct ±Infinity when the
 * exact sum overflows — the one case `fsum` refuses (RangeError). The test
 * suite asserts `fsum` ≡ `referenceSum` everywhere `fsum` doesn't throw.
 */

/** Exact BigInt-rational summation, correctly rounded. Same non-finite semantics as `fsum`. */
export function referenceSum(xs: ArrayLike<number>): number {
    const len = xs.length
    // value so far = num / 2^shift
    let num = 0n
    let shift = 0
    let posInf = false
    let negInf = false
    let nan = false
    let allNegZero = len > 0

    for (let i = 0; i < len; i++) {
        const x = xs[i]
        if (!Number.isFinite(x)) {
            if (Number.isNaN(x)) nan = true
            else if (x === Infinity) posInf = true
            else negInf = true
            allNegZero = false
            continue
        }
        if (!Object.is(x, -0)) allNegZero = false
        if (x === 0) continue
        // Scale x up by powers of two (exact) until it is an integer.
        let m = x
        let e = 0
        while (!Number.isInteger(m)) {
            m *= 2
            e++
        }
        if (e > shift) {
            num <<= BigInt(e - shift)
            shift = e
        }
        num += BigInt(m) << BigInt(shift - e)
    }

    if (nan || (posInf && negInf)) return NaN
    if (posInf) return Infinity
    if (negInf) return -Infinity
    // IEEE round-to-nearest: a sum of −0s is −0; any other exact zero is +0.
    if (num === 0n) return allNegZero ? -0 : 0
    return roundRational(num, shift)
}

/**
 * Round num / 2^shift (num ≠ 0) to the nearest double, ties to even —
 * straight from the IEEE 754 definition: pick the representable value
 * m·2^t whose ulp matches the result's binade (or 2⁻¹⁰⁷⁴ in the subnormal
 * range), rounding num's discarded low bits half-to-even into m.
 */
function roundRational(num: bigint, shift: number): number {
    const neg = num < 0n
    let a = neg ? -num : num
    const nbits = a.toString(2).length
    // The value lies in [2^(e2-1), 2^e2).
    const e2 = nbits - shift

    // How many low bits of `a` fall below the result's ulp.
    const drop = e2 - 1 >= -1022 ? nbits - 53 : shift - 1074

    let m: bigint
    if (drop <= 0) {
        m = a << BigInt(-drop) // exactly representable; no rounding
    } else {
        const d = BigInt(drop)
        m = a >> d
        const rem = a & ((1n << d) - 1n)
        const half = 1n << (d - 1n)
        if (rem > half || (rem === half && (m & 1n) === 1n)) m += 1n
    }

    const val = ldexp(Number(m), drop - shift)
    return neg ? -val : val
}

/**
 * m·2^e with exact two-step scaling. `m` here is an integer ≤ 2^53 whose
 * final scaled value is representable by construction, so every multiply
 * below is exact — intermediate steps stay in the normal range, and the
 * last step lands on the (possibly subnormal, possibly ±Infinity) target.
 */
function ldexp(m: number, e: number): number {
    while (e > 1000) {
        m *= 2 ** 1000
        e -= 1000
    }
    while (e < -1000) {
        m *= 2 ** -1000
        e += 1000
    }
    return m * 2 ** e
}
