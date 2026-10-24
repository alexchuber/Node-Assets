import { describe, expect, it } from "vitest";

import { booleanValue, enumValue, integerValue, numberValue, value } from "../../packages/core/src/blocks/blockDefinition";
import { NumberType } from "../helpers/numberBlocks";

describe("config descriptors", () => {
    it("describes custom, boolean, numeric and enum values", () => {
        expect(value(NumberType, 1).descriptor).toEqual({ kind: "custom" });
        expect(booleanValue(false).descriptor).toEqual({ kind: "boolean" });
        expect(integerValue(3, { min: 1, max: 5 }).descriptor).toEqual({ kind: "integer", min: 1, max: 5 });
        expect(numberValue(0.5, { min: 0, max: 1 }).descriptor).toEqual({ kind: "number", min: 0, max: 1 });
        expect(enumValue(["a", "b"]).descriptor).toEqual({ kind: "enum", values: ["a", "b"] });
    });

    it("validates finite inclusive numeric ranges and booleans", () => {
        const integer = integerValue(3, { min: 1, max: 5 });
        expect([0, 1.5, 6, NaN, Infinity, "3"].map(integer.is)).toEqual([false, false, false, false, false, false]);
        expect([1, 3, 5].map(integer.is)).toEqual([true, true, true]);
        const number = numberValue(0.5, { min: 0, max: 1 });
        expect([0, 0.5, 1].map(number.is)).toEqual([true, true, true]);
        expect([-1, 2, Infinity, NaN].map(number.is)).toEqual([false, false, false, false]);
        expect([true, false, 1, null].map(booleanValue(false).is)).toEqual([true, true, false, false]);
    });
});
