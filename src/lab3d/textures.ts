/**
 * 재질 무늬 — 사진이 없어서 코드로 만든 임시 텍스처예요.
 * (촬영 장소에 다시 갈 수 없으니, 나중에 무료 공개 사진 텍스처로 바꿀 자리)
 * 밝기는 구운 조명이 정하고, 여기서는 표면 색과 결만 만들어요.
 */
import * as THREE from 'three';
import type { MatId } from './room.ts';

/** 재질별 기본 색(sRGB)과 무늬 한 장이 덮는 크기(미터). */
export const MATS: Record<MatId, { color: string; tile: number }> = {
  white: { color: '#e6e3dc', tile: 1.6 },
  orange: { color: '#d98a2b', tile: 1.6 },
  green: { color: '#9bb53a', tile: 1.6 },
  carpet: { color: '#6a584c', tile: 0.7 },
  ceiling: { color: '#e9e7e1', tile: 0.6 },
  base: { color: '#2b323c', tile: 1.0 },
  speckle: { color: '#e5e2dc', tile: 0.6 }, // (11/17 추가)
  // (11/19 추가) 5단계: 따뜻한 방(영상의 베이지 벽), 갈색 문, 창밖 복도(어두운 회색), 창살
  beige: { color: '#e6cfae', tile: 1.6 }, // (11/19 3차) 조금 밝게
  wood: { color: '#6a4934', tile: 1.0 },
  gray: { color: '#9a9690', tile: 1.6 },
  metal: { color: '#2e2e30', tile: 1.0 },
  // (11/19 본 게임 6단계 추가) 계단실(영상 01:31~): 어두운 올리브색 벽, 테라초(흰 바탕에 회색·검정·갈색 잔 조각) 바닥·계단
  olive: { color: '#7c8063', tile: 1.6 },
  terrazzo: { color: '#d9d5cc', tile: 0.5 },
  // (11/20 본 게임 6단계 2차 추가) 계단실 벽: 차가운 흰색 페인트 시멘트 블록(블록 40×20cm, 엇갈려 쌓음). 무늬 한 장 = 1.6m
  block: { color: '#d3d7d9', tile: 1.6 },
};

// 씨앗이 정해진 난수(매번 같은 무늬)
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 이음매 없이 반복되는 큰 얼룩(-1~1). */
function blotch(size: number, seed: number) {
  const r = rng(seed);
  const waves = Array.from({ length: 7 }, () => ({
    ax: Math.round(r() * 4 - 2), ay: Math.round(r() * 4 - 2), ph: r() * 6.283, amp: 0.4 + r() * 0.6,
  })).filter((w) => w.ax || w.ay);
  const total = waves.reduce((s, w) => s + w.amp, 0) || 1;
  return (x: number, y: number) =>
    waves.reduce((s, w) => s + w.amp * Math.sin((6.283 * (w.ax * x + w.ay * y)) / size + w.ph), 0) / total;
}

/**
 * (11/17 변경) 생성기: 16줄마다 쉬어 갈 수 있어요(yield). 큰 무늬(512×512)는 PC에서도 0.07초쯤 걸려서,
 * 본 게임은 이걸 나눠 만들어 폰에서 화면이 멈추지 않게 해요(build.ts의 buildSpaceAsync). 한 번에 만들 땐 makeTexture.
 */
function* make(size: number, px: (x: number, y: number) => number, hex: string): Generator<void, THREE.CanvasTexture> {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const c = new THREE.Color(hex).convertLinearToSRGB(); // 캔버스에는 sRGB 값으로 적어요
  for (let y = 0; y < size; y++) {
    if (y % 16 === 15) yield;
    for (let x = 0; x < size; x++) {
      const k = px(x, y);
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, c.r * 255 * k));
      img.data[i + 1] = Math.max(0, Math.min(255, c.g * 255 * k));
      img.data[i + 2] = Math.max(0, Math.min(255, c.b * 255 * k));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 한 번에 만들어요(시험 방). */
export function makeTexture(id: MatId): THREE.CanvasTexture {
  const g = makeTextureGen(id);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** 나눠 만들 수 있는 판. */
export function* makeTextureGen(id: MatId): Generator<void, THREE.CanvasTexture> {
  const { color } = MATS[id];
  const r = rng(id.length * 7919 + id.charCodeAt(0));
  switch (id) {
    case 'carpet': {
      // 짧은 털 카펫: 굵은 알갱이 + 은은한 얼룩
      const b = blotch(256, 11);
      return yield* make(256, (x, y) => 0.8 + r() * 0.42 + b(x, y) * 0.07 + (r() > 0.97 ? 0.25 : 0), color);
    }
    case 'ceiling': {
      // 천장재 한 칸(60cm): 테두리 줄 + 작은 구멍
      const S = 128;
      return yield* make(S, (x, y) => {
        const edge = x < 2 || y < 2 || x > S - 3 || y > S - 3;
        return (edge ? 0.72 : 1) * (0.97 + r() * 0.05) * (r() > 0.985 ? 0.8 : 1);
      }, color);
    }
    case 'base':
    case 'metal':
      return yield* make(64, () => 0.95 + r() * 0.1, color);
    case 'wood': {
      // (11/19 추가) 갈색 문: 세로 나뭇결(굵기가 들쭉날쭉한 줄) + 은은한 얼룩
      const S = 256;
      const b = blotch(S, 5);
      const lines = Array.from({ length: 10 }, () => ({ f: 8 + Math.floor(r() * 30), ph: r() * 6.283, a: 0.006 + r() * 0.012 }));
      return yield* make(S, (x, y) => 0.97 + lines.reduce((s, l) => s + l.a * Math.sin((6.283 * l.f * (x + b(x, y) * 1.5)) / S + l.ph), 0) + b(x, y) * 0.03 + r() * 0.025, color);
    }
    case 'speckle': {
      // (11/17 추가) 점박이 흰 판(흡음 천장재 같은 면): 크고 작은 길쭉한 검은 점을 흩뿌려요. 한 장 = 60cm
      const S = 512;
      const mask = new Float32Array(S * S);
      for (let i = 0; i < 2200; i++) {
        const cx = r() * S, cy = r() * S, rx = 1 + r() * 2.6, ry = rx * (0.4 + r() * 0.6), a = r() * Math.PI, dark = 0.3 + r() * 0.35;
        const ca = Math.cos(a), sa = Math.sin(a), R = Math.ceil(rx) + 1;
        for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
          const u = (x * ca + y * sa) / rx, v = (-x * sa + y * ca) / ry;
          const d = u * u + v * v;
          if (d > 1) continue;
          const k = ((Math.floor(cy) + y + S) % S) * S + ((Math.floor(cx) + x + S) % S);
          mask[k] = Math.max(mask[k], dark * (1 - d * d));
        }
      }
      return yield* make(S, (x, y) => (0.975 + r() * 0.04) * (1 - mask[y * S + x]), color);
    }
    case 'terrazzo': {
      // (11/19 본 게임 6단계 추가) 테라초: 잔 돌 조각(회색·검정·갈색, 둥글거나 모남)을 촘촘히. 한 장 = 50cm
      const S = 512;
      const tone = new Float32Array(S * S).fill(1);
      for (let i = 0; i < 5200; i++) {
        const cx = r() * S, cy = r() * S, rad = 0.8 + r() * 2.4, k = [0.42, 0.6, 0.72, 0.3][Math.floor(r() * 4)];
        const R = Math.ceil(rad) + 1;
        for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
          if (x * x + y * y > rad * rad * (0.7 + r() * 0.5)) continue;
          tone[((Math.floor(cy) + y + S) % S) * S + ((Math.floor(cx) + x + S) % S)] = k;
        }
      }
      return yield* make(S, (x, y) => (0.97 + r() * 0.05) * tone[y * S + x], color);
    }
    case 'block': {
      // (11/20 본 게임 6단계 2차 추가) 페인트 칠한 시멘트 블록: 가로 줄눈(20cm마다)과 엇갈린 세로 줄눈(40cm마다), 줄눈은 살짝 패여 어둡게.
      // 페인트 아래로 블록의 잔 구멍이 은은하게 비치고, 군데군데 얼룩. 512px = 1.6m → 블록 128×64px
      const S = 512, BW = 128, BH = 64;
      const b = blotch(S, 31);
      return yield* make(S, (x, y) => {
        const row = Math.floor(y / BH);
        const xo = (x + (row % 2 ? BW / 2 : 0)) % BW, yo = y % BH;
        const jx = Math.min(xo, BW - 1 - xo), jy = Math.min(yo, BH - 1 - yo); // 줄눈까지 거리(px)
        const joint = Math.min(jx, jy);
        const k = joint < 2 ? 0.8 : joint < 3 ? 0.9 : jy === 3 ? 1.02 : 1; // 줄눈 + 위쪽 모서리에 살짝 빛
        return k * (0.975 + r() * 0.04 - (r() > 0.992 ? 0.07 : 0)) + b(x, y) * 0.025;
      }, color);
    }
    default: {
      // 페인트 벽: 롤러 결 + 큰 얼룩
      const b = blotch(512, id.charCodeAt(0));
      return yield* make(512, (x, y) => 0.985 + r() * 0.03 + b(x, y) * 0.035, color);
    }
  }
}

/** 점선 문 자리(투명 배경에 점선). */
export function dottedTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 580;
  const ctx = cv.getContext('2d')!;
  ctx.strokeStyle = 'rgba(40,44,50,0.85)';
  ctx.lineWidth = 5;
  ctx.setLineDash([22, 16]);
  ctx.strokeRect(8, 8, 240, 580); // 아래쪽은 바닥에 묻혀서 문 모양(ㄇ)만 보여요
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
