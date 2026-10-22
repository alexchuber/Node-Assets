#!/usr/bin/env python3
"""Print the CLI call sequence of trials: duration, exit code, args, and key stderr/stdout notes."""
import json, sys, os, glob
S = os.path.dirname(os.path.abspath(__file__))
pats = sys.argv[1:] or ["*"]
for pat in pats:
    for d in sorted(glob.glob(f"{os.environ.get('NA_TRIALS', S + '/trials2')}/{pat}")):
        f = f"{d}/calls.jsonl"
        if not os.path.exists(f): continue
        res = json.load(open(f"{d}/result.json")) if os.path.exists(f"{d}/result.json") else None
        print(f"== {os.path.basename(d)}" + (f"  wall={res['wall_s']}s turns={res['turns']} cost=${res['cost']:.3f}" if res else "  (running)"))
        for l in open(f):
            c = json.loads(l)
            if c["ev"] != "end": continue
            note = ""
            out = c.get("stdout", "")
            if "time limit" in out or "time_limit" in out: note += " [time-limit hit]"
            if c["code"] not in (0,):
                first = out.strip().splitlines()[0] if out.strip() else c.get("stderr","").strip()[-200:]
                note += f" !! {first[:160]}"
            print(f"  {c['ms']/1000:7.1f}s  rc={c['code']}  {' '.join(c['args'])[:170]}{note}")
