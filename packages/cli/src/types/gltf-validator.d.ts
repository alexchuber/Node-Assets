declare module "gltf-validator" {
    export function validateBytes(bytes: Uint8Array, options?: ValidationOptions): Promise<ValidationReport>;
}
