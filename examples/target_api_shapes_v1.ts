const workerPoolServiceToken = ServiceToken<WorkerPoolService>("workerPoolService");
// pretend that exists^

// pretend this is all using the ServiceDefinition API from shared-ui-components
const dracoEncoderToken = ServiceToken<DracoEncoder>("dracoEncoder");
const dracoDecoder = ServiceDefinition({
    produces: [dracoEncoderToken],
    consumes: [workerPoolServiceToken],
    factory: async ({ workerPoolService }) => {
        const { DracoEncoder } = await import("@babylonjs/core/Meshes/Compression/dracoEncoder");
        DracoEncoder.DefaultConfiguration.workerPool = workerPoolService.workerPool;
        // ... continue setting up dracodecoder for babylon serialized glbs
        return {
            acquireAsync: () => {
                return DracoEncoder.Default.whenReadyAsync();
            },
            dispose: () => DracoEncoder.ResetDefault(),
        };
    },
});

const DracoDecoderInputBlock = defineInputBlock({
    outputs: {
        output: ??,
    },

    resources: {
        dracoDecoder: dracoDecoderToken,
    },

    run() {
        return dracoDecoder.acquireAsync();
    },
});

const GLBOutputBlock = defineGLBOutputBlock({
    type: "babylon.transform",

    inputs: {
        input: filePort, // hopefully u remember the type here
    },

    outputs: {
        output: assetPort, // ditto
    },

    config: {
        quality: enumValue(["fast", "high"]),
    },

    resources: {
        dracoDecoder: DracoDecoder, // use service definitions for this.
    },

    run({ source, strength }, { quality }, { workers, wasm }) {
        return workers.run(() => wasm.transform(source, strength, quality));
    },
});

const DracoEncodeBlock = defineInputBlock({
    type: "babylon.transform",
    version: 1,

    inputs: {
        source: filePort,
        strength: numberPort,
    },

    outputs: {
        asset: assetPort,
    },

    config: {
        quality: enumValue(["fast", "high"]),
    },

    resources: {
        dracoEncoder: DracoEncoder,
    },

    run({ source, strength }, { quality }, { workers, wasm }) {
        return workers.run(() => wasm.transform(source, strength, quality));
    },
});

class TransformBlock<T extends TransformBlockDefinition> extends BaseBlock<T> {
    ...
    // find a way to use the transform definition to create a block that can be instantiated and connected to other blocks in a graph.
}

// =======

// Wrapper around a block definition that provides a familiar and convenient interface for connecting inputs and outputs
// and storing configuration values.
abstract class BaseBlock<T extends BlockDefinition> {
    private _config: T["config"] | undefined;
    private _definition: T;

    constructor(config?: T["config"]) {
        this._config = {
            name: this.constructor.name,
            ...config
        };
        // TODO: need to connect to actual definition, not just the type
    }
}

class InputBlock<T extends InputBlockDefinition> extends BaseBlock<T> {
    public readonly output: OutputPort<T["output"]>;

    constructor(config?: T["config"]) {
        super(config);
        this.output = new OutputPort<T["output"]>();
    }
};

class OutputBlock<T extends OutputBlockDefinition> extends BaseBlock<T> {
    public readonly input: InputPort<T["input"]>;

    constructor(config?: T["config"]) {
        super(config);
        this.input = new InputPort<T["input"]>();
    }
};

class TransformBlock<T extends TransformBlockDefinition> extends BaseBlock<T> {
    public readonly input: InputPort<T["input"]>;
    public readonly output: OutputPort<T["output"]>;

    constructor(config?: T["config"]) {
        super(config);
        this.input = new InputPort<T["input"]>();
        this.output = new OutputPort<T["output"]>();
    }
};

class GLBOutputBlock extends OutputBlock<GLBOutputBlockDefinition> {
    constructor(config: GLBOutputBlockDefinition["config"]) {
        super(config);
        // TODO: need to read from actual definition, not just the type
        this.geometryEncoder = createInputPort<GLBOutputBlockDefinition["geometryEncoder"]>();
    }
}

// A graph of blocks that can be executed to produce an output asset (or maybe 0-n assets, but that's for later.)
class NodeAsset {
    constructor(config: NodeAssetConfig) {
        this.name = config.name;
        this.outputBlock = config.outputBlock;
    }

    public async executeAsync(inputs: GraphInputs<this>): Promise<GraphOutputs<this>> {
        const runtime = new NodeAssetCoordinator();

        try {
            return await runtime.executeAsync(this, inputs);
        } finally {
            await runtime.disposeAsync();
        }
    }
}


// =====
// Handles the execution of NodeAssets, including resource management.
class NodeAssetCoordinator {
    private readonly _resources: Map<string, unknown> = new Map();

    constructor(config?: NodeAssetCoordinatorConfig) {
        this.maxWorkers = config?.maxWorkers ?? 4;
        this.workerPool = new WorkerPoolService({ maxWorkers: this.maxWorkers });
    }

    public async loadAsync(asset: NodeAsset): Promise<void> {
        // for each block in the asset,
        // acquire the resource if it exists and hasnt been taken, and wait for all to complete
        for (const block of asset.blocks) {
            if (block.definition.resources) {
                for (const resource of block.definition.resources) {
                    if (!this._resources.has(resource.id)) {
                        this._resources.set(resource.id, resource.acquire());
                    }
                }
            }
        }

        return Promise.all(this._resources.values()).then(() => {}); // caller can choose to not await this if they just want to kick off the acquisition
    }

    public async executeAsync(asset: NodeAsset, inputs: GraphInputs<NodeAsset>): Promise<GraphOutputs<NodeAsset>> {
        await this.loadAsync(asset); // ensure resources are acquired before execution
        // For each block in order of the graph
            // Get its input values from the inputs or from the outputs of previous blocks
            // Get its resolved resource(s) from the coordinator
            // Execute the block with the input values and resources
            // Store the output values for the next blocks to use
        // Return the outputs of the final block(s)
    }

    public async dispose(): Promise<void> {
        for (const resource of this._resources.values()) {
            resource.dispose();
        }
    }
}

class NodeAssetOptimizer {
    // Expands compound blocks into their constituent blocks, and rewires the graph to connect the inputs and outputs of the compound block to the appropriate internal blocks.
    // Removes any blocks that are not connected to the output block(s) of the graph.
    // Merges any blocks that can be combined into a single block for efficiency.
    // Returns a new optimized graph.
}

class NodeAssetSerializer {
    // Serializes a NodeAsset into a JSON representation that can be saved to disk or sent over the network.
    // Should probably call NodeAssetOptimizer to optimize the graph before serialization.
}

// =====

// ==== Scenario 1: when you know values you want to use at graph construction time
const source = new USDInputBlock({ name: "USD", /** If unset, defaults to block class name */, input: bytes});
const transform = new CenterBlock();
const destination = new GLTFOutputBlock({ name: "GLTF" /** If unset, defaults to block class name */, binary: true });
source.output.connectTo(transform.input);
transform.output.connectTo(destination.input);

// Execute using NodeAsset directly for one-shot execution (via a private coordinator)
const nae = new NodeAsset({name: "usd-to-glb", outputBlock: destination});
const result = await nae.executeAsync();


// ==== Scenario 2: when you want to set values at execution time
const source = new USDInputBlock({ name: "USD"});
const transform = new CenterBlock();
const destination = new GLTFOutputBlock({ name: "GLTF", binary: true });
source.output.connectTo(transform.input);
transform.output.connectTo(destination.input);

const nae = new NodeAsset({ name: "usd-to-glb" });
nae.addOutputBlock(destination);

const context = nae.createContext();
context.setInput(source, bytes);

const result = await nae.executeAsync(context);

// === Scenario 3: when you want to keep resources loaded for sequential executions
const source1 = new USDInputBlock({ name: "USD", input: usdBytes });
const transform1 = new CenterBlock();
const destination1 = new GLTFOutputBlock({ name: "GLTF", binary: true });
source1.output.connectTo(transform1.input);
transform1.output.connectTo(destination1.input);

const source2 = new FBXInputBlock({ name: "FBX", input: fbxBytes });
const transform2 = new CenterBlock();
const destination2 = new GLTFOutputBlock({ name: "GLTF", binary: true });
source2.output.connectTo(transform2.input);
transform2.output.connectTo(destination2.input);

const coordinator = new NodeAssetCoordinator();
const usdToGlb = coordinator.createNodeAsset({name: "usd-to-glb", outputBlock: destination1});
const fbxToGlb = coordinator.createNodeAsset({name: "fbx-to-glb", outputBlock: destination2});

const result1 = await coordinator.executeAsync(usdToGlb);
const result2 = await coordinator.executeAsync(fbxToGlb); // Reuses GLB stuff and other resources from the first execution

coordinator.dispose();

// === Scenario 4: when you want to batch process multiple inputs in parallel
const source = new USDInputBlock({ name: "USD"});
const transform = new CenterBlock();
const destination = new GLTFOutputBlock({ name: "GLTF", binary: true });
source.output.connectTo(transform.input);
transform.output.connectTo(destination.input);

const coordinator = new NodeAssetCoordinator();
const nae = coordinator.createNodeAsset({name: "usd-to-glb", outputBlock: destination});

const ctx1 = nae.createContext();
ctx1.setInput(source, firstBytes);

const ctx2 = nae.createContext();
ctx2.setInput(source, secondBytes);

const [first, second] = await coordinator.executeAsync(nae, [ctx1, ctx2]); // Runs both contexts in parallel and returns all assets from both contexts

await coordinator.dispose();
