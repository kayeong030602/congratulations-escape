/**
 * 조명 굽기 — 방을 지을 때 한 번, 빛을 미리 계산해 꼭짓점에 적어 둬요.
 *
 * 실시간 조명을 쓰지 않아서 그리는 부담이 거의 없고(모바일에 유리),
 * 그늘·빛 번짐(주황 벽 옆이 주황빛을 띠는 것)이 들어가서 실사에 가까워져요.
 * Blender 없이 브라우저 안에서 0.5초쯤이면 끝나요.
 *
 *   빛 = 천장등에서 바로 오는 빛(가려지면 그늘) + 다른 면에 한 번 튕겨 오는 빛
 */
import type { V3 } from './room.ts';

export interface Aabb { min: V3; max: V3; albedo: V3 }
export interface BakeLamp { p: V3; hx: number; hz: number; e: V3 }

const N_RAYS = 48;   // 튕겨 오는 빛을 모을 때 쏘는 선의 수
const AMB = 0.22;    // 두 번 이상 튕긴 빛을 어림한 값

// 반구 방향 표본(코사인 가중). 모든 꼭짓점이 같은 표본을 써서 얼룩이 안 생겨요.
const SAMPLES: V3[] = Array.from({ length: N_RAYS }, (_, i) => {
  const u1 = (i + 0.5) / N_RAYS;
  const phi = 2 * Math.PI * ((i * 0.6180339887) % 1);
  const r = Math.sqrt(u1);
  return [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u1)];
});

export class Baker {
  private hitAxis = -1;
  private hitSign = 0;
  private hitBox: Aabb | null = null;
  // (11/17 추가) 계산 중에 쓰는 임시 칸을 매번 새로 만들지 않고 다시 써요(폰에서 메모리 청소로 멈칫하는 걸 줄이려고). 결과는 같아요
  private sO: V3 = [0, 0, 0];
  private sDir: V3 = [0, 0, 0];
  private lO: V3 = [0, 0, 0];
  private lD: V3 = [0, 0, 0];
  private lN: V3 = [0, 0, 0];
  private lP: V3 = [0, 0, 0];

  /**
   * (11/20 추가) amb = 어림 빛(AMB) 배율. 이 어림 빛은 등 밝기와 상관없이 더해져서, 등을 줄여도 화면이 회색으로 고르게 남아요 —
   * 어둡고 섬뜩한 곳(계단실)은 줄여서 구석이 진짜로 어두워지게. 기본 1(다른 방은 그대로)
   */
  private amb: number;
  constructor(private boxes: Aabb[], private lamps: BakeLamp[], amb = 1) { this.amb = AMB * amb; }

  /** 선과 상자가 만나는 거리. 안 만나면 Infinity, 시작점이 상자 안이면 0. */
  rayBox(o: V3, d: V3, b: Pick<Aabb, 'min' | 'max'>, tMax: number): number {
    let t0 = 0, t1 = tMax, axis = -1, sign = 0;
    for (let k = 0; k < 3; k++) {
      const dk = d[k];
      if (Math.abs(dk) < 1e-9) {
        if (o[k] < b.min[k] || o[k] > b.max[k]) return Infinity;
        continue;
      }
      const inv = 1 / dk;
      let ta = (b.min[k] - o[k]) * inv, tb = (b.max[k] - o[k]) * inv, s = -1;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; s = 1; }
      if (ta > t0) { t0 = ta; axis = k; sign = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return Infinity;
    }
    this.hitAxis = axis;
    this.hitSign = sign;
    return t0;
  }

  /** 가장 먼저 닿는 상자까지의 거리(없으면 Infinity). 닿은 면 정보는 hit* 에 남아요. */
  nearest(o: V3, d: V3, tMax = 100): number {
    let best = Infinity, axis = -1, sign = 0;
    let box: Aabb | null = null;
    for (const b of this.boxes) {
      const t = this.rayBox(o, d, b, Math.min(best, tMax));
      if (t < best) { best = t; axis = this.hitAxis; sign = this.hitSign; box = b; }
    }
    this.hitAxis = axis;
    this.hitSign = sign;
    this.hitBox = box;
    return best;
  }

  occluded(o: V3, d: V3, tMax: number): boolean {
    for (const b of this.boxes) if (this.rayBox(o, d, b, tMax) < Infinity) return true;
    return false;
  }

  inside(p: V3): boolean {
    for (const b of this.boxes) {
      if (p[0] > b.min[0] && p[0] < b.max[0] && p[1] > b.min[1] && p[1] < b.max[1] && p[2] > b.min[2] && p[2] < b.max[2]) return true;
    }
    return false;
  }

  /** 천장등에서 바로 오는 빛. soft면 등 하나를 네 점으로 나눠 그늘 가장자리를 부드럽게. */
  direct(p: V3, n: V3, soft: boolean): V3 {
    const out: V3 = [0, 0, 0];
    const o = this.sO;
    o[0] = p[0] + n[0] * 2e-3; o[1] = p[1] + n[1] * 2e-3; o[2] = p[2] + n[2] * 2e-3;
    const dir = this.sDir;
    const k = soft ? 4 : 1;
    for (const L of this.lamps) {
      for (let s = 0; s < k; s++) {
        const sx = soft ? (s & 1 ? 0.5 : -0.5) * L.hx : 0;
        const sz = soft ? (s & 2 ? 0.5 : -0.5) * L.hz : 0;
        const lx = L.p[0] + sx - o[0], ly = L.p[1] - o[1], lz = L.p[2] + sz - o[2];
        const d2 = lx * lx + ly * ly + lz * lz;
        const d = Math.sqrt(d2);
        dir[0] = lx / d; dir[1] = ly / d; dir[2] = lz / d;
        const cosS = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]; // 면이 등을 향한 정도
        const cosE = dir[1];                                         // 등이 아래를 향한 정도
        if (cosS <= 0 || cosE <= 0) continue;
        if (this.occluded(o, dir, d - 0.02)) continue;
        const w = (cosS * cosE) / Math.max(d2, 0.08) / k;
        out[0] += L.e[0] * w; out[1] += L.e[1] * w; out[2] += L.e[2] * w;
      }
    }
    return out;
  }

  /** 한 점이 받는 빛 전체. u, v는 그 면 위의 두 방향(n과 함께 직각). */
  light(p: V3, n: V3, u: V3, v: V3): V3 {
    const out = this.direct(p, n, true);
    const o = this.lO;
    o[0] = p[0] + n[0] * 2e-3; o[1] = p[1] + n[1] * 2e-3; o[2] = p[2] + n[2] * 2e-3;
    const d = this.lD, hn = this.lN, hp = this.lP;
    let r = 0, g = 0, b = 0;
    for (const s of SAMPLES) {
      d[0] = u[0] * s[0] + v[0] * s[1] + n[0] * s[2];
      d[1] = u[1] * s[0] + v[1] * s[1] + n[1] * s[2];
      d[2] = u[2] * s[0] + v[2] * s[1] + n[2] * s[2];
      const t = this.nearest(o, d);
      const box = this.hitBox;
      if (!box || t === Infinity || this.hitAxis < 0) continue;
      hn[0] = hn[1] = hn[2] = 0;
      hn[this.hitAxis] = this.hitSign;
      hp[0] = o[0] + d[0] * t; hp[1] = o[1] + d[1] * t; hp[2] = o[2] + d[2] * t;
      const e = this.direct(hp, hn, false);
      // 가까운 면일수록(구석) 어림 빛을 줄여서 구석이 살짝 어두워져요
      const amb = this.amb * Math.min(1, t / 0.5);
      r += box.albedo[0] * (e[0] + amb);
      g += box.albedo[1] * (e[1] + amb);
      b += box.albedo[2] * (e[2] + amb);
    }
    out[0] += r / N_RAYS; out[1] += g / N_RAYS; out[2] += b / N_RAYS;
    return out;
  }
}
