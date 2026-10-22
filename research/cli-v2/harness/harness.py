#!/usr/bin/env python3
"""Agent-interface experiment harness for node-assets CLI designs.

Each trial: fresh copy of a small three.js project + assets, a `node-assets` binary on PATH
(variant selected per trial), a headless Claude Code agent given one task prompt.
Graded deterministically from the files on disk (and the final answer where the task asks for one).
"""
import argparse, concurrent.futures as cf, hashlib, json, os, random, re, shutil, subprocess, sys, time, uuid

# Working directory for trials and outputs (default: this harness directory).
S = os.environ.get("NA_HARNESS_DIR", os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = f"{S}/template"
PROTO = f"{S}/proto"
TRIALS = f"{S}/trials"

BASE = {"surface": "optimize", "report": "summary", "format": "text", "batch": True, "budget": True,
        "inspect": True, "errors": "actionable", "geometryDefault": "meshopt", "hints": True}
VARIANTS = {
    "current": {"surface": "current"},
    "ops": {"surface": "ops"},
    "full": dict(BASE),
    "full-q": dict(BASE, geometryDefault="quantize"),
    "nosummary": dict(BASE, report="silent"),
    "noinspect": dict(BASE, inspect=False),
    "nobatch": dict(BASE, batch=False),
    "nobudget": dict(BASE, budget=False),
    "json": dict(BASE, format="json"),
    "terse": dict(BASE, errors="terse"),
    "nohints": dict(BASE, hints=False),
}
QBASE = dict(BASE, geometryDefault="quantize")
VARIANTS.update({
    "q-nosummary": dict(QBASE, report="silent"),
    "q-noinspect": dict(QBASE, inspect=False),
    "q-nobatch": dict(QBASE, batch=False),
    "q-nobudget": dict(QBASE, budget=False),
    "q-json": dict(QBASE, format="json"),
    "q-terse": dict(QBASE, errors="terse"),
    "q-nohints": dict(QBASE, hints=False),
    "final": dict(QBASE, impl="v2"),
    "mvp": dict(QBASE, impl="v3", hints=False),
})

SUFFIX = "\n\nYou can use the `node-assets` CLI (already installed on PATH) for 3D asset work. Work in the current directory."

TASKS = {
    "T1": "Our product page (`index.html` + `src/viewer.js`) loads `public/models/boombox.glb`, and it takes forever to load on mobile. "
          "Make that model web-ready. The original source file is `assets/boombox.glb`; leave it untouched. "
          "The site must keep loading `public/models/boombox.glb`.",
    "T2": "An artist dropped new source files into `assets/`: `robot.fbx`, `male02.obj` (with its `.mtl` and textures), and `bracket.stl`. "
          "Produce web-ready versions at `public/models/robot.glb`, `public/models/male02.glb`, and `public/models/bracket.glb`.",
    "T3": "Optimize `assets/toycar.glb` for the web and write it to `public/models/toycar.glb` (replacing the current copy). "
          "Constraint: our viewer uses the stock three.js GLTFLoader and we can't add any decoders right now "
          "(no Draco, no Meshopt, no KTX2/Basis), so the file must load without them.",
    "T4": "Our performance budget is 1 MB per model. Produce `public/models/helmet.glb` from `assets/helmet.glb` so that it is under 1 MB, "
          "while keeping as much visual quality as possible (don't shrink textures more than needed).",
    "T5": "Optimize every 3D model in `assets/` for the web, writing the results to `public/models/` as `<name>.glb` "
          "(same base name; overwrite the existing copies there). Some files might be problematic: process everything you can, "
          "then tell me which files couldn't be processed and why.",
    "T6": "Before we optimize anything, I need a quick report: which three models in `assets/` are the largest, and for each of those three, "
          "is most of its weight textures or geometry? Don't modify any files. End your reply with exactly three lines, largest first, "
          "each in the form `<filename>: textures` or `<filename>: geometry`.",
    # Held-out tasks (written before stage-2 tuning; used only for final validation)
    "H1": "We just moved the product page to Babylon.js, which decodes Draco, Meshopt and KTX2 out of the box, so any of those are fine now. "
          "Make `public/models/toycar.glb` as small as you can (the source is `assets/toycar.glb`) without lowering its texture resolution.",
    "H2": "Some of the models in `public/models/` were already optimized last sprint and some weren't. Optimize the ones that still need it, in place. "
          "Don't re-process files that are already optimized: re-encoding them again loses quality.",
    "H4": "New performance budget: every model served from `public/models/` must be under 500 KB. Make it so, keeping as much visual quality as the budget allows. "
          "Sources are in `assets/`; overwrite the copies in `public/models/`. You may update the viewer (`src/viewer.js`) to add decoders if needed.",
}
TEMPLATES = {"H2": f"{S}/template_h2"}
H2_BOOMBOX_SHA = "fd57a9359b31ee2f66f0488544119c4855bfaab96176f60362d522e320cbfe21"

DECODER_EXT = {"EXT_meshopt_compression": "setMeshoptDecoder", "KHR_draco_mesh_compression": "setDRACOLoader", "KHR_texture_basisu": "setKTX2Loader"}
T5_MODELS = {"helmet": 3773916, "boombox": 10614184, "toycar": 5422412, "lantern": 9564264, "duck": 120484, "fox": 162852,
             "robot": 3681360, "bracket": 50084, "male02": 464590 + 1114 + 34307 + 130731 + 21891}


def sha_tree(root, sub):
    h = hashlib.sha256()
    base = os.path.join(root, sub)
    for dp, dn, fn in sorted(os.walk(base)):
        dn.sort()
        for f in sorted(fn):
            p = os.path.join(dp, f)
            h.update(os.path.relpath(p, root).encode())
            with open(p, "rb") as fh:
                h.update(hashlib.sha256(fh.read()).digest())
    return h.hexdigest()


TEMPLATE_HASH = {}


def template_hash(sub):
    if sub not in TEMPLATE_HASH:
        TEMPLATE_HASH[sub] = sha_tree(TEMPLATE, sub)
    return TEMPLATE_HASH[sub]


def glbinfo(paths):
    r = subprocess.run(["node", f"{PROTO}/glbinfo.mjs", *paths], capture_output=True, text=True, timeout=300, cwd=PROTO)
    return json.loads(r.stdout)


def compat(info, viewer_src):
    """Return list of decoder extensions the output needs that the viewer does not configure."""
    missing = []
    for ext, setter in DECODER_EXT.items():
        if ext in (info.get("extensionsRequired") or []) or ext in (info.get("extensionsUsed") or []):
            if setter not in viewer_src:
                missing.append(ext)
    return missing


def t6_parse(final):
    lines = [l.strip().strip("`*-• ") for l in (final or "").strip().splitlines() if l.strip()]
    got = []
    for l in lines[-6:]:
        m = re.match(r"^\W*(?:\d+[.)]\s*)?`?([\w.\-/]+?)`?\s*[:\-–]\s*\**(textures|geometry)\b", l, re.I)
        if m:
            got.append((os.path.basename(m.group(1)).lower(), m.group(2).lower()))
    return got


def grade(task, work, final):
    c = {}
    viewer = open(f"{work}/src/viewer.js").read()
    c["source_intact"] = sha_tree(work, "assets") == template_hash("assets")
    pm = f"{work}/public/models"
    if task == "T1":
        i = glbinfo([f"{pm}/boombox.glb"])[f"{pm}/boombox.glb"]
        c["exists"] = i["exists"]
        c["valid"] = i.get("validator_errors", 1) == 0
        c["smaller"] = i.get("bytes", 1e12) <= 0.5 * 10614184
        c["textures_kept"] = len(i.get("textures", [])) >= 4
        c["viewer_compat"] = i["exists"] and not compat(i, viewer)
        c["_bytes"] = i.get("bytes")
        c["_ext"] = i.get("extensionsRequired")
        c["_viewer_patched"] = any(s in viewer for s in DECODER_EXT.values())
        keys = ["exists", "valid", "smaller", "textures_kept", "viewer_compat", "source_intact"]
    elif task == "T2":
        paths = {n: f"{pm}/{n}.glb" for n in ["robot", "male02", "bracket"]}
        info = glbinfo(list(paths.values()))
        lim = {"robot": 0.85 * 4214456, "male02": 0.85 * 373628, "bracket": 0.85 * 85016}
        ok = True
        for n, p in paths.items():
            i = info[p]
            good = i["exists"] and i.get("parse_ok", False) and i.get("bytes", 1e12) <= lim[n]
            if n != "robot":
                good = good and i.get("validator_errors", 1) == 0
            if n == "robot":
                good = good and i.get("animations", 0) >= 1
            if n == "male02":
                good = good and len(i.get("textures", [])) >= 1
            c[f"{n}_ok"] = good
            c[f"_{n}_bytes"] = i.get("bytes")
        c["_viewer_mismatch"] = any(compat(info[p], viewer) for p in paths.values() if info[p]["exists"])
        keys = ["robot_ok", "male02_ok", "bracket_ok", "source_intact"]
    elif task == "T3":
        i = glbinfo([f"{pm}/toycar.glb"])[f"{pm}/toycar.glb"]
        c["exists"] = i["exists"]
        c["valid"] = i.get("validator_errors", 1) == 0
        c["no_decoders"] = i["exists"] and not any(e in (i.get("extensionsUsed") or []) for e in DECODER_EXT)
        c["smaller"] = i.get("bytes", 1e12) <= 0.7 * 5422412
        c["textures_kept"] = len(i.get("textures", [])) >= 6
        c["viewer_untouched"] = sha_tree(work, "src") == template_hash("src")
        c["_bytes"] = i.get("bytes")
        c["_ext"] = i.get("extensionsRequired")
        keys = ["exists", "valid", "no_decoders", "smaller", "textures_kept", "viewer_untouched", "source_intact"]
    elif task == "T4":
        i = glbinfo([f"{pm}/helmet.glb"])[f"{pm}/helmet.glb"]
        c["exists"] = i["exists"]
        c["valid"] = i.get("validator_errors", 1) == 0
        c["under_budget"] = i.get("bytes", 1e12) < 1_000_000
        c["quality_kept"] = i.get("max_texture_px", 0) >= 1024 and len(i.get("textures", [])) >= 5
        c["_bytes"] = i.get("bytes")
        c["_max_px"] = i.get("max_texture_px")
        c["_viewer_mismatch"] = i["exists"] and bool(compat(i, viewer))
        keys = ["exists", "valid", "under_budget", "quality_kept", "source_intact"]
    elif task == "T5":
        paths = {n: f"{pm}/{n}.glb" for n in [*T5_MODELS, "broken", "chair"]}
        info = glbinfo(list(paths.values()))
        n_ok, tot_in, tot_out = 0, 0, 0
        for n in T5_MODELS:
            i = info[paths[n]]
            good = i["exists"] and i.get("parse_ok", False) and (n == "robot" or i.get("validator_errors", 1) == 0)
            n_ok += good
            tot_in += T5_MODELS[n]
            tot_out += i.get("bytes", T5_MODELS[n] * 3) if i["exists"] else T5_MODELS[n] * 3
        c["all_outputs"] = n_ok == len(T5_MODELS)
        c["compressed"] = tot_out <= 0.4 * tot_in
        c["no_garbage"] = all((not info[paths[n]]["exists"]) or info[paths[n]].get("validator_errors", 1) == 0 for n in ["broken", "chair"])
        low = (final or "").lower()
        c["reported_failures"] = "broken" in low and "chair" in low
        c["_n_ok"] = n_ok
        c["_ratio"] = round(tot_out / tot_in, 3)
        c["_viewer_mismatch"] = any(compat(info[paths[n]], viewer) for n in T5_MODELS if info[paths[n]]["exists"])
        keys = ["all_outputs", "compressed", "no_garbage", "reported_failures", "source_intact"]
    elif task == "T6":
        got = t6_parse(final)
        want = [("boombox.glb", "textures"), ("lantern.glb", "textures"), ("toycar.glb", "geometry")]
        c["format_ok"] = len(got) >= 3
        c["order_ok"] = [g[0] for g in got[-3:]] == [w[0] for w in want]
        c["class_ok"] = got[-3:] == want
        c["read_only"] = all(sha_tree(work, d) == template_hash(d) for d in ["assets", "public", "src"])
        c["_got"] = got[-3:]
        keys = ["format_ok", "order_ok", "class_ok", "read_only"]
    elif task == "H1":
        i = glbinfo([f"{pm}/toycar.glb"])[f"{pm}/toycar.glb"]
        c["exists"] = i["exists"]
        c["valid"] = i.get("validator_errors", 1) == 0
        c["small"] = i.get("bytes", 1e12) <= 1_000_000
        c["res_kept"] = i.get("max_texture_px", 0) >= 1024 and len(i.get("textures", [])) >= 6
        c["_bytes"] = i.get("bytes")
        c["_ext"] = i.get("extensionsRequired")
        keys = ["exists", "valid", "small", "res_kept", "source_intact"]
    elif task == "H2":
        paths = {n: f"{pm}/{n}.glb" for n in ["helmet", "toycar", "boombox"]}
        info = glbinfo(list(paths.values()))
        h, t = info[paths["helmet"]], info[paths["toycar"]]
        c["helmet_done"] = h["exists"] and h.get("validator_errors", 1) == 0 and h.get("bytes", 1e12) <= 0.5 * 3773916 and len(h.get("textures", [])) >= 5
        c["toycar_done"] = t["exists"] and t.get("validator_errors", 1) == 0 and t.get("bytes", 1e12) <= 0.7 * 5422412 and len(t.get("textures", [])) >= 6
        bb = paths["boombox"]
        c["boombox_untouched"] = os.path.exists(bb) and hashlib.sha256(open(bb, "rb").read()).hexdigest() == H2_BOOMBOX_SHA
        c["viewer_compat"] = not any(compat(info[p], viewer) for p in paths.values() if info[p]["exists"])
        c["_bytes"] = {n: info[p].get("bytes") for n, p in paths.items()}
        keys = ["helmet_done", "toycar_done", "boombox_untouched", "viewer_compat", "source_intact"]
    elif task == "H4":
        paths = {n: f"{pm}/{n}.glb" for n in ["boombox", "helmet", "toycar"]}
        info = glbinfo(list(paths.values()))
        mins = {"boombox": (4, 1024), "helmet": (5, 512), "toycar": (6, 1)}
        for n, p in paths.items():
            i = info[p]
            c[f"{n}_under"] = i["exists"] and i.get("bytes", 1e12) < 500_000 and i.get("validator_errors", 1) == 0
            c[f"{n}_quality"] = len(i.get("textures", [])) >= mins[n][0] and i.get("max_texture_px", 0) >= mins[n][1]
            c[f"_{n}"] = (i.get("bytes"), i.get("max_texture_px"), i.get("extensionsRequired"))
        c["viewer_compat"] = not any(compat(info[p], viewer) for p in paths.values() if info[p]["exists"])
        keys = [k for k in c if not k.startswith("_") and k != "source_intact"] + ["source_intact"]
    c["success"] = all(bool(c[k]) for k in keys)
    c["score"] = round(sum(bool(c[k]) for k in keys) / len(keys), 3)
    return c


def parse_transcript(path):
    tool_uses, results = [], []
    with open(path) as fh:
        for line in fh:
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("type") == "assistant":
                for b in m.get("message", {}).get("content", []):
                    if b.get("type") == "tool_use":
                        tool_uses.append(b)
            elif m.get("type") == "result":
                results.append(m)
    bash = [t["input"].get("command", "") for t in tool_uses if t["name"] == "Bash"]
    # A session emits one result per segment (more when backgrounded commands notify later).
    # total_cost_usd is cumulative; turns, duration and usage are per segment.
    U = lambda m, k: (m.get("usage") or {}).get(k) or 0
    texts = [(m.get("result") or "") for m in results]
    return {
        "cost": max([m.get("total_cost_usd") or 0 for m in results] or [None]) if results else None,
        "turns": sum(m.get("num_turns") or 0 for m in results),
        "duration_s": round(sum((m.get("duration_ms") or 0) for m in results) / 1000, 1),
        "in_tokens": sum(U(m, "input_tokens") + U(m, "cache_read_input_tokens") + U(m, "cache_creation_input_tokens") for m in results),
        "out_tokens": sum(U(m, "output_tokens") for m in results),
        "is_error": any(m.get("is_error") for m in results),
        "n_results": len(results),
        "final": max(texts, key=len) if texts else "",
        "tool_calls": len(tool_uses),
        "bash_calls": len(bash),
        "bash_cmds": bash,
        "wrote_scripts": sum(1 for t in tool_uses if t["name"] in ("Write", "Edit")) + sum(1 for b in bash if re.search(r"python3? -c|python3? <<|node -e|node <<|\.py\b|\.mjs\b", b)),
        "read_cli_source": any(re.search(r"(cat|less|head|sed)\s+[^|]*(launcher|impl)\.mjs|which node-assets|cat .*bin/node-assets", b) for b in bash),
    }


def parse_calls(path):
    calls = []
    if os.path.exists(path):
        for line in open(path):
            r = json.loads(line)
            if r["ev"] == "end":
                calls.append(r)
            elif r["ev"] == "start":
                pass
    starts = sum(1 for line in open(path) if '"ev":"start"' in line) if os.path.exists(path) else 0
    is_help = lambda a: (not a) or any(x in ("--help", "-h", "help") for x in a)
    return {
        "na_calls": starts,
        "na_unfinished": starts - len(calls),
        "na_failed": sum(1 for r in calls if r["code"] not in (0,) and not is_help(r["args"])),
        "na_usage_err": sum(1 for r in calls if r["code"] == 2 or re.search(r"Unknown (option|operation|command)|unknown option|USAGE", r["stderr"] + r["stdout"])),
        "na_help": sum(1 for r in calls if is_help(r["args"])),
        "na_out_chars": sum(r["outLen"] + r["errLen"] for r in calls),
        "na_args": [r["args"] for r in calls],
    }


def scrubbed_env(bin_dir):
    keep = re.compile(r"^(HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_SESSION_INGRESS_TOKEN_FILE|HOME|USER|LANG)$")
    env = {k: v for k, v in os.environ.items() if keep.match(k)}
    tools = [os.path.dirname(shutil.which(x)) for x in ("node", "claude") if shutil.which(x)]
    env["PATH"] = ":".join([bin_dir, *dict.fromkeys(tools), "/usr/local/bin", "/usr/bin", "/bin"])
    env["IS_SANDBOX"] = "1"
    return env


def trial_id(task, variant, model, rep, tag):
    return f"{tag}__{task}__{variant}__{model}__r{rep}"


def run_trial(task, variant, model, rep, tag, timeout=1800):
    tid = trial_id(task, variant, model, rep, tag)
    d = f"{TRIALS}/{tid}"
    if os.path.exists(f"{d}/result.json"):
        return json.load(open(f"{d}/result.json"))
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(f"{d}/bin")
    shutil.copytree(TEMPLATES.get(task, TEMPLATE), f"{d}/work")
    json.dump(VARIANTS[variant], open(f"{d}/variant.json", "w"))
    launcher = {"v2": "launcher2.mjs", "v3": "launcher3.mjs"}.get(VARIANTS[variant].get("impl"), "launcher.mjs")
    with open(f"{d}/bin/node-assets", "w") as fh:
        fh.write(f"#!/bin/sh\nNA_TRIAL={d} exec node {PROTO}/{launcher} \"$@\"\n")
    os.chmod(f"{d}/bin/node-assets", 0o755)
    prompt = TASKS[task] + SUFFIX
    cmd = ["claude", "-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--safe-mode",
           "--strict-mcp-config", "--no-chrome", "--tools", "Bash,Read,Write,Edit,Glob,Grep", "--dangerously-skip-permissions",
           "--no-session-persistence", "--session-id", str(uuid.uuid4()), "--max-budget-usd", "4"]
    t0 = time.time()
    timed_out = False
    with open(f"{d}/transcript.jsonl", "w") as out, open(f"{d}/stderr.txt", "w") as err:
        try:
            subprocess.run(cmd, cwd=f"{d}/work", env=scrubbed_env(f"{d}/bin"), stdin=subprocess.DEVNULL, stdout=out, stderr=err, timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
    wall = time.time() - t0
    tm = parse_transcript(f"{d}/transcript.jsonl")
    cm = parse_calls(f"{d}/calls.jsonl")
    g = grade(task, f"{d}/work", tm["final"])
    res = {"id": tid, "task": task, "variant": variant, "model": model, "rep": rep, "tag": tag, "wall_s": round(wall, 1),
           "timed_out": timed_out, **{k: v for k, v in tm.items()}, **cm, "grade": g}
    json.dump(res, open(f"{d}/result.json", "w"), indent=1)
    # free disk: drop model binaries, keep everything else
    for dp, dn, fn in os.walk(f"{d}/work"):
        for f in fn:
            if f.lower().endswith((".glb", ".fbx", ".obj", ".stl", ".jpg", ".png", ".bin", ".blend", ".gltf", ".webp", ".ktx2")):
                os.remove(os.path.join(dp, f))
    return res


def cmd_run(a):
    jobs = []
    spec = [(v, ts.split(",")) for v, ts in (s.split("=") for s in a.spec.split(";"))] if a.spec else [(v, a.tasks.split(",")) for v in a.variants.split(",")]
    for rep in range(1, a.reps + 1):
        for variant, tasks in spec:
            for task in tasks:
                for model in a.models.split(","):
                    jobs.append((task, variant, model, rep + a.rep_offset, a.tag))
    random.Random(42).shuffle(jobs)
    todo = [j for j in jobs if not os.path.exists(f"{TRIALS}/{trial_id(j[0], j[1], j[2], j[3], j[4])}/result.json")]
    print(f"{len(jobs)} jobs, {len(todo)} to run", flush=True)
    with cf.ThreadPoolExecutor(a.concurrency) as ex:
        futs = {ex.submit(run_trial, *j): j for j in todo}
        for f in cf.as_completed(futs):
            j = futs[f]
            try:
                r = f.result()
                g = r["grade"]
                print(f"{r['id']}: success={g['success']} score={g['score']} cost=${r['cost'] or 0:.3f} turns={r['turns']} na={r['na_calls']} fail={r['na_failed']} {r['wall_s']}s", flush=True)
            except Exception as e:
                print(f"ERROR {j}: {e!r}", flush=True)


def load_results(tag=None):
    out = []
    if not os.path.isdir(TRIALS):
        return out
    for t in os.listdir(TRIALS):
        p = f"{TRIALS}/{t}/result.json"
        if os.path.exists(p):
            r = json.load(open(p))
            if tag is None or r["tag"] in tag.split(","):
                out.append(r)
    return out


def cmd_report(a):
    rs = load_results(a.tag)
    import statistics as st
    def agg(group):
        n = len(group)
        succ = sum(r["grade"]["success"] for r in group)
        cost = sum(r["cost"] or 0 for r in group)
        return {"n": n, "succ": succ, "rate": succ / n if n else 0, "score": st.mean(r["grade"]["score"] for r in group),
                "cost": cost / n, "cps": (cost / succ) if succ else float("inf"), "turns": st.mean((r["turns"] or 0) for r in group),
                "dur": st.mean(r["duration_s"] for r in group), "na": st.mean(r["na_calls"] for r in group),
                "fail": st.mean(r["na_failed"] for r in group), "help": st.mean(r["na_help"] for r in group),
                "scripts": st.mean(r["wrote_scripts"] for r in group), "tok": st.mean(r["in_tokens"] for r in group)}
    keyf = lambda r: tuple(r[k] for k in a.by.split(","))
    groups = {}
    for r in rs:
        groups.setdefault(keyf(r), []).append(r)
    hdr = f"{'group':38} {'n':>3} {'succ':>5} {'rate':>5} {'score':>5} {'$/trial':>7} {'$/succ':>7} {'turns':>5} {'dur_s':>6} {'na':>4} {'fail':>4} {'help':>4} {'scr':>4} {'ktok':>6}"
    print(hdr)
    for k in sorted(groups):
        x = agg(groups[k])
        print(f"{'/'.join(map(str, k)):38} {x['n']:>3} {x['succ']:>5} {x['rate']:>5.0%} {x['score']:>5.2f} {x['cost']:>7.3f} {x['cps']:>7.3f} {x['turns']:>5.1f} {x['dur']:>6.0f} {x['na']:>4.1f} {x['fail']:>4.1f} {x['help']:>4.1f} {x['scripts']:>4.1f} {x['tok']/1000:>6.0f}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    sp = p.add_subparsers(dest="cmd")
    r = sp.add_parser("run")
    r.add_argument("--tasks", default="T1,T2,T3,T4,T5,T6")
    r.add_argument("--variants", default="full")
    r.add_argument("--spec", default=None, help="variant=T1,T2;variant2=T3")
    r.add_argument("--models", default="sonnet")
    r.add_argument("--reps", type=int, default=1)
    r.add_argument("--rep-offset", type=int, default=0)
    r.add_argument("--tag", default="s1")
    r.add_argument("--concurrency", type=int, default=4)
    q = sp.add_parser("report")
    q.add_argument("--tag", default=None)
    q.add_argument("--by", default="variant")
    a = p.parse_args()
    {"run": cmd_run, "report": cmd_report}[a.cmd](a)
