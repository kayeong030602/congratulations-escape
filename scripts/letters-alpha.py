"""
(11/20 추가) 단색(그러데이션) 바탕 위 글씨 그림 → 바탕이 투명한 글씨 + 빛 번짐(glow) 그림.

  python -I scripts/letters-alpha.py <원본.png> <글씨.webp> <빛번짐.webp> <가로 픽셀>

- 바탕: 가장자리 띠의 색으로 평면(가로·세로 기울기)을 맞춰 그 자리의 바탕색을 계산해요(원본 바탕이 회색 그러데이션이라).
- 투명도: 바탕색과 얼마나 다른지로. 글씨 가장자리의 색은 안쪽 글씨 색을 번져 채워 회색 테두리가 안 남게 해요.
- 빛 번짐: 글씨를 크게 흐린 그림(색도 같이 번짐) — 게임이 홀로그램 빛으로 더해요.
- 글씨 둘레를 여유 있게 남기고 잘라요(빛 번짐이 잘리지 않게).
"""
import sys

import numpy as np
from PIL import Image, ImageFilter

src, out, glow_out, width = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])

im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
h, w, _ = im.shape
ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)

# 바탕색 평면: 가장자리 8px 띠로 맞춤
ring = np.zeros((h, w), bool)
ring[:8, :] = ring[-8:, :] = True
ring[:, :8] = ring[:, -8:] = True
A = np.stack([np.ones(ring.sum()), xs[ring] / w, ys[ring] / h], 1)
bg = np.zeros_like(im)
for ch in range(3):
    coef, *_ = np.linalg.lstsq(A, im[..., ch][ring], rcond=None)
    bg[..., ch] = coef[0] + coef[1] * xs / w + coef[2] * ys / h

d = np.sqrt(((im - bg) ** 2).sum(-1))
alpha = np.clip((d - 14.0) / (120.0 - 14.0), 0.0, 1.0)


def blur(a: np.ndarray, r: float) -> np.ndarray:
    """0~1 실수 배열을 흐려요(8비트로 바꿔 PIL로)."""
    img = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    return np.asarray(img.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0


def spread(color: np.ndarray, mask: np.ndarray, r: float) -> np.ndarray:
    """mask(0~1) 안쪽 색을 둘레로 번져요: blur(색×mask) / blur(mask)."""
    m = blur(mask, r)
    outc = np.zeros_like(color)
    for ch in range(3):
        outc[..., ch] = blur(color[..., ch] / 255.0 * mask, r) / np.maximum(m, 1e-4) * 255.0
    return outc, m


# 글씨 색: 확실한 안쪽(alpha > 0.9)의 색을 가장자리로 번져 채움
solid = (alpha > 0.9).astype(np.float32)
fill, _ = spread(im, solid, 3.0)
col = np.where((alpha > 0.9)[..., None], im, fill)

# 빛 번짐: 글씨 높이의 6%쯤 흐림(색도 같이)
glow_col, glow_a = spread(col, alpha, max(6.0, h * 0.035))
glow_a = np.clip(glow_a / max(1e-4, glow_a.max()) * 0.95, 0, 1)

# 자르기: 글씨 둘레 + 여유(빛 번짐 자리)
ys_on, xs_on = np.nonzero(alpha > 0.04)
pad = int((ys_on.max() - ys_on.min()) * 0.22)
x0, x1 = max(0, xs_on.min() - pad), min(w, xs_on.max() + pad)
y0, y1 = max(0, ys_on.min() - pad), min(h, ys_on.max() + pad)

def save(rgb: np.ndarray, a: np.ndarray, path: str, wpx: int):
    rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(a * 255, 0, 255)])[y0:y1, x0:x1].astype(np.uint8)
    img = Image.fromarray(rgba, 'RGBA')
    hpx = round(img.height * wpx / img.width)
    img = img.resize((wpx, hpx), Image.LANCZOS)
    img.save(path, 'WEBP', quality=92, alpha_quality=100, method=6)
    return img.size

s1 = save(col, alpha, out, width)
s2 = save(glow_col, glow_a, glow_out, max(256, width // 2))
print(f'{out} {s1[0]}x{s1[1]} · {glow_out} {s2[0]}x{s2[1]} · 자른 곳 {x0},{y0} ~ {x1},{y1} (원본 {w}x{h})')
