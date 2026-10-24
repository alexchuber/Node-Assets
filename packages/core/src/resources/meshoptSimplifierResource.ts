import type { Resource } from "./resource";

async function createMeshoptSimplifierAsync() {
    const { MeshoptSimplifier } = await import("meshoptimizer");
    await MeshoptSimplifier.ready;
    return MeshoptSimplifier;
}

export const MeshoptSimplifierResource = {
    name: "Meshopt simplifier",
    create: createMeshoptSimplifierAsync,
    dispose: () => {},
} satisfies Resource<Awaited<ReturnType<typeof createMeshoptSimplifierAsync>>>;
