/**
 * (11/19 6단계 2차 추가) 3D 열쇠 꾸러미의 자세 — 3D(three.js) 없이 계산만 해요.
 * 3D 세계(world.ts)는 이걸로 열쇠를 놓고 움직이고, 방 데이터(rooms/warm.ts)는 빨간 점 열쇠 자리(조준 대상)를 이걸로 정해요(둘이 어긋나지 않게).
 *
 * 열쇠 한 개의 자세 = 머리 가운데 자리 p + 날이 뻗는 쪽 x + 넓은 면이 바라보는 쪽 z(빨간 점은 +z 면의 머리에 붙어 있어요).
 * 상태: hang 손잡이에 걸림(하나는 손잡이에 꽂힘) / f0 바닥에 엉킴(빨간 점 열쇠 위로 세 개가 덮음) / f1 반쯤 헤침 / f2 다 헤침 / use 빨간 점 열쇠가 손잡이에 꽂힘.
 * 순서: [보통 열쇠 0..n-1, 빨간 점 열쇠, 고리]
 */
import { FACES } from './faces.ts';
import type { KeyBunch, V3 } from './schema.ts';

export interface KeyPoseData { p: V3; x: V3; z: V3 }
export type KeyState = 'hang' | 'f0' | 'f1' | 'f2' | 'use';

/** 열쇠 크기 배율(실제 열쇠보다 조금 크게 — 폰 화면에서 줌으로 찾을 수 있게, 길이 약 10cm) */
export const KEY_SCALE = 1.35;
const RING = 0.018 * KEY_SCALE; // 고리 반지름
const HOLE = 0.0052 * KEY_SCALE; // 머리 가운데에서 구멍까지(world.ts의 열쇠 모양과 같게)

const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v를 축 k 둘레로 각도 r(라디안)만큼 돌림 */
const rot = (v: V3, k: V3, r: number): V3 => {
  const c = Math.cos(r), s = Math.sin(r), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2], x = cross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
};
const UP: V3 = [0, 1, 0];

/** 빨간 점 열쇠가 바닥에 놓인 쪽(무더기 가운데에서) — 문과 나란히, 손잡이 반대쪽으로 */
function redDir(def: KeyBunch): V3 {
  const n = FACES[def.face].n;
  return norm(cross(n, UP)); // n = (-1,0,0)이면 (0,0,-1)
}

/** 바닥에서 빨간 점(빨간 점 열쇠의 머리) 자리 — 조준 대상 상자의 가운데로 써요 */
export function redDotAt(def: KeyBunch): V3 {
  return add(add(def.floor, redDir(def), RING + HOLE), [0, 0.003, 0]);
}

/** 정해진 씨앗의 난수(늘 같은 배치) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 상태별 자세 전부 */
export function keyLayout(def: KeyBunch): Record<KeyState, KeyPoseData[]> {
  const n = FACES[def.face].n, side = norm(cross(UP, n));
  const N = def.keys;
  const r = rng(def.seed);

  // ── 손잡이에 걸림 ──
  const inserted: KeyPoseData = { p: add(def.knob, n, 0.03), x: [-n[0], -n[1], -n[2]], z: side };
  const hole = add(inserted.p, inserted.x, -HOLE);
  const ringC = add(hole, UP, -RING * 0.95);
  const hangRing: KeyPoseData = { p: ringC, x: side, z: n };
  const hangKey = (i: number, red: boolean): KeyPoseData => {
    const a = (r() - 0.5) * 1.4; // 고리 아래쪽에서 매달린 자리(±40°)
    const attach = add(ringC, add([side[0] * Math.sin(a), 0, side[2] * Math.sin(a)], UP, -Math.cos(a)), RING);
    let x = rot([0, -1, 0], n, (r() - 0.5) * 0.8 + a * 0.6); // 거의 아래로, 조금씩 벌어짐
    x = norm(rot(x, side, (r() - 0.5) * 0.25));
    let z: V3 = red ? [-n[0], -n[1], -n[2]] : n; // 빨간 점은 문 쪽(안 보이게)
    z = norm(rot(z, x, (r() - 0.5) * 0.7));
    const p = add(add(attach, x, HOLE), n, (i - N / 2) * 0.0022);
    return { p, x, z };
  };
  const hang: KeyPoseData[] = [inserted];
  for (let i = 1; i < N; i++) hang.push(hangKey(i, false));
  hang.push(hangKey(N, true), hangRing);

  // ── 바닥 ──
  const F = def.floor;
  const rd = redDir(def);
  const baseA = Math.atan2(rd[2], rd[0]);
  const flatRing: KeyPoseData = { p: add(F, UP, 0.0013), x: side, z: UP };
  const flat = (a: number, y: number, tilt: number, spin: number): KeyPoseData => {
    const x: V3 = [Math.cos(a), 0, Math.sin(a)];
    const z = norm(rot(UP, x, tilt));
    return { p: add(add(F, x, RING + HOLE + spin), UP, y), x: norm(rot(x, z, 0)), z };
  };
  const red: KeyPoseData = flat(baseA, 0.0013, 0.02, 0);
  // 빨간 점 열쇠를 덮는 세 개(0,1,2)와 나머지(둘레에 고루)
  const cover = [-0.2, 0.12, -0.04];
  // 떨어진 꾸러미답게 한쪽으로 몰리고(약 230°), 사이가 들쭉날쭉, 서로 기대어 비스듬히
  const angles = Array.from({ length: N }, (_, i) => (i < 3 ? baseA + cover[i] : baseA + 0.75 + ((i - 3) / Math.max(1, N - 3)) * 3.3 + (r() - 0.5) * 0.45));
  const tilts = Array.from({ length: N }, () => (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.35)); // 서로 기대어 10~30° 비스듬히 — 등 빛을 받는 면이 열쇠마다 달라 반짝임이 생겨요
  const away = [-1, 1, -1];
  const floorState = (k: number): KeyPoseData[] => {
    const out: KeyPoseData[] = [];
    for (let i = 0; i < N; i++) {
      const covering = i < 3;
      const push = covering ? away[i] * [0, 0.55, 1.25][k] : (i % 2 ? 1 : -1) * [0, 0.05, 0.12][k];
      const y = covering ? 0.004 + i * 0.0024 - k * 0.0012 : 0.0013 + (i % 3) * 0.0018;
      out.push(flat(angles[i] + push, y, covering ? tilts[i] + 0.12 * (1 - k / 2) : tilts[i], covering ? 0.004 * k : 0));
    }
    out.push(red, flatRing);
    return out;
  };
  const f2 = floorState(2);
  // 빨간 점 열쇠가 손잡이에 꽂힘(나머지는 다 헤친 채로)
  const use = f2.slice();
  use[N] = { p: inserted.p, x: inserted.x, z: [-side[0], -side[1], -side[2]] };
  return { hang, f0: floorState(0), f1: floorState(1), f2, use };
}
