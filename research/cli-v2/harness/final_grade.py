#!/usr/bin/env python3
"""Deferred grading for a trial tag, against the BEST KNOWN result per task.

1. Raw metrics for every trial output (independent graders: glbinfo2 for bytes/GPU/decoders/extensions, render.cjs +
   Python SSIM for fidelity, coldload.cjs for load time, measured quietly after all trials).
2. Best known = min(oracle reference from ref2.json, best agent output that meets every hard constraint).
3. near_best flags, success, and ratios to best known.

usage: final_grade.py <tag>[,<tag>...]   (writes grade into each result.json and prints a summary line per trial)
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness2 as H2

tags = sys.argv[1]
TOL = {"G1": 1.25, "C1": 1.15, "S1": 1.15, "L1": 1.2, "M1s": 1.15, "M1g": 1.25}
BIG = {"G1": {"gpu": 1}, "C1": {"bytes": 1}, "S1": {"total": 1}, "L1": {"load_s": 1}, "M1": {"size": 1, "gpu": 1}}

results = H2.load_results(tags)
H2.ref = lambda: BIG  # raw values: grade() divides by 1, near_best flags are recomputed below
for r in results:
    g = r["grade"]
    if g.get("pending") or "_raw" not in g:
        kd = f"{H2.KEEP}/{r['id']}"
        g = H2.grade(r["task"], f"{kd}/work", r.get("final", ""), kd, g.get("source_intact", True))
        if r["task"] == "L1":
            p = f"{kd}/work/public/models/toycar.glb"
            ms = H2.cold_load([p]).get(p) if os.path.exists(p) else None
            g["_load_s"] = round(g["_net_s"] + ms / 1000, 3) if ms else None
        g["_raw"] = True
        r["grade"] = g
        json.dump(r, open(f"{H2.TRIALS}/{r['id']}/result.json", "w"), indent=1)
        print("graded", r["id"], flush=True)

# metric per trial (None if the hard constraints are not met)
hard = lambda g, extra=(): all(bool(g.get(k)) for k in ("valid", "fidelity_ok", "source_intact", *extra))
def metric(r):
    g, t = r["grade"], r["task"]
    if t == "G1":
        return {"G1": g.get("_gpu")} if hard(g) else {}
    if t == "C1":
        return {"C1": g.get("_bytes")} if hard(g, ("no_extensions",)) else {}
    if t == "S1":
        return {"S1": g.get("_total")} if hard(g, ("viewer_compat",)) else {}
    if t == "L1":
        return {"L1": g.get("_load_s")} if hard(g, ("viewer_compat",)) and g.get("_load_s") else {}
    if t == "M1":
        return {"M1s": g.get("_size_ratio"), "M1g": g.get("_gpu_ratio")} if hard(g) else {}  # raw values (divided by 1)

ref = json.load(open(H2.REF_FILE)) if os.path.exists(H2.REF_FILE) else {}
best = {"G1": ref.get("G1", {}).get("gpu"), "C1": ref.get("C1", {}).get("bytes"), "S1": ref.get("S1", {}).get("total"), "L1": ref.get("L1", {}).get("load_s"),
        "M1s": ref.get("M1", {}).get("size"), "M1g": ref.get("M1", {}).get("gpu")}
source = {k: "oracle" for k, v in best.items() if v}
for r in results:
    for k, v in metric(r).items():
        if v and (best.get(k) is None or v < best[k]):
            best[k], source[k] = v, r["id"]
json.dump({"best": best, "source": source}, open(f"{H2.S}/best_known_{tags.replace(',', '_')}.json", "w"), indent=1)
print("best known:", json.dumps(best), json.dumps(source), flush=True)

for r in results:
    g, t = r["grade"], r["task"]
    if t == "G1":
        v = g.get("_gpu")
        g["_ratio"] = round(v / best["G1"], 3) if v else None
        g["near_best"] = bool(v) and v <= TOL["G1"] * best["G1"]
    elif t == "C1":
        v = g.get("_bytes")
        g["_ratio"] = round(v / best["C1"], 3) if v else None
        g["near_best"] = bool(v) and v <= TOL["C1"] * best["C1"]
    elif t == "S1":
        v = g.get("_total")
        g["_ratio"] = round(v / best["S1"], 3) if v and v < 1e11 else None
        g["near_best"] = bool(g["_ratio"]) and v <= TOL["S1"] * best["S1"]
    elif t == "L1":
        v = g.get("_load_s")
        g["_ratio"] = round(v / best["L1"], 3) if v else None
        g["near_best"] = bool(v) and v <= TOL["L1"] * best["L1"]
        if "near_best" not in g["_keys"]:
            g["_keys"] = g["_keys"] + ["near_best"]
    elif t == "M1":
        s, gp = g.get("_size_ratio"), g.get("_gpu_ratio")  # raw size (bytes + decoders) and raw GPU bytes
        g["_size"], g["_gpu"] = s, gp
        g["_size_r"] = round(s / best["M1s"], 3) if s and s < 1e11 else None
        g["_gpu_r"] = round(gp / best["M1g"], 3) if gp else None
        g["small_near_best"] = bool(g["_size_r"]) and s <= TOL["M1s"] * best["M1s"]
        g["gpu_near_best"] = bool(g["_gpu_r"]) and gp <= TOL["M1g"] * best["M1g"]
        g["_ratio"] = round(max(g["_size_r"] or 99, g["_gpu_r"] or 99), 3)
    g["success"] = all(bool(g.get(k)) for k in g["_keys"])
    g["score"] = round(sum(bool(g.get(k)) for k in g["_keys"]) / len(g["_keys"]), 3)
    json.dump(r, open(f"{H2.TRIALS}/{r['id']}/result.json", "w"), indent=1)
    print(f"{r['id']:34s} success={g['success']!s:5s} ratio={g.get('_ratio')} " + " ".join(f"{k}={g.get(k)}" for k in g["_keys"]), flush=True)
