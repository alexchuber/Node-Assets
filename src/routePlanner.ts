import type { _AnyBlockDefinition, _RouteBlock, ConfigValues, RoutedOutputBlockDefinition, ValueType } from "./blocks/blockDefinition";

/** @internal */
export function _resolveRoute(
    definition: RoutedOutputBlockDefinition,
    sourceType: ValueType<unknown>,
    config: ConfigValues<RoutedOutputBlockDefinition["config"]>
): readonly _RouteBlock[] {
    if (!definition.input.accepts(sourceType)) {
        throw new Error(`Routed output "${definition.type}" does not accept value type "${sourceType.id}".`);
    }

    const route = definition.resolveRoute(sourceType, config);
    let currentType = sourceType;
    for (const block of route) {
        if (!block.definition.input.accepts(currentType)) {
            throw new Error(`Route block "${block.definition.type}" does not accept value type "${currentType.id}".`);
        }
        currentType = block.definition.output;
    }

    if (!definition.output.accepts(currentType)) {
        throw new Error(`Route for "${definition.type}" produces "${currentType.id}" instead of "${definition.output.id}".`);
    }
    return Object.freeze([...route]);
}

/** @internal */
export function _isRoutedOutputDefinition(definition: _AnyBlockDefinition): definition is RoutedOutputBlockDefinition {
    return typeof definition.resolveRoute === "function";
}
