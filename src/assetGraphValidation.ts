import type { NodeAssetBlock } from "./blocks/nodeAssetBlock";

interface GraphValidationFinding {
    readonly kindRank: number;
    readonly producerName: string;
    readonly portName: string;
    readonly message: string;
}

export function getAssetGraphValidationError(roots: readonly NodeAssetBlock[], graphName: string): Error | undefined {
    const duplicateOutputNames = getDuplicateOutputNames(roots);
    const findings: GraphValidationFinding[] = [];
    if (duplicateOutputNames.length > 0) {
        findings.push({
            kindRank: 0,
            producerName: "",
            portName: duplicateOutputNames.join(", "),
            message: `Duplicate output block names: ${duplicateOutputNames.map((name) => `"${name}"`).join(", ")}.`,
        });
    }
    const visitedBlocks = new Set<NodeAssetBlock>();

    const visit = (block: NodeAssetBlock): void => {
        if (visitedBlocks.has(block)) {
            return;
        }

        visitedBlocks.add(block);
        for (const input of block._getInputs()) {
            const output = input._getConnectedOutput();
            if (output === undefined) {
                findings.push({
                    kindRank: 1,
                    producerName: block.name,
                    portName: input.name,
                    message: `Block "${block.name}" has an unconnected required input "${input.name}".`,
                });
            } else {
                visit(output._block);
            }
        }

        for (const output of block._getOutputs()) {
            if (output.type === "SceneAsset" && output._getEndpoints().length > 1) {
                findings.push({
                    kindRank: 2,
                    producerName: block.name,
                    portName: output.name,
                    message: `Block "${block.name}" output "${output.name}" produces a SceneAsset value that is moved to its consumer and cannot feed multiple consumers in v0.`,
                });
            }
        }
    };

    for (const root of roots) {
        visit(root);
    }

    if (findings.length === 0) {
        return undefined;
    }
    const hasOnlyDuplicateOutputNames = duplicateOutputNames.length > 0 && findings.length === 1;
    if (hasOnlyDuplicateOutputNames) {
        const names = duplicateOutputNames.map((name) => `"${name}"`).join(", ");
        return new Error(`NodeAsset "${graphName}" has duplicate output block names: ${names}.`);
    }

    findings.sort(compareGraphValidationFindings);
    return new Error(`NodeAsset "${graphName}" cannot build because the graph has structural errors:\n${findings.map(({ message }) => message).join("\n")}`);
}

function getDuplicateOutputNames(roots: readonly NodeAssetBlock[]): string[] {
    const nameCounts = new Map<string, number>();
    for (const root of roots) {
        nameCounts.set(root.name, (nameCounts.get(root.name) ?? 0) + 1);
    }

    return [...nameCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
        .sort(compareText);
}

function compareGraphValidationFindings(left: GraphValidationFinding, right: GraphValidationFinding): number {
    return (
        left.kindRank - right.kindRank ||
        compareText(left.producerName, right.producerName) ||
        compareText(left.portName, right.portName) ||
        compareText(left.message, right.message)
    );
}

function compareText(left: string, right: string): number {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}
