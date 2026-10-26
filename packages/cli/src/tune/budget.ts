export function allocatePassDeadline(deadline: number, remainingPasses: number, now = Date.now()): number {
    return Math.min(deadline, now + Math.max(0, deadline - now) / remainingPasses);
}
