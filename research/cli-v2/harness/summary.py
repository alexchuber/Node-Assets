#!/usr/bin/env python3
"""Summarize graded trials: per variant x model, per task x variant, plus CLI-usage patterns.
usage: summary.py <tag> [--json out.json]"""
import json, os, sys, statistics as st, collections
S = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, S)
import harness2 as H2

tag = sys.argv[1]
rows = []
for r in H2.load_results(tag):
    g = r["grade"]
    calls = []
    f = f"{H2.TRIALS}/{r['id']}/calls.jsonl"
    if os.path.exists(f):
        calls = [c for c in map(json.loads, open(f)) if c["ev"] == "end"]
    cmd = lambda c: c["args"][0] if c["args"] else "(home)"
    real = [c for c in calls if "--help" not in c["args"] and "-h" not in c["args"]]
    tunes = [c for c in real if cmd(c) == "tune"]
    rows.append({
        "id": r["id"], "task": r["task"], "variant": r["variant"], "model": r["model"], "rep": r["rep"],
        "success": bool(g.get("success")), "ratio": g.get("_ratio"), "fid_ok": bool(g.get("fidelity_ok")), "valid": bool(g.get("valid")),
        "wall_s": r["wall_s"], "timed_out": r.get("timed_out"), "turns": r.get("turns"), "cost": r.get("cost") or 0,
        "in_tok": r.get("in_tokens") or 0, "out_tok": r.get("out_tokens") or 0,
        "calls": len(calls), "errors": sum(1 for c in calls if c["code"] not in (0,)),
        "tune": len(tunes), "tune_partial": sum(1 for c in tunes if "search: partial" in c.get("stdout", "") or ",partial," in c.get("stdout", "") or '"partial"' in c.get("stdout", "")),
        "tune_s": round(sum(c["ms"] for c in tunes) / 1000), "optimize": sum(1 for c in real if cmd(c) == "optimize"), "run": sum(1 for c in real if cmd(c) == "run"),
        "against": sum(1 for c in real if cmd(c) == "inspect" and "--against" in c["args"]),
        "na_s": round(sum(c["ms"] for c in calls) / 1000),
    })

def agg(rs):
    n = len(rs)
    if not n:
        return {}
    med = lambda k: round(st.median([x[k] for x in rs if x[k] is not None]), 3) if any(x[k] is not None for x in rs) else None
    return {"n": n, "success": f"{sum(x['success'] for x in rs)}/{n}", "fid_ok": f"{sum(x['fid_ok'] for x in rs)}/{n}", "median_ratio": med("ratio"),
            "median_wall_s": med("wall_s"), "median_cost": med("cost"), "median_turns": med("turns"), "median_in_tok": med("in_tok"), "median_out_tok": med("out_tok"),
            "median_calls": med("calls"), "errors": sum(x["errors"] for x in rs), "timeouts": sum(bool(x["timed_out"]) for x in rs),
            "tune_runs": sum(x["tune"] for x in rs), "tune_partial": sum(x["tune_partial"] for x in rs), "optimize_runs": sum(x["optimize"] for x in rs), "against_runs": sum(x["against"] for x in rs)}

out = {"by_variant_model": {}, "by_task_variant": {}, "by_variant": {}, "rows": rows}
for v in sorted({x["variant"] for x in rows}):
    out["by_variant"][v] = agg([x for x in rows if x["variant"] == v])
    for m in sorted({x["model"] for x in rows}):
        out["by_variant_model"][f"{v}/{m}"] = agg([x for x in rows if x["variant"] == v and x["model"] == m])
for t in sorted({x["task"] for x in rows}):
    for v in sorted({x["variant"] for x in rows}):
        a = agg([x for x in rows if x["task"] == t and x["variant"] == v])
        if a:
            out["by_task_variant"][f"{t}/{v}"] = a
if "--json" in sys.argv:
    json.dump(out, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
for sec in ("by_variant", "by_variant_model", "by_task_variant"):
    print(f"\n## {sec}")
    keys = ["n", "success", "fid_ok", "median_ratio", "median_wall_s", "median_cost", "median_turns", "median_in_tok", "median_calls", "errors", "timeouts", "tune_runs", "tune_partial", "optimize_runs", "against_runs"]
    print("key".ljust(18) + "".join(k[:11].rjust(12) for k in keys))
    for k, a in out[sec].items():
        print(k.ljust(18) + "".join(str(a.get(c)).rjust(12) for c in keys))
print("\n## trials")
for x in sorted(rows, key=lambda x: (x["task"], x["variant"], x["model"], x["rep"])):
    print(f"{x['id']:34s} ok={x['success']!s:5s} ratio={x['ratio']} fid={x['fid_ok']!s:5s} wall={x['wall_s']:7.0f} cost={x['cost']:.3f} turns={x['turns']} tune={x['tune']}({x['tune_partial']}p) opt={x['optimize']} run={x['run']} against={x['against']} err={x['errors']}")
