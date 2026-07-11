/** Knuth's error-free 2Sum transform (finite inputs, no overflow). */
export function twoSum(a: number, b: number): [sum: number, residual: number] {
    const sum = a + b
    const virtualA = sum - b
    const virtualB = sum - virtualA
    return [sum, a - virtualA + (b - virtualB)]
}

/**
 * Dekker's three-operation Fast2Sum transform.
 *
 * Precondition: `|a| >= |b|`, and the rounded sum must be finite. Unlike
 * `twoSum`, this function deliberately does not check or repair the ordering;
 * callers choose it when they already know the magnitudes.
 */
export function fast2Sum(a: number, b: number): [sum: number, residual: number] {
    const sum = a + b
    return [sum, b - (sum - a)]
}
