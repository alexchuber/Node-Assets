#!/usr/bin/env python3
"""Apply the reference (extended-grid) recipes and measure them with the independent graders -> ref2.json."""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness2 as H2

S = H2.S
O = f"{S}/oracle"
N = ["node", f"{H2.TUNER}/bin.mjs"]
if not os.path.exists(f"{O}/assets"):
    os.symlink(f"{S}/template/assets", f"{O}/assets")


def run(recipe, inp, out):
    r = subprocess.run(N + ["run", recipe, inp, "-o", out, "--force"], cwd=O, capture_output=True, text=True, timeout=1200)
    assert os.path.exists(f"{O}/{out}"), r.stdout + r.stderr


jobs = [("ref3/helmet.gpu.recipe.toon", "assets/helmet.glb", "refout/G1_helmet.glb"),
        ("ref3/helmet.compat.recipe.toon", "assets/helmet.glb", "refout/C1_helmet.glb"),
        ("ref3/toycar.load.recipe.toon", "assets/toycar.glb", "refout/L1_toycar.glb"),
        ("ref3/lantern.size.recipe.toon", "assets/lantern.glb", "refout/M1_small.glb"),
        ("ref3/lantern.gpu.recipe.toon", "assets/lantern.glb", "refout/M1_gpu.glb"),
        ("ref3_s1/boombox.size.recipe.toon", "assets/boombox.glb", "refout/S1_boombox.glb"),
        ("ref3_s1/helmet.size.recipe.toon", "assets/helmet.glb", "refout/S1_helmet.glb"),
        ("ref3_s1/toycar.size.recipe.toon", "assets/toycar.glb", "refout/S1_toycar.glb")]
for rec, inp, out in jobs:
    run(rec, inp, out)
P = lambda x: f"{O}/refout/{x}"
info = H2.glbinfo([P(x) for x in os.listdir(f"{O}/refout")])
fid = {}
for name, src in [("G1_helmet.glb", "helmet"), ("C1_helmet.glb", "helmet"), ("L1_toycar.glb", "toycar"), ("M1_small.glb", "lantern"), ("M1_gpu.glb", "lantern"), ("S1_boombox.glb", "boombox"), ("S1_helmet.glb", "helmet"), ("S1_toycar.glb", "toycar")]:
    fid[name] = H2.fidelity(f"{O}/assets/{src}.glb", [P(name)])[P(name)]
dec = lambda i: sum(H2.DEC_BYTES[d] for d in i["decoders"])
cold = H2.cold_load([P("L1_toycar.glb")])
l1 = info[P("L1_toycar.glb")]
s1 = [info[P(f"S1_{n}.glb")] for n in ("boombox", "helmet", "toycar")]
s1_dec = sorted({d for i in s1 for d in i["decoders"]})
ref = {
    "G1": {"gpu": info[P("G1_helmet.glb")]["gpu"], "bytes": info[P("G1_helmet.glb")]["bytes"], "fid": fid["G1_helmet.glb"], "decoders": info[P("G1_helmet.glb")]["decoders"]},
    "C1": {"bytes": info[P("C1_helmet.glb")]["bytes"], "required": info[P("C1_helmet.glb")]["required"], "fid": fid["C1_helmet.glb"]},
    "L1": {"load_s": round((l1["bytes"] + dec(l1)) * 8 / (H2.MBPS * 1e6) + cold[P("L1_toycar.glb")] / 1000, 3), "bytes": l1["bytes"], "decoders": l1["decoders"], "cold_ms": cold[P("L1_toycar.glb")], "fid": fid["L1_toycar.glb"]},
    "M1": {"size": info[P("M1_small.glb")]["bytes"] + dec(info[P("M1_small.glb")]), "gpu": info[P("M1_gpu.glb")]["gpu"], "fid": [fid["M1_small.glb"], fid["M1_gpu.glb"]]},
    "S1": {"total": sum(i["bytes"] for i in s1) + sum(H2.DEC_BYTES[d] for d in s1_dec), "decoders": s1_dec, "fid": [fid[f"S1_{n}.glb"] for n in ("boombox", "helmet", "toycar")]},
}
json.dump(ref, open(H2.REF_FILE, "w"), indent=1)
print(json.dumps(ref, indent=1))
