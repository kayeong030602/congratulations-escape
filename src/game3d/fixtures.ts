/**
 * (11/20 추가, 6단계 계단참) 방에 붙는 것들 — 계단실 난간, 코드로 그린 표지판, 홀로그램 글씨.
 * world.ts가 방을 지을 때 불러 써요(world.ts가 너무 길어져서 따로 뺐어요).
 *
 *   railsGen  : 난간(손잡이 막대 + 아래 막대 + 살대 + 끝 기둥). 계단을 따라 기울어진 막대라 상자(축 맞춤)로는 못 지어서 직접 만들어요.
 *               빛은 난간을 따라 다섯 점에서 구운 빛을 재서 이어 칠해요(재는 동안 쉬어 가며 — 폰에서 멈추지 않게).
 *   signTexture: 짙은 판에 글씨 줄(계단실 층 표시 0-1~0-4, 영어 안내판) — 그림 파일 없이 코드로.
 *   buildHolo : 홀로그램 글씨(꼭대기 congratulations! 문) — 두께(뒤로 겹친 글씨 판) + 보는 각도에 따라 흐르는 무지개 빛 + 빛 번짐.
 *               처음 눈에 들어오는 순간 깜빡이며 켜져요(holoOn).
 */
import * as THREE from 'three';
import type { Baker } from '../lab3d/bake.ts';
import { FACES } from './faces.ts';
import type { Face, Rail, V3 } from './schema.ts';

// ── 난간 ─────────────────────────────────────────────

const RAIL_COLOR = '#3b3029'; // 영상의 어두운 갈색 난간
const RAIL = { hand: [0.055, 0.045], shoe: [0.032, 0.032], bar: 0.018, post: 0.06 } as const;

/** 두 점을 잇는 각진 막대(가로 w × 세로 h)의 꼭짓점·색을 더해요. shade = 면이 위를 볼수록 밝게(모양이 읽히게). */
function addBar(pos: number[], col: number[], idx: number[], p0: THREE.Vector3, p1: THREE.Vector3, w: number, h: number, c0: THREE.Color, c1: THREE.Color) {
  const d = p1.clone().sub(p0).normalize();
  const ref = Math.abs(d.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(d, ref).normalize();
  const up = new THREE.Vector3().crossVectors(side, d).normalize();
  const corner = (i: number, j: number, k: number) => (i ? p1 : p0).clone().addScaledVector(side, (j - 0.5) * w).addScaledVector(up, (k - 0.5) * h);
  // 면 여섯: [네 귀퉁이 (i,j,k)], 바깥 방향
  const faces: [number[][], THREE.Vector3][] = [
    [[[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], up],
    [[[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], up.clone().negate()],
    [[[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], side],
    [[[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], side.clone().negate()],
    [[[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], d],
    [[[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], d.clone().negate()],
  ];
  for (const [quad, n] of faces) {
    const shade = 0.62 + 0.38 * n.y;
    const base = pos.length / 3;
    for (const [i, j, k] of quad) {
      const v = corner(i, j, k);
      pos.push(v.x, v.y, v.z);
      const c = i ? c1 : c0;
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** 난간 전부를 한 덩어리로(그리기 1회). 빛은 구운 빛(baker)에서. 생성기라 짓는 사이사이 쉬어 가요. */
export function* railsGen(rails: Rail[], baker: Baker): Generator<void, THREE.Mesh | null> {
  if (!rails.length) return null;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const alb = new THREE.Color(RAIL_COLOR); // 선형 색
  for (const r of rails) {
    const A = new THREE.Vector3(...r.from), B = new THREE.Vector3(...r.to);
    const h = r.h ?? 0.9;
    // 난간을 따라 다섯 점의 빛(난간 높이의 가운데에서, 위를 보는 면으로 — 튕겨 오는 빛까지)
    const lights: THREE.Color[] = [];
    for (let i = 0; i < 5; i++) {
      const p = A.clone().lerp(B, i / 4);
      const l = baker.light([p.x, p.y - h * 0.4, p.z], [0, 1, 0], [1, 0, 0], [0, 0, -1]);
      lights.push(new THREE.Color(l[0] * alb.r, l[1] * alb.g, l[2] * alb.b));
      yield;
    }
    const at = (t: number) => {
      const f = Math.max(0, Math.min(3.999, t * 4)), i = Math.floor(f);
      return lights[i].clone().lerp(lights[i + 1], f - i);
    };
    const down = (v: THREE.Vector3, dy: number) => v.clone().setY(v.y - dy);
    const hh = RAIL.hand[1] / 2;
    // 손잡이 막대, 아래 막대
    addBar(pos, col, idx, down(A, hh), down(B, hh), RAIL.hand[0], RAIL.hand[1], at(0), at(1));
    addBar(pos, col, idx, down(A, h), down(B, h), RAIL.shoe[0], RAIL.shoe[1], at(0).multiplyScalar(0.8), at(1).multiplyScalar(0.8));
    // 살대: 바닥 위 길이를 gap 간격으로
    const run = Math.hypot(B.x - A.x, B.z - A.z);
    const n = Math.max(1, Math.round(run / (r.gap ?? 0.13)));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const top = A.clone().lerp(B, t);
      addBar(pos, col, idx, down(top, h), down(top, RAIL.hand[1]), RAIL.bar, RAIL.bar, at(t).multiplyScalar(0.75), at(t));
    }
    // 끝 기둥(바닥 속까지 내려가요 — 계단 한 칸 높이만큼 더)
    if (r.posts !== false) {
      for (const E of [A, B]) addBar(pos, col, idx, down(E, h + 0.2), E.clone().setY(E.y + 0.05), RAIL.post, RAIL.post, at(E === A ? 0 : 1).multiplyScalar(0.7), at(E === A ? 0 : 1));
    }
    yield;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.name = 'rails';
  return mesh;
}

// ── 표지판 ───────────────────────────────────────────

/**
 * 짙은 판에 글씨 줄(가운데 맞춤, 굵은 고딕). 판 비율은 소품 크기(plane)를 따라요. 둘레에 옅은 테두리.
 * 글씨 크기는 가장 긴 줄이 판 폭의 86% 안에 들어오게 저절로 줄여요.
 */
export function signTexture(lines: string[], plane: [number, number], bg: string, fg: string): THREE.CanvasTexture {
  const W = 1024, H = Math.max(96, Math.round((W * plane[1]) / plane[0]));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const e = Math.round(Math.min(W, H) * 0.045);
  c.strokeStyle = fg;
  c.globalAlpha = 0.45;
  c.lineWidth = Math.max(3, e * 0.28);
  c.strokeRect(e, e, W - e * 2, H - e * 2);
  c.globalAlpha = 1;
  const font = (px: number) => `bold ${px}px Arial, Helvetica, "Helvetica Neue", sans-serif`;
  let size = Math.floor((H * 0.74) / lines.length / 1.2);
  c.font = font(size);
  while (size > 8 && Math.max(...lines.map((l) => c.measureText(l).width)) > W * 0.86) c.font = font(--size);
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const lh = size * 1.2;
  lines.forEach((l, i) => c.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * lh));
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ── 홀로그램 글씨 ─────────────────────────────────────

const HOLO_LAYERS = 9; // 뒤로 겹친 판 수(두께)
const HOLO_DEPTH = 0.02; // 글씨 두께(미터)
/** 두께가 정면에서도 보이게 뒤 겹을 오른쪽 아래로 조금씩 밀어요(입체 간판처럼 옆면이 드러남, 맨 뒤 겹 기준 미터) */
const HOLO_SHIFT: [number, number] = [0.006, -0.011];

const HOLO_VERT = /* glsl */ `
attribute float layer;
varying vec2 vUv;
varying vec3 vW;
varying float vL;
void main() {
  vUv = uv;
  vL = layer;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const HOLO_COMMON = /* glsl */ `
uniform float uTime, uOn;
uniform vec3 uU, uV;
varying vec2 vUv;
varying vec3 vW;
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
// 보는 각도에 따라 흐르는 무지개(홀로그램 박): 글씨를 따라 색 띠가 있고, 옆·위아래로 움직이면 미끄러져요
vec3 irid() {
  vec3 V = normalize(cameraPosition - vW);
  float h = vUv.x * 0.85 - dot(V, uU) * 1.6 - dot(V, uV) * 0.7 + uTime * 0.045;
  return mix(vec3(1.0), hue(h), 0.6);
}`;
const HOLO_FRAG = HOLO_COMMON + /* glsl */ `
uniform sampler2D uMap;
varying float vL;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 ir = irid();
  if (vL < 0.999) {
    // 두께(뒤 겹): 글씨 모양 그대로, 뒤로 갈수록 어둡고 짙은 무지개 — 입체 글씨의 옆면
    if (t.a < 0.5) discard;
    vec3 side = mix(t.rgb, hue(vUv.x * 0.85 + uTime * 0.045 + 0.35), 0.55);
    gl_FragColor = vec4(side * (0.12 + 0.42 * vL), uOn);
    return;
  }
  if (t.a < 0.02) discard;
  vec3 V = normalize(cameraPosition - vW);
  float sweep = exp(-pow((vUv.x - fract(uTime * 0.14) * 1.8 + 0.4) * 5.0, 2.0)); // 몇 초마다 빛이 글씨를 쓸고 지나가요
  float foil = 0.92 + 0.08 * sin(vUv.x * 520.0 + vUv.y * 170.0 + dot(V, uU) * 34.0); // 고운 홀로그램 결
  float scan = 0.94 + 0.06 * sin(vW.y * 85.0 - uTime * 2.2); // 천천히 오르는 가는 줄
  float h = vUv.x * 0.85 - dot(V, uU) * 1.6 - dot(V, uV) * 0.7 + uTime * 0.045;
  float rim = smoothstep(0.08, 0.5, t.a) * (1.0 - smoothstep(0.6, 0.98, t.a)); // 글씨 가장자리 띠(네온처럼 빛나는 테)
  vec3 c = mix(t.rgb, hue(h) * 1.05, 0.55) * foil * scan * (1.4 + 0.6 * sweep) + rim * 0.25 * hue(h + 0.3);
  gl_FragColor = vec4(c, t.a * uOn);
}`;
const GLOW_FRAG = HOLO_COMMON + /* glsl */ `
uniform sampler2D uGlow;
void main() {
  vec4 g = texture2D(uGlow, vUv);
  float pulse = 0.82 + 0.18 * sin(uTime * 1.6);
  // (11/20 2차, 사용자 의견: 빛 번짐이 지저분함) 거의 안 보이게 — 글씨 바로 둘레에만 아주 옅게
  vec3 c = mix(g.rgb, irid() * 1.2, 0.5) * g.a * g.a * 0.14 * pulse * uOn;
  gl_FragColor = vec4(c, 1.0);
}`;

export interface HoloBuild {
  /** 글씨(겹친 판) — 소품 자리에 놓여요. 빛 번짐은 이 아래 자식 */
  mesh: THREE.Mesh;
  u: { uTime: { value: number }; uOn: { value: number } };
  /** 처음 눈에 들어온 뒤 흐른 시간(초, -1 = 아직) */
  t: number;
}

/** 홀로그램 글씨를 지어요(그림 두 장은 world.ts가 불러 줘요). face = 붙는 면(u·v 방향으로 무지개가 흘러요). */
export function buildHolo(map: THREE.Texture, glow: THREE.Texture, plane: [number, number], face: Face): HoloBuild {
  const f = FACES[face];
  const u = {
    uTime: { value: 0 }, uOn: { value: 0 },
    uU: { value: new THREE.Vector3(...(f.u as V3)) }, uV: { value: new THREE.Vector3(...(f.v as V3)) },
  };
  // 겹친 판: 뒤(벽 쪽)부터 앞으로 — 그리는 순서가 뒤 → 앞이라 앞 글씨가 위에 와요
  const pos: number[] = [], uv: number[] = [], layer: number[] = [], idx: number[] = [];
  const [w, h] = plane;
  for (let l = 0; l <= HOLO_LAYERS; l++) {
    const k = 1 - l / HOLO_LAYERS; // 0 = 앞 겹, 1 = 맨 뒤
    const z = 0.002 + (HOLO_DEPTH * l) / HOLO_LAYERS, b = pos.length / 3;
    const dx = HOLO_SHIFT[0] * k, dy = HOLO_SHIFT[1] * k;
    for (const [x, y, s, t] of [[-w / 2, -h / 2, 0, 0], [w / 2, -h / 2, 1, 0], [w / 2, h / 2, 1, 1], [-w / 2, h / 2, 0, 1]]) {
      pos.push(x + dx, y + dy, z); uv.push(s, t); layer.push(l / HOLO_LAYERS);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true,
    uniforms: { ...u, uMap: { value: map } },
  }));
  mesh.renderOrder = 2;
  // 빛 번짐: 문 면에 빛처럼 더해요(글씨보다 먼저 그림)
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.04, h * 1.08), new THREE.ShaderMaterial({
    vertexShader: HOLO_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...u, uGlow: { value: glow } },
  }));
  gm.geometry.setAttribute('layer', new THREE.Float32BufferAttribute([1, 1, 1, 1], 1));
  gm.position.z = 0.001;
  gm.renderOrder = 1;
  mesh.add(gm);
  return { mesh, u, t: -1 };
}

/** 처음 눈에 들어온 뒤 t초 → 켜진 정도(형광등처럼 몇 번 깜빡이다 켜져요). */
const HOLO_ON: [number, number][] = [[0, 0.55], [0.07, 0.05], [0.16, 0.75], [0.22, 0.15], [0.38, 0.9], [0.45, 0.4], [0.6, 1]];
export function holoOn(t: number): number {
  if (t < 0) return 0;
  let k = 0;
  for (const [at, v] of HOLO_ON) if (t >= at) k = v;
  return k;
}
