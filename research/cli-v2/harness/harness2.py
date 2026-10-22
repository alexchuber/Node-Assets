#!/usr/bin/env python3
"""Goal-driven agent trials for the tuner: knobs-only vs tune (TOON) vs tune (JSON).

Graded against reference values (best found by an extended-grid tuner run), with independent graders:
GPU estimate (grader2/glbinfo2.mjs), fidelity (render/render.cjs + Python worst-64px-tile SSIM),
cold load (grader2/coldload.cjs).
"""
import argparse, concurrent.futures as cf, json, os, random, re, shutil, subprocess, sys, tempfile, time, uuid
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import harness as H
sys.path.insert(0, os.path.join(H.S, "render"))
from compare import load as load_png, ssim_map
from scipy.ndimage import binary_dilation

S = H.S
TUNER = os.environ.get("NA_TUNER", os.path.normpath(f"{S}/../prototype"))
G2 = f"{S}/grader2"
TRIALS = os.environ.get("NA_TRIALS", f"{S}/trials2")  # NA_TRIALS=../data/results reads the committed runs
KEEP = f"{S}/trials2_outputs"
REF_FILE = f"{S}/ref2.json"
FLOOR = 0.895  # 0.9 limit with a small tolerance for implementation differences between graders
DEC_BYTES = {"draco": 74764, "meshopt": 6455, "ktx2": 260468}
SETTERS = {"draco": "setDRACOLoader", "meshopt": "setMeshoptDecoder", "ktx2": "setKTX2Loader"}
MBPS = 9

VARIANTS = {"knobs": {"tune": False, "format": "toon"}, "tune": {"tune": True, "format": "toon"}, "tune-json": {"tune": True, "format": "json"}}
SUFFIX = "\n\nYou can use the `node-assets` CLI (already installed on PATH) for 3D asset work. Work in the current directory."
TASKS = {
    "G1": "Our WebXR scene keeps running out of GPU memory on Quest headsets. Make `public/models/helmet.glb` (its source is `assets/helmet.glb`) use as little GPU memory as you can "
          "without visible quality loss. That scene is built with Babylon.js, which decodes Draco, Meshopt and KTX2 by itself, so any format is fine.",
    "L1": "On phones over 4G, our product page takes too long to show `public/models/toycar.glb` (source: `assets/toycar.glb`). Make it load as fast as possible "
          "without visible quality loss. You may update `src/viewer.js` if the file needs a decoder.",
    "S1": "First-time visitors to our landing page download `public/models/boombox.glb`, `helmet.glb` and `toycar.glb` (sources are in `assets/`). Minimize the total number of bytes "
          "they download for these three models, counting any decoder files the viewer has to fetch, without visible quality loss. You may update `src/viewer.js` to add decoders if needed.",
    "C1": "We share `assets/helmet.glb` with partners whose glTF viewers we don't control (some are old and support no glTF extensions at all). Produce `public/models/helmet.glb` that is "
          "as small as possible while still loading in any glTF 2.0 viewer, without visible quality loss.",
    "M1": "We haven't decided whether the lantern should be optimized for the smallest download or for the lowest GPU memory. Make both versions from `assets/lantern.glb`: "
          "`public/models/lantern-small.glb` (smallest download) and `public/models/lantern-gpu.glb` (lowest GPU memory), without visible quality loss, and tell me the trade-off in numbers. "
          "Our viewer is Babylon.js, so any format is fine.",
}


def glbinfo(paths):
    r = subprocess.run(["node", f"{G2}/glbinfo2.mjs", *paths], capture_output=True, text=True, timeout=600, cwd=G2)
    return json.loads(r.stdout)


def worst_tile(ref_png, cand_png, T=64):
    r, mr = load_png(ref_png)
    c, mc = load_png(cand_png)
    mask = binary_dilation(mr | mc, iterations=3)
    lum = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])
    sm = ssim_map(lum(r), lum(c))
    worst = 1.0
    for y in range(0, sm.shape[0], T):
        for x in range(0, sm.shape[1], T):
            m = mask[y:y + T, x:x + T]
            if m.mean() > 0.25:
                worst = min(worst, float(sm[y:y + T, x:x + T][m].mean()))
    return worst


def fidelity(orig, outs):
    """Independent fidelity: worst 64px tile SSIM over 4 views at 1024px; camera framed on the original."""
    tmp = tempfile.mkdtemp(dir=S)
    try:
        shutil.copy(orig, f"{tmp}/orig.glb")
        names = []
        for i, o in enumerate(outs):
            if os.path.exists(o):
                shutil.copy(o, f"{tmp}/c{i}.glb")
                names.append(f"c{i}")
        if not names:
            return {}
        subprocess.run(["node", f"{S}/render/render.cjs", f"{tmp}/png", "1024", "4", f"{tmp}/orig.glb", *[f"{tmp}/{n}.glb" for n in names]], capture_output=True, timeout=900, cwd=f"{S}/render")
        res = {}
        for i, o in enumerate(outs):
            n = f"c{i}"
            if n in names and os.path.exists(f"{tmp}/png/{n}__v0.png"):
                res[o] = round(min(worst_tile(f"{tmp}/png/orig__v{v}.png", f"{tmp}/png/{n}__v{v}.png") for v in range(4)), 3)
            else:
                res[o] = 0.0  # failed to render
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def cold_load(paths):
    r = subprocess.run(["node", f"{G2}/coldload.cjs", *paths], capture_output=True, text=True, timeout=900, cwd=G2)
    try:
        return json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        return {}


def ref():
    return json.load(open(REF_FILE)) if os.path.exists(REF_FILE) else {}


def grade(task, work, final, keep_dir, source_intact=True):
    R = ref()
    c = {}
    viewer = open(f"{work}/src/viewer.js").read()
    c["source_intact"] = source_intact
    pm = f"{work}/public/models"
    A = f"{H.TEMPLATE}/assets"
    ok_file = lambda i: i.get("exists") and i.get("parse_ok") and i.get("validator_errors", 1) == 0
    compat = lambda i: all(SETTERS[d] in viewer for d in i.get("decoders", []))
    os.makedirs(keep_dir, exist_ok=True)

    def keep(p):
        pass

    if task == "G1":
        p = f"{pm}/helmet.glb"
        i = glbinfo([p])[p]
        f = fidelity(f"{A}/helmet.glb", [p]).get(p, 0)
        c.update(valid=ok_file(i), fidelity_ok=f >= FLOOR, near_best=i.get("gpu", 1e18) <= 1.25 * R["G1"]["gpu"])
        c.update(_gpu=i.get("gpu"), _ratio=round(i.get("gpu", 0) / R["G1"]["gpu"], 2) if i.get("gpu") else None, _fid=f, _bytes=i.get("bytes"), _dec=i.get("decoders"))
        keys = ["valid", "fidelity_ok", "near_best", "source_intact"]
    elif task == "C1":
        p = f"{pm}/helmet.glb"
        i = glbinfo([p])[p]
        f = fidelity(f"{A}/helmet.glb", [p]).get(p, 0)
        c.update(valid=ok_file(i), no_extensions=i.get("exists") and not i.get("required"), fidelity_ok=f >= FLOOR, near_best=i.get("bytes", 1e18) <= 1.15 * R["C1"]["bytes"])
        c.update(_bytes=i.get("bytes"), _ratio=round(i.get("bytes", 0) / R["C1"]["bytes"], 2) if i.get("bytes") else None, _fid=f, _req=i.get("required"))
        keys = ["valid", "no_extensions", "fidelity_ok", "near_best", "source_intact"]
    elif task == "L1":
        p = f"{pm}/toycar.glb"
        i = glbinfo([p])[p]
        f = fidelity(f"{A}/toycar.glb", [p]).get(p, 0)
        keep(p)
        net = (i.get("bytes", 0) + sum(DEC_BYTES[d] for d in i.get("decoders", []))) * 8 / (MBPS * 1e6)
        c.update(valid=ok_file(i), fidelity_ok=f >= FLOOR, viewer_compat=bool(i.get("exists")) and compat(i))
        c.update(_net_s=round(net, 3), _fid=f, _bytes=i.get("bytes"), _dec=i.get("decoders"))  # near_best is filled by the quiet load re-grade
        c["near_best"] = None
        keys = ["valid", "fidelity_ok", "viewer_compat", "source_intact"]  # near_best added at re-grade
    elif task == "S1":
        ps = [f"{pm}/{n}.glb" for n in ("boombox", "helmet", "toycar")]
        info = glbinfo(ps)
        fids = {}
        for n, p in zip(("boombox", "helmet", "toycar"), ps):
            fids[p] = fidelity(f"{A}/{n}.glb", [p]).get(p, 0)
        decs = sorted({d for p in ps for d in info[p].get("decoders", [])})
        total = sum(info[p].get("bytes", 1e12) for p in ps) + sum(DEC_BYTES[d] for d in decs)
        c.update(valid=all(ok_file(info[p]) for p in ps), fidelity_ok=all(fids[p] >= FLOOR for p in ps), viewer_compat=all(compat(info[p]) for p in ps if info[p].get("exists")), near_best=total <= 1.15 * R["S1"]["total"])
        c.update(_total=int(total), _ratio=round(total / R["S1"]["total"], 2), _fids=list(fids.values()), _dec=decs)
        keys = ["valid", "fidelity_ok", "viewer_compat", "near_best", "source_intact"]
    elif task == "M1":
        ps, pg = f"{pm}/lantern-small.glb", f"{pm}/lantern-gpu.glb"
        info = glbinfo([ps, pg])
        fids = fidelity(f"{A}/lantern.glb", [ps, pg])
        sz = info[ps].get("bytes", 1e12) + sum(DEC_BYTES[d] for d in info[ps].get("decoders", []))
        c.update(valid=ok_file(info[ps]) and ok_file(info[pg]), fidelity_ok=fids.get(ps, 0) >= FLOOR and fids.get(pg, 0) >= FLOOR,
                 small_near_best=sz <= 1.15 * R["M1"]["size"], gpu_near_best=info[pg].get("gpu", 1e18) <= 1.25 * R["M1"]["gpu"])
        c.update(_size_ratio=round(sz / R["M1"]["size"], 2), _gpu_ratio=round(info[pg].get("gpu", 0) / R["M1"]["gpu"], 2) if info[pg].get("gpu") else None, _fids=[fids.get(ps), fids.get(pg)])
        keys = ["valid", "fidelity_ok", "small_near_best", "gpu_near_best", "source_intact"]
    c["_keys"] = keys
    c["success"] = all(bool(c[k]) for k in keys)
    c["score"] = round(sum(bool(c[k]) for k in keys) / len(keys), 3)
    return c


def run_trial(task, variant, model, rep, tag, timeout=2700):
    tid = f"{tag}__{task}__{variant}__{model}__r{rep}"
    d = f"{TRIALS}/{tid}"
    if os.path.exists(f"{d}/result.json"):
        return json.load(open(f"{d}/result.json"))
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(f"{d}/bin")
    shutil.copytree(H.TEMPLATE, f"{d}/work")
    json.dump(VARIANTS[variant], open(f"{d}/variant.json", "w"))
    with open(f"{d}/bin/node-assets", "w") as fh:
        fh.write(f"#!/bin/sh\nNA_TRIAL={d} exec node {TUNER}/launcher.mjs \"$@\"\n")
    os.chmod(f"{d}/bin/node-assets", 0o755)
    cmd = ["claude", "-p", TASKS[task] + SUFFIX, "--model", model, "--output-format", "stream-json", "--verbose", "--safe-mode", "--strict-mcp-config", "--no-chrome",
           "--tools", "Bash,Read,Write,Edit,Glob,Grep", "--dangerously-skip-permissions", "--no-session-persistence", "--session-id", str(uuid.uuid4()), "--max-budget-usd", "6"]
    t0 = time.time()
    timed_out = False
    with open(f"{d}/transcript.jsonl", "w") as o, open(f"{d}/stderr.txt", "w") as e:
        try:
            subprocess.run(cmd, cwd=f"{d}/work", env=H.scrubbed_env(f"{d}/bin"), stdin=subprocess.DEVNULL, stdout=o, stderr=e, timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
    tm = H.parse_transcript(f"{d}/transcript.jsonl")
    cm = H.parse_calls(f"{d}/calls.jsonl")
    # keep outputs + viewer for deferred grading
    kd = f"{KEEP}/{tid}"
    shutil.rmtree(kd, ignore_errors=True)
    os.makedirs(f"{kd}/work/public", exist_ok=True)
    if os.path.isdir(f"{d}/work/public/models"):
        shutil.copytree(f"{d}/work/public/models", f"{kd}/work/public/models")
    else:
        os.makedirs(f"{kd}/work/public/models")
    shutil.copytree(f"{d}/work/src", f"{kd}/work/src")
    g = {"pending": True, "source_intact": H.sha_tree(f"{d}/work", "assets") == H.template_hash("assets")}
    res = {"id": tid, "task": task, "variant": variant, "model": model, "rep": rep, "tag": tag, "wall_s": round(time.time() - t0, 1), "timed_out": timed_out, **tm, **cm, "grade": g}
    json.dump(res, open(f"{d}/result.json", "w"), indent=1)
    for dp, dn, fn in os.walk(f"{d}/work"):
        for f in fn:
            if f.lower().endswith((".glb", ".fbx", ".obj", ".stl", ".jpg", ".png", ".bin", ".blend", ".gltf", ".webp", ".ktx2")):
                os.remove(os.path.join(dp, f))
    return res


def load_results(tag=None):
    out = []
    if os.path.isdir(TRIALS):
        for t in os.listdir(TRIALS):
            p = f"{TRIALS}/{t}/result.json"
            if os.path.exists(p):
                r = json.load(open(p))
                if tag is None or r["tag"] in tag.split(","):
                    out.append(r)
    return out


def grade_all():
    for r in load_results():
        if not r["grade"].get("pending"):
            continue
        kd = f"{KEEP}/{r['id']}"
        g = grade(r["task"], f"{kd}/work", r["final"], kd, r["grade"]["source_intact"])
        r["grade"] = g
        json.dump(r, open(f"{TRIALS}/{r['id']}/result.json", "w"), indent=1)
        print(r["id"], g["success"], {k: v for k, v in g.items() if k.startswith("_") and k != "_keys"}, flush=True)
    regrade_load()


def regrade_load():
    """Quiet re-grade of L1 load times (cold loads measured with nothing else running)."""
    R = ref()
    for r in load_results():
        if r["task"] != "L1":
            continue
        p = f"{KEEP}/{r['id']}/work/public/models/toycar.glb"
        if not os.path.exists(p):
            r["grade"]["near_best"] = False
        else:
            ms = cold_load([p]).get(p, 1e6)
            load_s = r["grade"]["_net_s"] + ms / 1000
            r["grade"]["_load_s"] = round(load_s, 3)
            r["grade"]["_ratio"] = round(load_s / R["L1"]["load_s"], 2)
            r["grade"]["near_best"] = load_s <= 1.2 * R["L1"]["load_s"]
        keys = r["grade"]["_keys"] + (["near_best"] if "near_best" not in r["grade"]["_keys"] else [])
        r["grade"]["_keys"] = keys
        r["grade"]["success"] = all(bool(r["grade"][k]) for k in keys)
        r["grade"]["score"] = round(sum(bool(r["grade"][k]) for k in keys) / len(keys), 3)
        json.dump(r, open(f"{TRIALS}/{r['id']}/result.json", "w"), indent=1)
        print(r["id"], r["grade"].get("_load_s"), r["grade"]["success"])


def cmd_run(a):
    jobs = []
    spec = [(v, ts.split(",")) for v, ts in (s.split("=") for s in a.spec.split(";"))]
    for rep in range(1, a.reps + 1):  # every cell's rep 1 runs before any rep 2, so results can be read part-way
        batch = [(t, v, m, rep, a.tag) for v, ts in spec for t in ts for m in a.models.split(",")]
        random.Random(7 + rep).shuffle(batch)
        jobs += batch
    todo = [j for j in jobs if not os.path.exists(f"{TRIALS}/{j[4]}__{j[0]}__{j[1]}__{j[2]}__r{j[3]}/result.json")]
    print(f"{len(jobs)} jobs, {len(todo)} to run", flush=True)
    with cf.ThreadPoolExecutor(a.concurrency) as ex:
        futs = {ex.submit(run_trial, *j): j for j in todo}
        for f in cf.as_completed(futs):
            j = futs[f]
            try:
                r = f.result()
                g = r["grade"]
                print(f"{r['id']}: done cost=${r['cost'] or 0:.3f} turns={r['turns']} na={r['na_calls']} {r['wall_s']}s", flush=True)
            except Exception as e:
                import traceback
                print(f"ERROR {j}: {e!r} {traceback.format_exc()[-400:]}", flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(dest="cmd")
    r = sp.add_parser("run")
    r.add_argument("--spec", required=True)
    r.add_argument("--models", default="haiku,sonnet")
    r.add_argument("--reps", type=int, default=2)
    r.add_argument("--tag", default="g1")
    r.add_argument("--concurrency", type=int, default=3)
    sp.add_parser("regrade-load")
    sp.add_parser("grade-all")
    a = p.parse_args()
    {"run": cmd_run, "regrade-load": lambda a: regrade_load(), "grade-all": lambda a: grade_all()}[a.cmd](a)
