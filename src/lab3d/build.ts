/**
 * 방 짓기 — 상자 데이터를 읽어 3D 물체로 만들고, 조명을 구워 넣어요.
 *
 * - 상자의 여섯 면 중 "방 안에서 보이는 면"만 만들어요.
 * - 면을 20cm 칸으로 나누고 칸 꼭짓점마다 빛을 계산해 색으로 적어요(조명 굽기).
 * - 같은 재질끼리 한 덩어리로 묶어서 그리는 횟수를 재질 수(6)로 줄여요.
 * - (11/17 추가) part(): 나중에 생기거나 사라지는 상자 묶음(본 게임의 하얀 방 벽 등)을 따로 지어요.
 *   같은 빛으로 물들이지만, 빛을 가리는 계산에는 넣지 않아요(= 그 벽이 "없을 때"의 빛으로 구움).
 * - (11/17 추가) buildSpaceAsync(): 굽기를 한 프레임에 몇 ms씩 나눠서 해요. 폰에서는 굽기가 PC보다 몇 배 느려서
 *   한 번에 하면 화면이 몇 초 멈춰요(사용자: 벽을 통과하는 순간 멈춤). 본 게임은 다음 방을 미리 이렇게 지어 둬요.
 * - (11/17 추가) 재질 무늬(텍스처)는 한 번만 만들어 여러 방이 같이 써요.
 */
import * as THREE from 'three';
import { Baker, type Aabb, type BakeLamp } from './bake.ts';
import type { Box, MatId, Space, V3 } from './room.ts';
import { MATS, makeTextureGen } from './textures.ts';

const STEP = 0.2; // 조명을 계산하는 칸 크기(미터)

/**
 * 위에서 본 벽의 네모(충돌용).
 * (11/20 추가) 높이(y0~y1)와 밟는 상자(walk)도 적어요 — 걷는 몸이 지금 발 높이에서 몸에 걸리는 상자만 막고,
 * 밟는 상자의 윗면을 바닥으로 써요(계단). 전엔 바닥 0 기준 높이 0.1~1.6에 걸친 상자만 골라 뒀어요(발 높이 0이면 같은 결과).
 */
export interface Rect { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; walk?: boolean }

// 면 여섯 개: 바깥 방향 n, 면 위의 두 방향 u·v (u × v = n)
const FACES: { n: V3; u: V3; v: V3 }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lin = (hex: string): V3 => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

interface Bucket { pos: number[]; uv: number[]; col: number[]; idx: number[] }

/** 나중에 생기거나 사라지는 상자 묶음을 지은 것. */
export interface BuiltPart {
  root: THREE.Group;
  /** 충돌 네모(보일 때만 walker에 넣어요). */
  rects: Rect[];
  /** 빛·시선을 가리는 상자(보일 때만). */
  aabbs: Aabb[];
  /** "지금 화면에 보이는가"를 잴 점들: 만든 면마다 가운데와 네 귀퉁이(면에서 2cm 띄움). */
  points: V3[];
  tris: number;
}

export interface Built {
  root: THREE.Group;
  rects: Rect[];
  baker: Baker;
  /** 구운 조명 켜기/끄기(끄면 밋밋한 3D — 비교용). */
  setBaked(on: boolean): void;
  /** 같은 빛으로 상자 묶음을 따로 지어요(생겼다 사라지는 벽). */
  part(boxes: Box[]): BuiltPart;
  /**
   * (11/20 추가, 폰 점검) part()를 나눠서(쉬어 갈 수 있게) — 본 게임은 runSliced로 돌려요.
   * 문·사라지는 벽이 많은 방(따뜻한 방·계단실)은 이 굽기를 한 번에 하면 다음 방을 미리 짓는 끝에서
   * PC에서도 약 0.2초 화면이 멈췄어요(폰은 몇 배 — 앞 방에서 둘러보다가 툭 끊김).
   */
  partGen(boxes: Box[]): Generator<void, BuiltPart>;
  stats: { verts: number; tris: number; bakeMs: number };
}

const toAabb = (b: Box): Aabb => ({
  min: [b.at[0] - b.size[0] / 2, b.at[1] - b.size[1] / 2, b.at[2] - b.size[2] / 2],
  max: [b.at[0] + b.size[0] / 2, b.at[1] + b.size[1] / 2, b.at[2] + b.size[2] / 2],
  albedo: lin(MATS[b.mat].color),
});

/**
 * 충돌 네모. (11/20 변경) ~~바닥 위에서 몸이 부딪히는 높이(0.1~1.6)에 걸친 상자만~~ → 단단한 상자 모두를 높이와 함께 —
 * 몸에 걸리는지는 걷는 몸이 지금 발 높이로 골라요(계단을 오르면 발 높이가 달라져서). 밟는 상자(walk)는 바닥이 돼요.
 */
const toRects = (boxes: Box[]): Rect[] => boxes
  .filter((b) => b.solid !== false)
  .map((b) => ({
    x0: b.at[0] - b.size[0] / 2, x1: b.at[0] + b.size[0] / 2, z0: b.at[2] - b.size[2] / 2, z1: b.at[2] + b.size[2] / 2,
    y0: b.at[1] - b.size[1] / 2, y1: b.at[1] + b.size[1] / 2, ...(b.walk ? { walk: true } : {}),
  }));

/** 재질 무늬는 방마다 새로 만들지 않고 같이 써요(폰에서 무늬 하나 만드는 데도 시간이 걸려서). */
const TEX = new Map<MatId, THREE.CanvasTexture>();
const texOf = (m: MatId) => { let t = TEX.get(m); if (!t) TEX.set(m, (t = drain(makeTextureGen(m)))); return t; };
/** (11/19 본 게임 6단계 추가) 재질 무늬를 다른 곳(본 게임의 끝없는 복도)에서도 같이 써요. */
export const matTexture = (m: MatId) => texOf(m);

/**
 * (11/17 추가) 나눠 굽기의 빠르기. 본 게임이 상황에 맞춰 바꿔요(world.setBakeMode).
 *   budget = 한 번에 굽는 시간(ms), eager = 프레임을 기다리지 않고 틈나는 대로(화면이 한가할 때)
 */
export const bakePace = { budget: 6, eager: false };

/** 생성기를 끝까지 한 번에 돌려요. */
function drain<T>(g: Generator<void, T>): T {
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** 한 번에 지어요(시험 방, 작은 묶음). */
export function buildSpace(space: Pick<Space, 'boxes' | 'lamps'> & { reach?: number; amb?: number }): Built {
  const t0 = performance.now();
  const b = drain(buildGen(space));
  b.stats.bakeMs = Math.round(performance.now() - t0);
  return b;
}

/**
 * 나눠서 지어요: 한 프레임에 bakePace.budget ms만 굽고 다음 프레임으로 넘겨요(그동안 게임은 그대로 돌아요).
 * bakePace.eager = 화면이 한가할 때(시작 화면): 프레임을 기다리지 않고 틈나는 대로 이어서 굽기(더 빨리 끝나요).
 * 재질 무늬 만들기도 같이 나눠서 해요. stats.bakeMs = 실제로 계산에 쓴 시간의 합.
 */
export async function buildSpaceAsync(space: Pick<Space, 'boxes' | 'lamps'> & { reach?: number; amb?: number }): Promise<Built> {
  const t0 = { busy: 0 };
  const b = await runSliced(buildGen(space, true), t0);
  b.stats.bakeMs = Math.round(t0.busy);
  return b;
}

/** (11/17 추가) 쉬어 갈 수 있는 일(생성기)을 bakePace에 맞춰 나눠 돌려요. stat.busy에 실제로 계산한 시간을 더해요. */
export async function runSliced<T>(g: Generator<void, T>, stat: { busy: number } = { busy: 0 }): Promise<T> {
  for (;;) {
    const t = performance.now();
    let r = g.next();
    while (!r.done && performance.now() - t < bakePace.budget) r = g.next();
    stat.busy += performance.now() - t;
    if (r.done) return r.value;
    if (bakePace.eager || document.hidden) {
      // 다른 일(화면 그리기·입력)을 한 번 처리하게 해 주고 바로 이어서
      await new Promise<void>((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(null); });
    } else {
      // 화면을 한 장 그린 바로 뒤에 이어서(한 프레임에 한 조각만 — 게임이 끊기지 않게)
      await new Promise<void>((res) => requestAnimationFrame(() => setTimeout(res, 0)));
    }
  }
}

function* buildGen(input: Pick<Space, 'boxes' | 'lamps'> & { reach?: number; amb?: number }, sliceTex = false): Generator<void, Built> {
  // (11/19 본 게임 6단계 추가) 보이지 않는 벽(ghost)은 부딪힘에만 넣고, 면·빛 계산에서는 빼요
  const ghosts = input.boxes.filter((b) => b.ghost);
  const space = { ...input, boxes: input.boxes.filter((b) => !b.ghost) };
  const solids = space.boxes.filter((b) => b.solid !== false);
  const lamps: BakeLamp[] = space.lamps.map((l) => {
    const c = lin(l.color);
    return { p: l.at, hx: l.size[0], hz: l.size[1], e: [c[0] * l.power, c[1] * l.power, c[2] * l.power] };
  });
  const baker = new Baker(solids.map(toAabb), lamps, input.amb); // (11/20) amb = 어림 빛 배율(계단실은 어둡게)

  /**
   * 방 안의 공기 중인지: 상자 속이 아니고, 위에 천장·아래에 바닥이 있음(reach m 안에).
   * (11/20 추가) reach: 기본 6m. 계단실은 7m 높이라 가운데 틈(난간 사이)에서 위아래가 6m를 넘어 면이 안 생겨서 방마다 늘릴 수 있게
   */
  const reach = input.reach ?? 6;
  const inRoom = (q: V3) =>
    !baker.inside(q) && baker.nearest(q, [0, 1, 0], reach) < Infinity && baker.nearest(q, [0, -1, 0], reach) < Infinity;

  /** 상자 한 면을 칸으로 나눠 빛을 구워 bucket에 더해요. 만들었으면 면의 가운데 정보를 돌려줘요. 한 줄마다 쉬어 갈 수 있어요(yield). */
  function* addFace(B: Bucket, box: Box, f: (typeof FACES)[number]): Generator<void, { c: V3; hu: number; hv: number } | null> {
    const half: V3 = [box.size[0] / 2, box.size[1] / 2, box.size[2] / 2];
    const hn = Math.abs(dot(f.n, half)), hu = Math.abs(dot(f.u, half)), hv = Math.abs(dot(f.v, half));
    const c: V3 = [box.at[0] + f.n[0] * hn, box.at[1] + f.n[1] * hn, box.at[2] + f.n[2] * hn];
    if (!inRoom([c[0] + f.n[0] * 0.1, c[1] + f.n[1] * 0.1, c[2] + f.n[2] * 0.1])) return null;

    const tile = MATS[box.mat].tile;
    const nu = Math.max(1, Math.ceil((hu * 2) / STEP)), nv = Math.max(1, Math.ceil((hv * 2) / STEP));
    const base = B.pos.length / 3;
    const W = nu + 1;
    const light: (V3 | null)[] = [];

    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const a = (i / nu) * 2 - 1, b = (j / nv) * 2 - 1;
        const p: V3 = [
          c[0] + f.u[0] * hu * a + f.v[0] * hv * b,
          c[1] + f.u[1] * hu * a + f.v[1] * hv * b,
          c[2] + f.u[2] * hu * a + f.v[2] * hv * b,
        ];
        B.pos.push(p[0], p[1], p[2]);
        // 무늬 좌표는 실제 위치(미터)로 → 상자가 나뉘어도 무늬가 이어져요
        if (f.n[0]) B.uv.push(p[2] / tile, p[1] / tile);
        else if (f.n[1]) B.uv.push(p[0] / tile, p[2] / tile);
        else B.uv.push(p[0] / tile, p[1] / tile);
        // 빛은 가장자리에서 살짝 안쪽 점으로 계산(다른 상자와 딱 맞닿은 선을 피하려고)
        const q: V3 = [
          p[0] - f.u[0] * 0.006 * a - f.v[0] * 0.006 * b + f.n[0] * 0.003,
          p[1] - f.u[1] * 0.006 * a - f.v[1] * 0.006 * b + f.n[1] * 0.003,
          p[2] - f.u[2] * 0.006 * a - f.v[2] * 0.006 * b + f.n[2] * 0.003,
        ];
        light.push(baker.inside(q) ? null : baker.light(q, f.n, f.u, f.v));
      }
      yield;
    }
    // 다른 상자에 묻힌 꼭짓점은 이웃 값으로 채워요(안 그러면 맞닿는 곳에 검은 띠가 생김)
    for (let pass = 0; pass < 4; pass++) {
      const next = light.slice();
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        if (light[j * W + i]) continue;
        const near = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]
          .filter(([x, y]) => x >= 0 && y >= 0 && x <= nu && y <= nv)
          .map(([x, y]) => light[y * W + x]).filter((v): v is V3 => !!v);
        if (near.length) next[j * W + i] = [0, 1, 2].map((k) => near.reduce((s, v) => s + v[k], 0) / near.length) as V3;
      }
      next.forEach((v, k) => (light[k] = v));
    }
    for (const l of light) B.col.push(...(l ?? [0, 0, 0]));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * W + i, b = a + 1, d = a + W, e = d + 1;
      B.idx.push(a, b, e, a, e, d);
    }
    return { c, hu, hv };
  }

  /** 재질별 bucket을 3D 물체로. */
  const meshes = (buckets: Map<MatId, Bucket>, root: THREE.Group, toggles?: (() => void)[]) => {
    let verts = 0, tris = 0;
    for (const [mat, B] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      const lit = new THREE.Float32BufferAttribute(B.col, 3);
      const flat = new THREE.Float32BufferAttribute(new Float32Array(B.col.length).fill(0.75), 3);
      geo.setAttribute('color', lit);
      geo.setIndex(B.idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texOf(mat), vertexColors: true }));
      mesh.name = mat;
      root.add(mesh);
      toggles?.push(() => geo.setAttribute('color', baked ? lit : flat));
      verts += B.pos.length / 3;
      tris += B.idx.length / 3;
    }
    return { verts, tris };
  };

  const bucketOf = (buckets: Map<MatId, Bucket>, m: MatId) => {
    let b = buckets.get(m);
    if (!b) buckets.set(m, (b = { pos: [], uv: [], col: [], idx: [] }));
    return b;
  };

  const buckets = new Map<MatId, Bucket>();
  for (const box of space.boxes) for (const f of FACES) yield* addFace(bucketOf(buckets, box.mat), box, f);

  // 아직 없는 재질 무늬는 여기서 나눠 만들어요(meshes가 한 번에 만들지 않게)
  if (sliceTex) for (const m of buckets.keys()) if (!TEX.has(m)) TEX.set(m, yield* makeTextureGen(m));

  const root = new THREE.Group();
  const toggles: (() => void)[] = [];
  let baked = true;
  const { verts, tris } = meshes(buckets, root, toggles);

  // 천장등(빛나는 네모). hide = 빛만 있고 등은 안 보여요
  for (const l of space.lamps) {
    if (l.hide) continue;
    const c = new THREE.Color(l.color).multiplyScalar(5);
    const shape = l.round ? new THREE.CircleGeometry(l.size[0] / 2, 24) : new THREE.PlaneGeometry(l.size[0], l.size[1]);
    const m = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({ color: c }));
    m.rotation.x = Math.PI / 2; // 아래를 보게
    m.position.set(l.at[0], l.at[1] + 0.015, l.at[2]);
    root.add(m);
  }

  return {
    root, rects: [...toRects(solids), ...toRects(ghosts)], baker,
    setBaked(on) { baked = on; toggles.forEach((t) => t()); },
    part(boxes) { return drain(this.partGen(boxes)); },
    *partGen(boxes) {
      const pb = new Map<MatId, Bucket>();
      const points: V3[] = [];
      for (const box of boxes) {
        for (const f of FACES) {
          const made = yield* addFace(bucketOf(pb, box.mat), box, f); // (11/20 변경) drain → yield*: 한 줄마다 쉬어 갈 수 있게
          if (!made || box.solid === false) continue;
          const { c, hu, hv } = made;
          // (11/17 변경) 다섯 점 → 40cm 간격 격자: 큰 벽을 가까이서 보면 다섯 점이 다 화면 밖이라 "안 보인다"고 잘못 판단했어요
          const nu = Math.max(2, Math.ceil((hu * 2) / 0.4) + 1), nv = Math.max(2, Math.ceil((hv * 2) / 0.4) + 1);
          for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
            const a = ((i / (nu - 1)) * 2 - 1) * 0.92, b = ((j / (nv - 1)) * 2 - 1) * 0.92;
            points.push([0, 1, 2].map((k) => c[k] + f.u[k] * hu * a + f.v[k] * hv * b + f.n[k] * 0.02) as V3);
          }
        }
      }
      // (11/20 추가, 폰 점검) 이 묶음에만 있는 재질(갈색 문의 나뭇결 등)의 무늬도 나눠 만들어요 — 한 번에 만들면 PC에서도 0.14초 멈췄어요
      for (const m of pb.keys()) if (!TEX.has(m)) TEX.set(m, yield* makeTextureGen(m));
      const proot = new THREE.Group();
      const { tris: ptris } = meshes(pb, proot);
      const solid = boxes.filter((b) => b.solid !== false);
      return { root: proot, rects: toRects(solid), aabbs: solid.map(toAabb), points, tris: ptris };
    },
    stats: { verts, tris, bakeMs: 0 },
  };
}
