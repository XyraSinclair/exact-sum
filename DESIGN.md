# exact-sum — design

## Contract

All public reducers accept `readonly number[] | Float64Array`, do not mutate
their input, and return a binary64 number. The four primary reducers differ
only in how much rounding information they retain:

| algorithm | time | auxiliary space | forward error, finite inputs |
|---|---:|---:|---:|
| `sum` | O(n) | O(1) | γₙ₋₁ Σ|xᵢ| = O(nu) Σ|xᵢ| |
| `pairwiseSum` | O(n) | O(log n) stack | O(log n·u) Σ|xᵢ| |
| `neumaierSum` | O(n) | O(1) | O(u) Σ|xᵢ| + O(nu²) |
| `exactSum` | O(np) normally | O(p) | correctly rounded (0 ULP) |

Here `u = 2⁻⁵³`, `γₖ = ku/(1-ku)`, and `p` is the live expansion
length. `p` is normally small and bounded by the exponent structure of the
data, rather than by n.

## Error-free transforms

Knuth's 2Sum decomposes one rounded addition into two binary64 values:

```text
s = fl(a + b)
a + b = s + e                 exactly over the reals
```

It works without a magnitude precondition for finite inputs provided `a + b`
does not overflow. Dekker's Fast2Sum uses three operations instead of six but
requires `|a| >= |b|`. The public `fast2Sum` leaves that precondition with the
caller so its fast path has no comparison or swap.

Both identities are tested by asking the independent BigInt oracle to sum
`[a, b, -s, -e]`; floating-point recombination would not be a valid proof.

## The approximate rungs

`sum` is the language's ordinary left-to-right reduction. Its error can grow
linearly because each new rounding acts on all earlier accumulated error.

`pairwiseSum` recursively bisects the input and combines the two results.
Every value crosses only O(log n) rounded additions. Leaves contain at most
eight sequential additions, a fixed contribution to the bound. Recursion
depth is logarithmic—about 17 frames for one million inputs and below 50 for
any addressable JavaScript array—so the original priorsio implementation's
large-array stack fallback is unnecessary.

`neumaierSum` keeps a second accumulator. After `t = fl(sum + x)`, it computes
the lost low part from whichever operand had greater magnitude:

```text
|sum| >= |x|  ?  (sum - t) + x  :  (x - t) + sum
```

That comparison is the material difference from plain Kahan. In
`[1, 1e100, 1, -1e100]`, Kahan loses its correction when the next operand is
larger; Neumaier retains both unit terms and returns 2.

`cumulativeSum` exposes the same Neumaier state after each input. A prefix can
still round away its compensation (there may be no representable closer
number), but the compensation remains available for later cancellation.

## Correctly rounded summation

`exactSum` is a clean implementation of grow-expansion arithmetic from
Jonathan Richard Shewchuk, [*Adaptive Precision Floating-Point Arithmetic and
Fast Robust Geometric Predicates*](https://www.cs.cmu.edu/~quake-papers/robust-arithmetic.ps),
Discrete & Computational Geometry 18(3), 1997.

The live `partials` array is a nonoverlapping floating-point expansion. To add
an input x, the implementation folds x through every partial with 2Sum. Each
step emits the exact low residual and passes the rounded high component onward.
Zero residuals are discarded. Inductively, the real sum of the expansion is
exactly the real sum of every input processed so far; no rounding information
has been discarded.

To collapse the expansion, components are combined from greatest to least
magnitude until the first nonzero residual. Nonoverlap means the remaining
tail cannot cross more than one rounding boundary. If the residual is exactly
half an ULP and the still-lower tail has the same sign, one exact two-residual
step moves to the adjacent representable number. Otherwise the already-rounded
high component is the round-to-nearest, ties-to-even result.

### Overflow fallback

Expansion transforms require finite intermediate additions. Finite inputs can
still overflow a prefix even when later cancellation makes the true total
finite. On that rare path, `exactSum` decodes every input directly from its
binary64 bit pattern as `coefficient × 2^exponent`, accumulates one exact BigInt
at a common exponent, then rounds once to binary64. This keeps the public
correct-rounding contract total for finite inputs. It is deliberately a
fallback: ordinary calls retain the much faster expansion implementation.

## IEEE special values and zero

NaN poisons every reducer. A single infinity sign wins; both signs produce
NaN. The compensated routines switch to ordinary IEEE propagation as soon as
a non-finite running result appears, avoiding `Infinity - Infinity` inside a
compensation formula.

Empty sums return `+0`. Exact cancellation returns `+0`. `exactSum([-0])`
retains `-0`, matching the one-element IEEE result, but zero-sign preservation
is not a numerical guarantee for the approximate tree or compensated rungs.

## Verification architecture

The test oracle is independent of expansion arithmetic:

1. Decode sign, exponent, and significand from every binary64 bit pattern.
2. Accumulate exact signed integers at a shared power-of-two exponent.
3. Round the one exact integer once, including subnormal and overflow
   boundaries, using ties-to-even.

The suite covers named cancellation failures, midpoint rounding, denormals,
finite overflow followed by cancellation, and seeded arrays with mixed signs
and exponents at n = 2, 4, …, 2²⁰. Every primary algorithm's error is measured
against the oracle. The approximate rungs are checked against their empirical
forward bounds; `exactSum` is required to be bit-identical and permutation
invariant. The benchmark uses the same oracle for its accuracy table and
`cyclebench` for interleaved speed measurements.

## Honest limits

- Correct rounding is slower and allocates an expansion. The rare overflow
  fallback allocates BigInts and is much slower again.
- Pairwise and compensated sums are not permutation invariant and do not
  promise correctly rounded answers.
- ULP error after severe cancellation can be enormous even when absolute
  error satisfies the stated forward bound.
- JavaScript engines may change the relative performance of the rungs; the
  checked-in tables are receipts for one stated machine/runtime, not eternal
  rankings.
