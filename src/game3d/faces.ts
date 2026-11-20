import type { Face, V3 } from './schema.ts';

/**
 * 평면(소품·포스트잇)이 바라보는 방향마다: 바깥 방향 n, 면 위의 두 방향 u(가로)·v(세로), 평면을 돌리는 각도(rx, ry).
 * 평면은 원래 +z를 바라봐요. 벽은 y축으로 돌리고(ry), 천장(y-)은 x축으로 돌려요(rx).
 * (11/17 변경) world.ts에서 옮겨 왔고, 천장에 붙는 'y-'를 더했어요(포스트잇의 방 천장).
 * (11/18 추가) 바닥에 놓이는 'y+'(계단의 흩어진 열쇠처럼 테이프에만 찍힌 것). 종이의 위쪽이 -z(앞)를 향해요.
 */
export const FACES: Record<Face, { n: V3; u: V3; v: V3; rx: number; ry: number }> = {
  'x+': { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], rx: 0, ry: Math.PI / 2 },
  'x-': { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], rx: 0, ry: -Math.PI / 2 },
  'z+': { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], rx: 0, ry: 0 },
  'z-': { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], rx: 0, ry: Math.PI },
  'y-': { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], rx: Math.PI / 2, ry: 0 },
  'y+': { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], rx: -Math.PI / 2, ry: 0 },
};

/** 면 위의 한 점: at + u·a + v·b + n·lift */
export function onFace(at: V3, f: { n: V3; u: V3; v: V3 }, a: number, b: number, lift = 0): V3 {
  return [0, 1, 2].map((k) => at[k] + f.u[k] * a + f.v[k] * b + f.n[k] * lift) as V3;
}
