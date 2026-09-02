import { defineBlock, enumValue } from "../../src/block/blockDefinition";
import { defineConnectionPointType } from "../../src/block/connectionPointType";

export const NumberType = defineConnectionPointType<number>("number", (value): value is number => typeof value === "number");
export const OtherNumberType = defineConnectionPointType<number>("number", (value): value is number => typeof value === "number");

export const NumberDefinition = defineBlock({
    type: "number",
    input: NumberType,
    output: NumberType,
    run: (input) => input,
});

export const ScaleDefinition = defineBlock({
    type: "number-scale",
    input: NumberType,
    output: NumberType,
    config: {
        scale: enumValue(["double", "triple"], "double"),
    },
    runAsync: async (input, config) => input * (config.scale === "double" ? 2 : 3),
});

export const OtherNumberDefinition = defineBlock({
    type: "other-number",
    input: OtherNumberType,
    output: OtherNumberType,
    run: (input) => input,
});
