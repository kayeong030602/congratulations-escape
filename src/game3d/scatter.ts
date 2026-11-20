/**
 * (11/17 추가) 흩뿌린 종이 — 포스트잇 수천 장을 조각(InstancedMesh)마다 한 번에 그려요.
 *
 * - 한 장 = 네모 하나. 위치·기울기·색·글씨 칸은 장마다 다르게(씨앗이 같으면 매번 같은 배치).
 * - 글씨: 손글씨풍 단어를 그린 그림 한 장(8×8칸, 흰 바탕에 어두운 글씨)을 만들고, 장마다 칸 하나를 골라요.
 *   종이 색은 장마다의 색(instanceColor)이 흰 바탕에 곱해져서 형광 초록·주황·분홍이 돼요.
 * - 빛: 면 위 30cm 간격으로 구운 빛을 재 두고, 장마다 가까운 네 점 사이로 섞어 물들여요(한 장씩 재면 너무 느려서).
 * - 조각: chunk 크기로 나눠요. 조각마다 따로 보이고 숨어서, "안 보는 사이에" 하나씩 사라질 수 있어요.
 * - 생성기라 나눠 지을 수 있어요(폰에서 멈추지 않게).
 */
import * as THREE from 'three';
import type { Built } from '../lab3d/build.ts';
import type { Lamp } from '../lab3d/room.ts';
import { FACES, onFace } from './faces.ts';
import type { Scatter, V3 } from './schema.ts';

/**
 * 조각 하나. base·light = 장마다의 원래 색·빛(rgb), figs = 화살표마다 칠할 장 번호,
 * thr = 장마다 "얼마나 가까워야 화살표 색으로 물드는가"(0~1), levels = 화살표마다 지금 칠해 둔 세기(0~1).
 */
export interface ScatterChunk {
  def: Scatter; mesh: THREE.InstancedMesh; points: V3[];
  base: Float32Array; light: Float32Array; figs: number[][]; thr: Float32Array; levels: Float32Array;
}

const CELLS = 8; // 글씨 그림 한 줄의 칸 수(8×8 = 64칸)

// 영상 속 포스트잇에 적힌 말들(영어, 질문·망설임) — 공간 속 글씨는 영어(CLAUDE.md 결정 6)
const WORDS = [
  'wait|why?', 'maybe|again?', 'where?|soon?', 'stop|okay?', 'alone|not?', 'where?|okon?', 'why|not?', 'later?',
  'go back', 'left?', 'right?', 'not yet', 'try|again', 'almost', 'don\'t', 'hurry?', 'too|soon', 'what if', 'are you|sure?',
  'next?', 'same', 'turn|around', 'stay', 'look|up', 'listen', 'no', 'yes?', 'why?', 'ok?', 'who?', 'here?', 'how?',
  'again', 'soon', 'maybe', 'wait', 'keep|going', 'don\'t|stop', 'one more', 'quiet', 'not|here', 'up?', 'down?',
  'follow', 'careful', 'it\'s ok', 'never|mind', 'remember', 'forget', 'sorry', 'thanks', 'then?', 'now?', 'still?',
];

let atlas: THREE.CanvasTexture | null = null;

/** 손글씨풍 단어 그림(512×512, 8×8칸). 한 번만 만들어요. */
function noteAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const S = 512, C = S / CELLS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  let seed = 9;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const x = i * C, y = j * C;
    // 종이 결: 거의 흰색, 아래쪽이 아주 살짝 어두움(종이가 들뜬 그늘)
    const g = ctx.createLinearGradient(0, y, 0, y + C);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#e9e9e9');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, C, C);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; // 위쪽 끈끈이 줄
    ctx.fillRect(x, y, C, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; // 오른쪽·아래 가장자리 그늘(겹친 종이가 한 장씩 구분되게)
    ctx.fillRect(x + C - 2, y, 2, C);
    ctx.fillRect(x, y + C - 2, C, 2);
    const n = j * CELLS + i;
    if (n % 9 === 8) continue; // 가끔 빈 종이
    const lines = WORDS[n % WORDS.length].split('|');
    ctx.save();
    ctx.translate(x + C / 2, y + C / 2);
    ctx.rotate((r() - 0.5) * 0.25);
    ctx.fillStyle = `rgba(${30 + r() * 30},${25 + r() * 20},${40 + r() * 30},0.88)`;
    const size = lines.length > 1 ? 15 : 17;
    ctx.font = `600 ${size}px "Segoe Print","Bradley Hand","Marker Felt","Comic Sans MS","Chalkboard SE",cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((t, k) => ctx.fillText(t, (r() - 0.5) * 6, (k - (lines.length - 1) / 2) * (size + 3), C - 8));
    ctx.restore();
  }
  atlas = new THREE.CanvasTexture(cv);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  return atlas;
}

/**
 * 한 묶음(Scatter 하나)의 조각들이 같이 쓰는 재질: 장마다의 글씨 칸(aCell)으로 그림의 한 칸만 보여요.
 * (11/20 변경, 폰 점검 뒤 사용자 의견: 계단 0-2 포스트잇이 사라짐) ~~게임 전체가 재질 하나를 같이 씀~~ → 묶음마다 새 재질(글씨 그림은 같이 씀,
 * 그림 프로그램도 같은 것이 쓰여서 비용은 같아요). 켜고 끄는 등(world.ts buildLive)·햇살이 방의 재질마다 셰이더 조각을 끼우는데,
 * 같이 쓰는 재질엔 조각마다 18번이나 겹쳐 끼워져 그림 프로그램이 깨지고 포스트잇이 안 그려졌어요(계단실에 문 빛이 생긴 15-7부터).
 */
function noteMaterial(): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map: noteAtlas() });
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aCell;\n' + sh.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>\n  vMapUv = vMapUv * ${(1 / CELLS).toFixed(4)} + aCell;`,
    );
  };
  material.customProgramCacheKey = () => 'scatter-notes';
  return material;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** 형광 종이는 흰 종이보다 밝게 빛나 보여요. 화살표 종이는 조금 더(맞춰지는 자리에서 또렷하게). */
const GLOW = 1.25;
const FIG_GLOW = 1.45;
const D2R = Math.PI / 180;

/**
 * (11/17 추가) 착시 화살표 하나의 모양: eye에서 앞(-z)을 볼 때의 화면 평면(u = x/깊이, v = y/깊이) 위에 그린 화살표.
 * 종이마다 그 자리에서 본 화면 위치가 화살표 안이면 화살표 색으로 칠해요 → 그 자리에서만 이어져 보여요.
 */
function arrowTest(fg: NonNullable<Scatter['figures']>[number]): (p: V3) => boolean {
  const uv = (az: number, el: number): [number, number] => [Math.tan(az * D2R), Math.tan(el * D2R) / Math.cos(az * D2R)];
  const T = uv(fg.from[0], fg.from[1]);
  const d0 = [fg.at[0] - fg.eye[0], fg.at[1] - fg.eye[1], fg.at[2] - fg.eye[2]];
  const P0: [number, number] = [d0[0] / -d0[2], d0[1] / -d0[2]];
  const len0 = Math.hypot(P0[0] - T[0], P0[1] - T[1]) || 1;
  const dir = [(P0[0] - T[0]) / len0, (P0[1] - T[1]) / len0];
  const nrm = [-dir[1], dir[0]];
  const gap = Math.tan((fg.gap ?? 1.4) * D2R);
  const w = Math.tan((fg.width ?? 3.8) * D2R); // 화살대 굵기
  const hw = w * 3.0, hl = hw * 0.8; // 화살촉 너비·길이(화살대보다 확실히 넓게)
  const L = len0 - gap - hl; // 꼬리 → 화살촉 밑동
  return (p) => {
    const dz = p[2] - fg.eye[2];
    if (dz > -0.05) return false; // 보는 자리보다 뒤
    const u = (p[0] - fg.eye[0]) / -dz, v = (p[1] - fg.eye[1]) / -dz;
    const rx = u - T[0], ry = v - T[1];
    const t = rx * dir[0] + ry * dir[1], c = Math.abs(rx * nrm[0] + ry * nrm[1]);
    if (t >= 0 && t <= L && c <= w / 2) return true;
    const sh = t - L;
    return sh >= 0 && sh <= hl && c <= (hw / 2) * (1 - sh / hl);
  };
}

/**
 * (11/17 4차 변경) 조각 하나의 착시 화살표 물들이기. near = 맞춰지는 자리에 얼마나 가까운가(0 = 멀다, 1 = 그 자리).
 * 화살표 자리의 종이도 평소엔 제각각 원래 색이고(흩어져 있어 수상하지 않게), 가까워질수록 장마다 정해 둔 문턱(thr)을 넘은
 * 종이부터 하나둘 화살표 색으로 물들어 그 자리에 서면 모두 같은 색 → 화살표가 완성돼요(사용자 의견: "흩어져 있다가 어느 범위 안에 서야 합쳐지게").
 * ~~(2차) 처음부터 전부 화살표 색, 바꾸는 건 안 보는 사이에~~ → 한 색 덩어리가 어디서나 보여 수상했어요.
 */
export function tint(c: ScatterChunk, levels: number[]) {
  // (11/17 5차 변경) 화살표마다 세기(0~1)를 받아 칠해요. 세기는 world가 시간에 따라 부드럽게 바꿔 줘요 →
  // 흰 종이를 찾으면 완성된 화살표가 빠르게 흩어지며 사라지고(약 0.35초), 완성되는 순간에도 확 바뀌지 않아요
  const ic = c.mesh.instanceColor;
  if (!ic) return;
  const order = levels.map((_, i) => i).filter((i) => c.figs[i]?.length && Math.abs(levels[i] - c.levels[i]) >= 0.004);
  if (!order.length) return;
  order.sort((a, b) => levels[a] - levels[b]); // 겹친 종이는 더 센 화살표 색이 남게
  const arr = ic.array as Float32Array;
  for (const i of order) {
    const lv = levels[i];
    const col = new THREE.Color(c.def.figures![i].color);
    for (const k of c.figs[i]) {
      const t = c.thr[k];
      const x = Math.max(0, Math.min(1, (lv - (t - 0.1)) / 0.2));
      const m = x * x * (3 - 2 * x); // 문턱 근처에서 부드럽게 물듦
      for (let j = 0; j < 3; j++) {
        const lit = (j === 0 ? col.r : j === 1 ? col.g : col.b) * c.light[k * 3 + j] * FIG_GLOW;
        arr[k * 3 + j] = c.base[k * 3 + j] * (1 - m) + lit * m;
      }
    }
    c.levels[i] = lv;
  }
  ic.needsUpdate = true;
}

/** 흩뿌린 종이 한 묶음을 조각들로 지어요(쉬어 갈 수 있음). */
export function* buildScatter(def: Scatter, built: Built, lamps: Lamp[]): Generator<void, ScatterChunk[]> {
  const rnd = rng(def.seed);
  const base = new THREE.PlaneGeometry(def.note, def.note);
  const mat = noteMaterial();
  const colors = def.colors.map((c) => new THREE.Color(c));
  const step = def.note * 0.9;
  const dummy = new THREE.Object3D();
  const out: ScatterChunk[] = [];
  const tests = (def.figures ?? []).map(arrowTest);
  const rndThr = rng(def.seed + 977); // 물드는 문턱은 따로 뽑아요(포스트잇 배치는 전과 똑같게)
  type Item = { a: number; b: number; tilt: number; lift: number; c: THREE.Color; cell: number };
  const pick = (): Pick<Item, 'tilt' | 'c' | 'cell'> => ({
    tilt: (rnd() - 0.5) * 0.36,
    c: colors[Math.floor(rnd() * colors.length)],
    cell: Math.floor(rnd() * CELLS * CELLS),
  });

  for (const area of def.areas) {
    const f = FACES[area.face];
    const [W, H] = area.size;

    // 구운 빛을 30cm 간격으로 재 둬요
    const gu = Math.max(2, Math.ceil(W / 0.3) + 1), gv = Math.max(2, Math.ceil(H / 0.3) + 1);
    const grid: V3[] = [];
    for (let j = 0; j < gv; j++) {
      for (let i = 0; i < gu; i++) {
        const p = onFace(area.at, f, (i / (gu - 1) - 0.5) * W, (j / (gv - 1) - 0.5) * H, 0.01);
        grid.push(built.baker.light(p, f.n, f.u, f.v));
      }
      yield;
    }
    const lightAt = (a: number, b: number): V3 => {
      const x = Math.min(gu - 1.001, Math.max(0, (a / W + 0.5) * (gu - 1)));
      const y = Math.min(gv - 1.001, Math.max(0, (b / H + 0.5) * (gv - 1)));
      const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
      const g = (ii: number, jj: number) => grid[jj * gu + ii];
      return [0, 1, 2].map((k) =>
        (g(i, j)[k] * (1 - fx) + g(i + 1, j)[k] * fx) * (1 - fy) + (g(i, j + 1)[k] * (1 - fx) + g(i + 1, j + 1)[k] * fx) * fy) as V3;
    };

    // 천장등 자리는 비워요
    const holes = area.face === 'y-' ? lamps.map((l) => ({ x: l.at[0], z: l.at[2], r: l.size[0] / 2 + def.note * 0.7 })) : [];

    // 조각 나누기
    const nu = Math.max(1, Math.round(W / def.chunk)), nv = area.face === 'y-' ? Math.max(1, Math.round(H / def.chunk)) : 1;
    const chunkOf = (a: number, b: number): [number, number] => [
      Math.min(nu - 1, Math.max(0, Math.floor((a / W + 0.5) * nu))),
      Math.min(nv - 1, Math.max(0, Math.floor((b / H + 0.5) * nv))),
    ];

    // (11/17 추가) 흰 종이 자리 위에 겹쳐 붙일 종이(반쯤 가림): 모서리 쪽 세 장
    const COVER = [[0.04, 0.028], [-0.034, 0.046], [0.046, -0.036]];
    const covers: Item[] = [];
    for (const cv of def.covers ?? []) {
      if (cv.face !== area.face) continue;
      const rel = [cv.at[0] - area.at[0], cv.at[1] - area.at[1], cv.at[2] - area.at[2]];
      const a0 = rel[0] * f.u[0] + rel[1] * f.u[1] + rel[2] * f.u[2];
      const b0 = rel[0] * f.v[0] + rel[1] * f.v[1] + rel[2] * f.v[2];
      if (Math.abs(a0) > W / 2 || Math.abs(b0) > H / 2) continue;
      COVER.forEach(([da, db], k) => covers.push({ a: a0 + da, b: b0 + db, lift: 0.014 + k * 0.002, ...pick(), tilt: (rnd() - 0.5) * 0.6 }));
    }

    const cols = Math.floor(W / step), rows = Math.floor(H / step);
    for (let cj = 0; cj < nv; cj++) for (let ci = 0; ci < nu; ci++) {
      const items: Item[] = [];
      for (let j = 0; j < rows; j++) {
        if (Math.floor((j / rows) * nv) !== cj) continue;
        for (let i = 0; i < cols; i++) {
          if (Math.floor((i / cols) * nu) !== ci) continue;
          const a = (i + 0.5) * step - W / 2 + (rnd() - 0.5) * step * 0.35;
          const b = (j + 0.5) * step - H / 2 + (rnd() - 0.5) * step * 0.35;
          const lift = 0.002 + rnd() * 0.006; // 겹친 종이끼리 깜빡이지 않게 벽에서 조금씩 다른 거리
          const it = { a, b, lift, ...pick() };
          if (holes.length) {
            const p = onFace(area.at, f, a, b);
            if (holes.some((h) => Math.hypot(p[0] - h.x, p[2] - h.z) < h.r)) continue;
          }
          items.push(it);
        }
      }
      for (const it of covers) {
        const [i, j] = chunkOf(it.a, it.b);
        if (i === ci && j === cj) items.push(it);
      }
      if (!items.length) continue;
      const geo = base.clone();
      const cells = new Float32Array(items.length * 2);
      const baseCol = new Float32Array(items.length * 3);
      const light = new Float32Array(items.length * 3);
      const figs: number[][] = tests.map(() => []);
      const thr = new Float32Array(items.length).map(() => 0.08 + rndThr() * 0.82);
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      const col = new THREE.Color();
      items.forEach((it, k) => {
        const pos = onFace(area.at, f, it.a, it.b, it.lift);
        dummy.position.set(...pos);
        dummy.rotation.set(f.rx, f.ry, it.tilt);
        dummy.updateMatrix();
        mesh.setMatrixAt(k, dummy.matrix);
        const L = lightAt(it.a, it.b);
        light.set(L, k * 3);
        const gl = def.glow ?? GLOW; // (11/20) 보호색 포스트잇은 1(벽·표지판과 같은 밝기)
        col.setRGB(it.c.r * L[0] * gl, it.c.g * L[1] * gl, it.c.b * L[2] * gl);
        baseCol.set([col.r, col.g, col.b], k * 3);
        mesh.setColorAt(k, col);
        cells[k * 2] = (it.cell % CELLS) / CELLS;
        cells[k * 2 + 1] = 1 - (Math.floor(it.cell / CELLS) + 1) / CELLS; // 그림의 위쪽 줄이 uv의 위쪽
        tests.forEach((t, n) => { if (t(pos)) figs[n].push(k); });
      });
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.visible = false;
      mesh.name = `${def.id}-${area.face}-${ci}-${cj}`;
      // "보이는가" 판정 점: 조각 위에 고르게 3×3, 조금 안쪽
      const a0 = (ci / nu - 0.5) * W, a1 = ((ci + 1) / nu - 0.5) * W;
      const b0 = (cj / nv - 0.5) * H, b1 = ((cj + 1) / nv - 0.5) * H;
      const am = (a0 + a1) / 2, bm = (b0 + b1) / 2, ha = (a1 - a0) * 0.45, hb = (b1 - b0) * 0.45;
      const points = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]
        .map(([x, y]) => onFace(area.at, f, am + ha * x, bm + hb * y, 0.02));
      out.push({ def, mesh, points, base: baseCol, light, figs, thr, levels: new Float32Array(tests.length) });
      yield;
    }
  }
  return out;
}
