import sys, os, glob, re, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, binary_dilation


def load(p):
    a = np.asarray(Image.open(p).convert("RGBA")).astype(np.float64) / 255
    rgb = a[..., :3] * a[..., 3:4] + 0.5 * (1 - a[..., 3:4])  # composite on mid-gray
    return rgb, a[..., 3] > 0


def ssim_map(x, y, C1=0.01**2, C2=0.03**2):
    mx, my = gaussian_filter(x, 1.5), gaussian_filter(y, 1.5)
    sxx = gaussian_filter(x * x, 1.5) - mx * mx
    syy = gaussian_filter(y * y, 1.5) - my * my
    sxy = gaussian_filter(x * y, 1.5) - mx * my
    return ((2 * mx * my + C1) * (2 * sxy + C2)) / ((mx * mx + my * my + C1) * (sxx + syy + C2))


def compare(ref, cand):
    r, mr = load(ref)
    c, mc = load(cand)
    mask = binary_dilation(mr | mc, iterations=3)
    lum = lambda im: im @ np.array([0.2126, 0.7152, 0.0722])
    s = ssim_map(lum(r), lum(c))[mask].mean()
    mse = ((r - c) ** 2)[mask].mean()
    psnr = 99.0 if mse == 0 else 10 * np.log10(1 / mse)
    changed = (np.abs(r - c).max(-1) > 16 / 255)[mask].mean()
    return s, psnr, changed


def main():
    out = {}
    for d in sys.argv[1:]:
        for model in sorted(os.listdir(d)):
            refs = sorted(glob.glob(f"{d}/{model}/{model}-orig__v*.png"))
            names = sorted({re.sub(r"__v\d+\.png$", "", os.path.basename(p)) for p in glob.glob(f"{d}/{model}/*.png")} - {f"{model}-orig"})
            for n in names:
                vals = [compare(rf, rf.replace(f"{model}-orig__", f"{n}__")) for rf in refs if os.path.exists(rf.replace(f"{model}-orig__", f"{n}__"))]
                v = np.array(vals)
                out[f"{d}/{n}"] = dict(ssim_mean=round(v[:, 0].mean(), 4), ssim_worst=round(v[:, 0].min(), 4), psnr_worst=round(v[:, 1].min(), 1), changed_worst=round(v[:, 2].max() * 100, 2))
    for k, v in out.items():
        print(f"{k:32} SSIM mean {v['ssim_mean']:.4f} worst {v['ssim_worst']:.4f} | PSNR worst {v['psnr_worst']:5.1f} dB | changed px worst {v['changed_worst']:6.2f}%")
    json.dump(out, open("metrics.json", "w"), indent=1)


if __name__ == "__main__":
    main()
