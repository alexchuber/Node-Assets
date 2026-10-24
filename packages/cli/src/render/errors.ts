export function emptyModelError() {
    const hint = "the model renders empty; check that it has visible geometry and materials";
    return Object.assign(new Error(hint), { code: "INVALID_INPUT", hint, help: [hint] });
}
