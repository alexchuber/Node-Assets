import sys, glob, os, re
import numpy as np
sys.path.insert(0, '.')
from compare import load, ssim_map
from scipy.ndimage import binary_dilation
T = 64
def worst_tile(ref, cand):
    r, mr = load(ref); c, mc = load(cand)
    mask = binary_dilation(mr | mc, iterations=3)
    lum = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])
    sm = ssim_map(lum(r), lum(c)); worst = 1.0
    for y in range(0, sm.shape[0], T):
        for x in range(0, sm.shape[1], T):
            m = mask[y:y+T, x:x+T]
            if m.mean() > 0.25: worst = min(worst, sm[y:y+T, x:x+T][m].mean())
    return worst
for d, model in [('out512','helmet'),('out512','toycar'),('out1024','helmet')]:
    refs = sorted(glob.glob(f'{d}/{model}/{model}-orig__v*.png'))
    for n in ['q2048','q1024','q512','q256','q64','draco','meshopt','ktx2']:
        c = [rf.replace(f'{model}-orig__', f'{model}-{n}__') for rf in refs]
        if not os.path.exists(c[0]): continue
        print(f'{d}/{model}-{n:8} worst-tile SSIM {min(worst_tile(a,b) for a,b in zip(refs,c)):.3f}')
