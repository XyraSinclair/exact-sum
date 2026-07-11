/**
 * `fsum` — exact summation. Returns the double nearest to the *true real
 * sum* of the inputs (round-to-nearest, ties-to-even), like Python's
 * `math.fsum`.
 *
 * Method: Shewchuk's nonoverlapping-expansion arithmetic. The running sum is
 * held as a list of "partials" — doubles of strictly increasing magnitude
 * whose exact real sum IS the sum so far, maintained with the Fast2Sum
 * error-free transformation. No information is ever discarded until the
 * single correctly-rounded result is extracted at the end. Cost: O(n) with a
 * small partials list in practice (its length is bounded by the exponent
 * range in the data, not by n). Proofs and invariants in DESIGN.md §5.
 */

/**
 * Sum `xs` exactly, correctly rounded to the nearest double.
 *
 * Non-finite semantics (IEEE-consistent): any NaN → NaN; +∞ and −∞ both
 * present → NaN; ±∞ of a single sign → that infinity.
 *
 * @throws RangeError when all inputs are finite but a running partial
 * overflows (the exact prefix sum strays past ±2¹⁰²⁴ — same contract as
 * CPython's `math.fsum`). `referenceSum` handles even that case exactly.
 */
export function fsum(xs: ArrayLike<number>): number {
    const partials: number[] = []
    const len = xs.length

    for (let i = 0; i < len; i++) {
        let x = xs[i]
        if (!Number.isFinite(x)) return nonFiniteVerdict(xs)

        // Fold x into the expansion: each existing partial is combined with
        // the incoming value via Fast2Sum (swap enforces |x| >= |y|); the
        // rounded sum keeps climbing, the exact residues are kept as the new
        // low-order partials. Zero residues are dropped — that is what keeps
        // the list short.
        let n = 0
        const count = partials.length
        for (let j = 0; j < count; j++) {
            let y = partials[j]
            if (Math.abs(x) < Math.abs(y)) {
                const t = x
                x = y
                y = t
            }
            const hi = x + y
            const lo = y - (hi - x)
            if (lo !== 0) partials[n++] = lo
            x = hi
        }
        if (!Number.isFinite(x)) {
            throw new RangeError(
                'exact-sum: intermediate overflow in fsum (a running partial passed ±2^1024); referenceSum handles this exactly'
            )
        }
        partials.length = n
        partials.push(x)
    }

    // Extract the correctly-rounded total from the expansion. Partials are
    // nonoverlapping and increasing in magnitude, so summing from the top
    // is exact until the first nonzero residue `lo`; at that point `lo` is
    // less than half an ulp of `hi` — except in the exact-tie case, where
    // the sign of the next partial down decides the ties-to-even direction.
    let n = partials.length
    if (n === 0) return 0
    let hi = partials[--n]
    let lo = 0
    while (n > 0) {
        const x = hi
        const y = partials[--n]
        hi = x + y
        lo = y - (hi - x)
        if (lo !== 0) break
    }
    if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
        // lo was exactly half an ulp and the tail pushes past the midpoint:
        // move to the neighbor iff that step is itself exact.
        const y = lo * 2
        const x = hi + y
        if (y === x - hi) hi = x
    }
    return hi
}

function nonFiniteVerdict(xs: ArrayLike<number>): number {
    let posInf = false
    let negInf = false
    const len = xs.length
    for (let i = 0; i < len; i++) {
        const x = xs[i]
        if (Number.isNaN(x)) return NaN
        if (x === Infinity) posInf = true
        else if (x === -Infinity) negInf = true
    }
    if (posInf && negInf) return NaN
    return posInf ? Infinity : -Infinity
}
