# exact-sum

Floating-point summation as a ladder: one contract, four deliberate points on
the speed/accuracy curve.

```ts
import { exactSum, neumaierSum, pairwiseSum, sum } from 'exact-sum'

sum(xs)          // fastest; error grows with n
pairwiseSum(xs)  // balanced tree; error grows with log n
neumaierSum(xs)  // compensated; error is essentially independent of n
exactSum(xs)     // correctly rounded; the accuracy ceiling

sum([1, 1e100, 1, -1e100]) === 0
neumaierSum([1, 1e100, 1, -1e100]) === 2
```

Zero runtime dependencies. ESM and TypeScript declarations are included.

## Why this exists

JavaScript has good individual summation implementations, but no small package
that presents the useful algorithms as a choice and publishes accuracy and
speed receipts together.

| incumbent | state of the world |
|---|---|
| `kahan@0.0.3` | Kahan only; last published in 2014; its dependency tries to compile obsolete jscoverage during install |
| `math-sum` | the ordinary naive loop |
| `d3-array` `fsum` | excellent correctly rounded summation, but it is one utility inside the larger d3-array package |
| `@stdlib/blas-ext-base-gsumkbn` | a sound compensated implementation inside stdlib's dtype-specific hierarchy |
| **exact-sum** | the whole ladder, zero runtime dependencies, one input contract, oracle-backed receipts |

Measured on Node 24.13.1, Apple Silicon, 2026-07-11. Run `npm run bench` to
reproduce. `cyclebench` interleaves candidates to reduce machine drift; result
agreement is deliberately disabled because the low bits are the subject of the
benchmark.

Calls per millisecond (higher is better):

| algorithm | f64×1k | f64×100k | f64×1M | cancellation |
|---|---:|---:|---:|---:|
| `sum` | 1,637 | 15.9 | 1.58 | 395 |
| `pairwiseSum` | 755 | 6.18 | 0.705 | 165 |
| `neumaierSum` | 1,009 | 10.8 | 1.03 | 243 |
| `exactSum` | 128 | 0.588 | 0.060 | 49.2 |
| d3-array `fsum` | 120 | 0.634 | 0.064 | 59.8 |
| `kahan@0.0.3` | 81.6 | 0.836 | 0.084 | 19.6 |

Maximum measured ULP error (lower is better):

| algorithm | f64×1k | f64×100k | f64×1M | cancellation |
|---|---:|---:|---:|---:|
| `sum` | 4 | 206 | 233 | 6.00e15 |
| `pairwiseSum` | 1 | 8 | 0 | 6.01e15 |
| `neumaierSum` | 0 | 0 | 0 | 0 |
| `exactSum` | **0** | **0** | **0** | **0** |
| d3-array `fsum` | **0** | **0** | **0** | **0** |
| `kahan@0.0.3` | 0 | 5 | 0 | 6.00e15 |

The speed curve is honest: naive is fastest; pairwise runs at roughly 40–50%
of its rate; Neumaier is the strongest constant-memory option; exact summation
is about 8–27× slower than naive here. d3 wins narrowly on the large exact
workloads and cancellation, while this package's `exactSum` wins narrowly at
1k. Those are measurements, not promises. The zero-error cells for Neumaier
are properties of these inputs, not a guarantee; only the exact algorithms
guarantee them.

## Choosing a rung

| use case | choose | why |
|---|---|---|
| UI totals, telemetry, rough statistics | `sum` | smallest constant and maximum throughput |
| probability mass, reductions over large arrays | `pairwiseSum` | much slower error growth for about one extra unit of control overhead |
| accounting aggregates, simulation, scientific data | `neumaierSum` | strong compensation in constant memory, including the classic Kahan miss |
| computational geometry, reproducible reductions, reference results | `exactSum` | permutation-invariant, correctly rounded answer |

## API

Every array-taking function accepts `readonly number[] | Float64Array` and
does not mutate it.

```ts
sum(xs): number
pairwiseSum(xs): number
neumaierSum(xs): number
exactSum(xs): number

cumulativeSum(xs): number[]
// compensated running prefix sums

twoSum(a, b): [sum: number, residual: number]
// error-free transform for finite inputs when a + b does not overflow

fast2Sum(a, b): [sum: number, residual: number]
// three-operation transform; precondition: |a| >= |b|
```

`NaN` propagates. A single sign of infinity produces that infinity; mixing
`+Infinity` and `-Infinity` produces `NaN`. Empty sums are `+0`. As with IEEE
addition, cancellation normally produces `+0`; `exactSum([-0])` preserves the
single input's `-0`, while callers should not use a zero result's sign as
numerical information.

`exactSum` uses a Shewchuk nonoverlapping expansion on the ordinary path. If a
finite intermediate expansion component overflows, it falls back to exact
binary-rational BigInt accumulation so that cases such as
`[1e308, 1e308, -1e308, -1e308]` still return `0` rather than throwing or
silently returning `NaN`.

## Verification

The tests decode every binary64 input as an exact integer times a power of two,
accumulate those values over `BigInt`, and round once using IEEE 754
round-to-nearest, ties-to-even. That independent oracle checks every rung on
adversarial cancellation vectors and seeded mixed-sign, mixed-magnitude arrays
at every power-of-two size from 2 through 2²⁰.

`exactSum` must equal the oracle bit-for-bit and under permutations. The other
rungs are measured in ULPs and checked against their forward-error bounds.
`twoSum` and `fast2Sum` are checked as exact real identities with the same
oracle. Empty input, signed zero, infinities, NaN, overflow, and denormals have
dedicated tests. The derivation and invariants are in [DESIGN.md](./DESIGN.md).

To work on the benchmark locally, use `npm install --ignore-scripts`: the
required historical `kahan` dev dependency has a broken legacy install script;
its summation function itself remains runnable.

## License

MIT © Xyra Sinclair
