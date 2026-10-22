#!/usr/bin/env python3
"""Fit the load model (non-negative least squares) to calibration rows; report fit quality; print COEF for loadmodel.mjs.
usage: fit_load.py calib.json"""
import json, sys
import numpy as np
from scipy.optimize import nnls

rows = json.load(open(sys.argv[1]))
keys = ["draco", "meshopt", "ktx2", "draco_mb", "meshopt_mb", "plain_mb", "mp_avif", "mp_webp", "mp_jpeg", "mp_png", "mp_ktx2"]
X = np.array([[1.0] + [r[k] for k in keys] for r in rows])
y = np.array([r["ms"] for r in rows])
coef, _ = nnls(X, y)
pred = X @ coef
res = y - pred
r2 = 1 - (res ** 2).sum() / ((y - y.mean()) ** 2).sum()
print(f"n={len(rows)}  R2={r2:.3f}  MAE={np.abs(res).mean():.1f} ms  max|err|={np.abs(res).max():.1f} ms  median measured={np.median(y):.0f} ms")
# leave-one-model-out check: fit on the other models, predict this one
for m in sorted({r["input"] for r in rows}):
    tr = [i for i, r in enumerate(rows) if r["input"] != m]
    te = [i for i, r in enumerate(rows) if r["input"] == m]
    c, _ = nnls(X[tr], y[tr])
    e = y[te] - X[te] @ c
    rank = np.corrcoef(np.argsort(np.argsort(y[te])), np.argsort(np.argsort(X[te] @ c)))[0, 1]
    print(f"  held-out {m}: MAE={np.abs(e).mean():.1f} ms, rank corr={rank:.2f}")
for r, p in sorted(zip(rows, pred), key=lambda x: -abs(x[0]['ms'] - x[1]))[:5]:
    print(f"  worst: {r['input']} {r['tex']}@{r['size']} {r['geo']}: measured {r['ms']:.0f} model {p:.0f} (spread {r['spread']:.0f})")
print("export const COEF = {" + ", ".join(f"{k}: {round(float(v), 2)}" for k, v in zip(["c0"] + keys, coef)) + "};")
