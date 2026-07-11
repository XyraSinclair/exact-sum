/* Test-only exact rational oracle. This implementation shares no summation
 * code with exactSum: it decodes every binary64 into k * 2^e, accumulates one
 * BigInt at a common exponent, then performs IEEE ties-to-even rounding. */

const buffer = new ArrayBuffer(8)
const f64 = new Float64Array(buffer)
const u64 = new BigUint64Array(buffer)
const fractionMask = (1n << 52n) - 1n

export function oracleSum(xs: ArrayLike<number>): number {
    let integer = 0n
    let exponent = 0
    let positiveInfinity = false
    let negativeInfinity = false
    let allNegativeZero = xs.length > 0

    for (let i = 0; i < xs.length; i++) {
        const x = xs[i]
        if (Number.isNaN(x)) return NaN
        if (x === Infinity) {
            positiveInfinity = true
            allNegativeZero = false
            continue
        }
        if (x === -Infinity) {
            negativeInfinity = true
            allNegativeZero = false
            continue
        }
        if (!Object.is(x, -0)) allNegativeZero = false

        const [coefficient, power] = parts(x)
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

    if (positiveInfinity && negativeInfinity) return NaN
    if (positiveInfinity) return Infinity
    if (negativeInfinity) return -Infinity
    if (integer === 0n) return allNegativeZero ? -0 : 0
    return round(integer, exponent)
}

function parts(x: number): [bigint, number] {
    f64[0] = x
    const bits = u64[0]
    const encodedExponent = Number((bits >> 52n) & 0x7ffn)
    const fraction = bits & fractionMask
    if (encodedExponent === 0 && fraction === 0n) return [0n, -1074]
    let coefficient = encodedExponent === 0 ? fraction : fraction | (1n << 52n)
    if ((bits >> 63n) !== 0n) coefficient = -coefficient
    return [coefficient, encodedExponent === 0 ? -1074 : encodedExponent - 1075]
}

function round(integer: bigint, exponent: number): number {
    const negative = integer < 0n
    let magnitude = negative ? -integer : integer
    const bitLength = magnitude.toString(2).length
    const topExponent = bitLength - 1 + exponent
    const unitExponent = Math.max(topExponent - 52, -1074)
    const drop = unitExponent - exponent

    if (drop > 0) {
        const shift = BigInt(drop)
        const kept = magnitude >> shift
        const remainder = magnitude - (kept << shift)
        const half = 1n << (shift - 1n)
        magnitude =
            remainder > half || (remainder === half && (kept & 1n) !== 0n)
                ? kept + 1n
                : kept
    } else if (drop < 0) {
        magnitude <<= BigInt(-drop)
    }

    let value = Number(magnitude)
    let power = unitExponent
    while (power > 1000) {
        value *= 2 ** 1000
        power -= 1000
    }
    while (power < -1000) {
        value *= 2 ** -1000
        power += 1000
    }
    value *= 2 ** power
    return negative ? -value : value
}

export function ulpsBetween(a: number, b: number): bigint {
    const difference = ordinal(a) - ordinal(b)
    return difference < 0n ? -difference : difference
}

function ordinal(x: number): bigint {
    f64[0] = x
    const bits = u64[0]
    return bits < 1n << 63n ? bits : (1n << 63n) - bits
}

export function ulp(x: number): number {
    const absolute = Math.abs(x)
    if (absolute < 2 ** -1022) return Number.MIN_VALUE
    return 2 ** (Math.floor(Math.log2(absolute)) - 52)
}
