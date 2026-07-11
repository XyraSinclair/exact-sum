import type { Summable } from './ladder.js'

/**
 * Correctly round the exact real sum of `xs` to binary64.
 *
 * The ordinary path is Shewchuk grow-expansion arithmetic: `partials` is a
 * nonoverlapping expansion whose exact real value equals every input seen so
 * far. A rare BigInt fallback handles finite intermediate overflow, including
 * huge cancellation where the final answer is finite.
 */
export function exactSum(xs: Summable): number {
    const partials: number[] = []
    let count = 0

    for (let i = 0; i < xs.length; i++) {
        let x = xs[i]
        if (!Number.isFinite(x)) return nonFiniteSum(xs)

        let nextCount = 0
        for (let j = 0; j < count; j++) {
            const y = partials[j]
            const hi = x + y
            if (!Number.isFinite(hi)) return finiteFallback(xs)

            // Knuth 2Sum, written inline: hi + lo is exactly x + y.
            const virtualY = hi - x
            const lo = x - (hi - virtualY) + (y - virtualY)
            if (lo !== 0) partials[nextCount++] = lo
            x = hi
        }
        partials[nextCount] = x
        count = nextCount + 1
    }

    if (count === 0) return 0
    let hi = partials[--count]
    let lo = 0
    while (count > 0) {
        const x = hi
        const y = partials[--count]
        hi = x + y
        lo = y - (hi - x)
        if (lo !== 0) break
    }

    // If the remaining tail has the same sign as the rounding residual, it
    // can push an exact halfway case to the adjacent representable number.
    if (
        count > 0 &&
        ((lo < 0 && partials[count - 1] < 0) || (lo > 0 && partials[count - 1] > 0))
    ) {
        const twiceLo = lo * 2
        const rounded = hi + twiceLo
        if (twiceLo === rounded - hi) hi = rounded
    }
    return hi
}

function nonFiniteSum(xs: Summable): number {
    let positiveInfinity = false
    let negativeInfinity = false
    for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        // Non-numbers (holes, undefined — outside the TS contract) behave
        // like the NaN that `+` would have produced, never a fabricated
        // infinity.
        if (typeof x !== 'number' || Number.isNaN(x)) return NaN
        if (x === Infinity) positiveInfinity = true
        else if (x === -Infinity) negativeInfinity = true
    }
    if (positiveInfinity && negativeInfinity) return NaN
    return positiveInfinity ? Infinity : -Infinity
}

/** Exact binary rational accumulation, used only when expansion arithmetic overflows. */
function finiteFallback(xs: Summable): number {
    // The main loop's per-element finiteness check only vetted elements it
    // had already consumed when the overflow tripped — a NaN or Infinity
    // LATER in the array would otherwise be decoded as a finite
    // exponent-2047 bit pattern.
    for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(xs[i])) return nonFiniteSum(xs)
    }

    let integer = 0n
    let exponent = 0

    for (let i = 0; i < xs.length; i++) {
        const [coefficient, power] = decompose(xs[i])
        if (coefficient === 0n) continue
        if (integer === 0n) {
            integer = coefficient
            exponent = power
        } else if (power < exponent) {
            integer = (integer << BigInt(exponent - power)) + coefficient
            exponent = power
        } else {
            integer += coefficient << BigInt(power - exponent)
        }
    }
    return roundBinary(integer, exponent)
}

const bitsBuffer = new ArrayBuffer(8)
const bitsFloat = new Float64Array(bitsBuffer)
const bitsUint = new BigUint64Array(bitsBuffer)
const FRACTION_MASK = (1n << 52n) - 1n

/** Return x exactly as coefficient * 2^power. */
function decompose(x: number): [bigint, number] {
    bitsFloat[0] = x
    const bits = bitsUint[0]
    const negative = (bits >> 63n) !== 0n
    const encodedExponent = Number((bits >> 52n) & 0x7ffn)
    const fraction = bits & FRACTION_MASK
    if (encodedExponent === 0 && fraction === 0n) return [0n, -1074]
    const coefficient = encodedExponent === 0 ? fraction : fraction | (1n << 52n)
    const signed = negative ? -coefficient : coefficient
    return [signed, encodedExponent === 0 ? -1074 : encodedExponent - 1075]
}

/** Round integer * 2^exponent once, to nearest binary64, ties to even. */
function roundBinary(integer: bigint, exponent: number): number {
    if (integer === 0n) return 0
    const negative = integer < 0n
    let magnitude = negative ? -integer : integer
    const bitLength = magnitude.toString(2).length
    const topExponent = bitLength - 1 + exponent
    const targetPower = Math.max(topExponent - 52, -1074)
    const discarded = targetPower - exponent

    if (discarded > 0) {
        const shift = BigInt(discarded)
        const kept = magnitude >> shift
        const remainder = magnitude - (kept << shift)
        const halfway = 1n << (shift - 1n)
        magnitude =
            remainder > halfway || (remainder === halfway && (kept & 1n) !== 0n)
                ? kept + 1n
                : kept
    } else if (discarded < 0) {
        magnitude <<= BigInt(-discarded)
    }

    const value = scaleByPowerOfTwo(Number(magnitude), targetPower)
    return negative ? -value : value
}

function scaleByPowerOfTwo(value: number, power: number): number {
    while (power > 1000) {
        value *= 2 ** 1000
        power -= 1000
    }
    while (power < -1000) {
        value *= 2 ** -1000
        power += 1000
    }
    return value * 2 ** power
}
