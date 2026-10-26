import { describe, expect, it } from "vitest";

import { allocatePassDeadline } from "../../packages/cli/src/tune/budget";

describe("tune whole-run deadline", () => {
    it("shares the remaining budget across all remaining passes without a floor", () => {
        expect(allocatePassDeadline(60_000, 4, 0)).toBe(15_000);
        expect(allocatePassDeadline(60_000, 3, 15_000)).toBe(30_000);
        expect(allocatePassDeadline(60_000, 2, 30_000)).toBe(45_000);
        expect(allocatePassDeadline(60_000, 1, 45_000)).toBe(60_000);
        expect(allocatePassDeadline(60_000, 2, 59_999)).toBe(59_999.5);
    });

    it("does not replenish the deadline when a pass overruns", () => {
        expect(allocatePassDeadline(60_000, 3, 40_000)).toBeCloseTo(46_666.666666666664);
        expect(allocatePassDeadline(60_000, 2, 60_000)).toBe(60_000);
        expect(allocatePassDeadline(60_000, 1, 90_000)).toBe(60_000);
    });
});
