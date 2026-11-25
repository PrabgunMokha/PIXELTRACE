"""Exploratory visual evidence: frequency spectrum and noise residual.

Neither is used in the verdict. Upsampling in some generators leaves periodic traces in the spectrum, but real photographs
also show many spectral shapes, so these views are for inspection only.
"""

from __future__ import annotations

import cv2
import numpy as np


def _centre_crop(gray: np.ndarray, side: int = 512) -> np.ndarray:
    h, w = gray.shape
    s = min(side, h, w)
    top, left = (h - s) // 2, (w - s) // 2
    return gray[top : top + s, left : left + s]


def spectrum_report(rgb: np.ndarray) -> dict:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32)
    crop = _centre_crop(gray)
    size = crop.shape[0]
    window = np.outer(np.hanning(size), np.hanning(size)).astype(np.float32)
    power = np.abs(np.fft.fftshift(np.fft.fft2((crop - crop.mean()) * window))) ** 2
    log_power = np.log1p(power)
    yy, xx = np.indices(power.shape)
    radius = np.hypot(yy - size / 2, xx - size / 2) / (size / 2)
    bins = 48
    edges = np.linspace(0, 1, bins + 1)
    radial = np.array([log_power[(radius >= edges[i]) & (radius < edges[i + 1])].mean() if np.any((radius >= edges[i]) & (radius < edges[i + 1])) else 0.0 for i in range(bins)])
    lo, hi = float(radial.min()), float(radial.max())
    normalised = ((radial - lo) / max(hi - lo, 1e-6)).round(4).tolist()
    xs = np.arange(bins, dtype=np.float32)
    slope, intercept = np.polyfit(xs[2:], radial[2:], 1)
    residual = radial[2:] - (slope * xs[2:] + intercept)
    peak_score = float(np.max(residual) / (np.std(residual) + 1e-6))
    high = float(power[radius >= 0.5].sum() / max(power.sum(), 1e-6))
    small = cv2.resize(log_power.astype(np.float32), (64, 64), interpolation=cv2.INTER_AREA)
    top = float(np.percentile(small, 99.5))
    floor = float(np.percentile(small, 5))
    grid = np.clip((small - floor) / max(top - floor, 1e-6), 0, 1)
    return {
        "radial": normalised,
        "grid": {"width": 64, "height": 64, "values": [round(float(v), 3) for v in grid.ravel()]},
        "slope": round(float(slope), 4),
        "peak_score": round(peak_score, 2),
        "high_frequency_share": round(high * 100, 4),
        "crop": int(size),
        "note": "Exploratory view, not used in the verdict. Periodic peaks can come from upsampling, resizing or compression.",
    }


def noise_residual(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Returns (raw residual, heat-map RGB image, mean residual)."""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    residual = np.abs(gray.astype(np.float32) - cv2.medianBlur(gray, 3).astype(np.float32))
    top = max(float(np.percentile(residual, 99)), 1.0)
    heat = cv2.applyColorMap((np.clip(residual / top, 0, 1) * 255).astype(np.uint8), cv2.COLORMAP_INFERNO)
    return residual, cv2.cvtColor(heat, cv2.COLOR_BGR2RGB), float(residual.mean())
