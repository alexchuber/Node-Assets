import { expect } from "vitest";

export async function expectRejectedAsync(promise: Promise<unknown>): Promise<void> {
    const outcome = await promise.then(
        () => "fulfilled" as const,
        () => "rejected" as const
    );
    expect(outcome).toBe("rejected");
}
