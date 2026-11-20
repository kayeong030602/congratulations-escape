/**
 * 3D 세계 — 방을 짓고, 걷고, 조준 선을 쏘고, 그려요. 게임 규칙은 몰라요(logic.ts가 알아요).
 *
 * 논리에게 받는 것: enter(방, 자리) / warp(자리)  ← WorldPort
 * 논리에게 주는 것: sense() — 지금 조준한 대상과 서 있는 영역
 * 소품이 보이고 숨는 것은 sync(test)가 조건을 물어보고 스스로 맞춰요.
 *
 * 방 짓기·조명 굽기·걷기는 시험 방(src/lab3d)에서 확인받은 것을 그대로 가져다 써요.
 * 화면 효과(VHS·OSD·자동 노출)는 screen/camcorder.ts가 맡아요.
 * (11/17 추가) 전체 화면 영상(인트로·옛 녹화·엔딩)은 screen/clips.ts — 틀고 있는 동안은 3D 대신 영상을 그려요.
 * (11/17 추가) 생겼다 사라지는 벽(parts)도 여기서 보이고 숨기고, 보일 때만 부딪히고 시선을 가려요.
 * (11/17 추가) prebuild(): 다음 방을 한 프레임에 몇 ms씩 나눠 미리 지어 둬요 → 벽을 통과하는 순간 멈추지 않아요(폰).
 */
import * as THREE from 'three';
import { bakePace, buildSpaceAsync, runSliced, type Built, type BuiltPart } from '../lab3d/build.ts';
import { FACES, onFace } from './faces.ts';
import { buildScatter, tint, type ScatterChunk } from './scatter.ts';
import { MATS, dottedTexture } from '../lab3d/textures.ts';
import { matTexture } from '../lab3d/build.ts';
import { KEY_SCALE, keyLayout } from './keys.ts';
import { buildHolo, holoOn, railsGen, signTexture, type HoloBuild } from './fixtures.ts'; // (11/20) 계단참: 홀로그램 글씨·표지판·난간
import { Walker } from '../lab3d/walker.ts';
import type { WorldPort } from './logic.ts';
import { Camcorder, type Look } from './screen/camcorder.ts';
import { Clips, TapeClip } from './screen/clips.ts';
import type { OsdState } from './screen/osd.ts';
import type { Box, Cond, FarHall, Fx, KeyBunch, LiveLight, Part, Prop, Room, RoomId, Spawn, Sun, Target, V3 } from './schema.ts';
import type { TapeView } from './tape.ts';

const FOV = 52; // 세로 화각(도). 사용자가 확인한 값 — 바꾸지 않아요
const PASS_SPEED = 1.5; // 벽을 지나갈 때 앞으로 나아가는 빠르기(초당 미터). 걷기(1.35)보다 살짝 빠르게
const STRIDE = 0.72; // 걸음 길이(walker.ts와 같게) — 벽을 지나는 동안에도 걸음 출렁임을 이어요
/** fade 전환: 어두워지는 시간·밝아지는 시간(초). (11/18) 테이프에서 순간이동을 다시 그릴 때도 같은 값 */
const FADE_OUT = 0.22, FADE_IN = 0.26;

/**
 * 너머로 가는 벽(gen: 'portal') — (11/17 변경) 멀리서는 그냥 벽이고, 다가갈수록 "문의 모양"이 서서히 떠올라요.
 *   - 문틈(양옆·위의 가는 어두운 줄)과 안쪽 그늘이 모양을 알려 줘요(지지직만으로는 모양이 안 보여서). 손잡이는 없어요(11/17 사용자 의견)
 *   - 문 면에는 은은한 지지직이 끼고, 아주 가까이 가면 더 짙어져요
 *   - 얼마나 보이는지(uFade)와 지지직 세기(uNear)는 world.render가 카메라와 문 사이 거리로 정해요
 */
const PORTAL_FADE: [far: number, near: number] = [3.8, 0.8]; // (11/17 변경 6.0 → 3.8) 모퉁이를 돌고 몇 걸음 더 가야(약 3.5m) 떠오르기 시작해 0.8m에서 또렷
const PORTAL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;
const PORTAL_FRAG = /* glsl */ `
uniform float uTime, uFade, uNear;
uniform vec2 uSize;
uniform vec3 uWall;
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 p = vUv * uSize;                                     // 문 위의 자리(미터)
  float e = min(min(p.x, uSize.x - p.x), uSize.y - p.y);    // 양옆·위 가장자리까지
  float seam = 1.0 - smoothstep(0.01, 0.022, e);            // 문틈: 2cm쯤의 어두운 줄
  float shade = (1.0 - smoothstep(0.022, 0.09, e)) * 0.45;  // 문틈 안쪽의 옅은 그늘
  // 문 면: 화면 화소 단위의 고운 지지직(줄마다 1~3칸 옆으로 끌림) + 천천히 숨 쉬는 물결
  float f = floor(uTime * 24.0);
  vec2 g = floor(gl_FragCoord.xy);
  float len = 1.0 + floor(hash(vec2(g.y, f)) * 3.0);
  float n = hash(vec2(floor(g.x / len) + floor(hash(vec2(g.y, f + 1.0)) * 40.0), g.y + f * 31.0));
  float wave = 0.5 + 0.5 * sin(vUv.y * 6.0 - uTime * 1.2 + sin(vUv.x * 4.0 + uTime * 0.6));
  vec3 c = uWall * (0.88 + (n - 0.5) * (0.3 + 0.55 * uNear) * (0.6 + 0.4 * wave));
  float a = 0.55 + 0.3 * uNear;
  c = mix(c, uWall * 0.6, shade);  a = mix(a, 1.0, shade);
  c = mix(c, uWall * 0.2, seam);   a = mix(a, 1.0, seam);
  gl_FragColor = vec4(c, a * uFade);
}`;

interface PropState { def: Prop; mesh: THREE.Mesh; points: V3[]; portal?: THREE.ShaderMaterial; held?: boolean; holo?: HoloBuild } // (11/20) holo = 홀로그램 글씨
/** dis = 지지직 사라짐(나타남)이 진행 중: t 흐른 초, want 끝나면 될 상태, u 셰이더 값 */
interface PartState {
  def: Part; b: BuiltPart; on: boolean;
  u?: { uDissolve: { value: number }; uTime: { value: number } };
  dis?: { t: number; want: boolean };
  /** (11/19 추가) 문(swap: 'swing'): 지금 열린 각도(도), 열리는 중이면 sw. (6단계 2차) close = 닫히는 중(점점 빨리 — 쾅) */
  ang?: number;
  sw?: { t: number; from: number; to: number; ms: number; close?: boolean };
}

/**
 * (11/17 추가) 지지직 사라짐: 벽 위에 흑백 알갱이가 끓다가, 줄마다 들쭉날쭉 조각이 빠져나가며 없어져요(uDissolve 0 → 1).
 * 하얀 방 뒤쪽 벽(사용자 의견: 뚝 사라지지 말고 지지직거리며).
 */
const DISSOLVE_GLSL = /* glsl */ `
  if (uDissolve > 0.0) {
    vec2 g = floor(gl_FragCoord.xy / 2.0);
    float f = floor(uTime * 24.0);
    // 고른 난수(사선 무늬가 안 생기게 — camcorder.ts와 같은 방식)
    vec2 q = fract((g + vec2(f * 13.1, f * 7.7)) * vec2(123.34, 456.21)); q += dot(q, q + 45.32);
    float h = fract(q.x * q.y);
    vec2 r2 = fract(vec2(g.y * 0.618, f * 0.37) * vec2(123.34, 456.21)); r2 += dot(r2, r2 + 45.32);
    float row = fract(r2.x * r2.y);
    if (h < uDissolve * 1.15 - 0.12 + (row - 0.5) * 0.35 * uDissolve) discard;
    float sp = step(0.55, fract(h * 13.0));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(sp), 0.6 * smoothstep(0.0, 0.35, uDissolve));
  }
`;
interface RoomBuild { built: Built; group: THREE.Group; props: PropState[]; parts: PartState[]; scat: ScatterChunk[]; sun?: SunBuild; live?: LiveBuild; far?: FarBuild; keys: KeyBuild[] }

/**
 * (11/19 6단계 추가) 켜고 끄는 등(방의 live). 방의 모든 면(벽·바닥·문·소품)에 셰이더 조각을 끼워 "그 점이 등에서 받는 빛"을 더하고,
 * 그림자를 드리우는 등(shadow)은 내 몸(세운 원기둥 + 머리)이 가리는 곳을 어둡게 해요 — 등 뒤에서 오는 빛이면 그림자가 앞으로 뻗어요.
 * 구운 빛(꼭짓점에 적어 둔 빛)은 uBase배로(정전 때 0.1쯤 — 다가오는 불만 남게).
 */
interface LiveBuild {
  def: LiveLight;
  u: Record<string, THREE.IUniform>;
  /** 등마다 지금 밝기(깜빡임 포함)·켜져야 하는가·켜지는 깜빡임 진행(초, -1 = 없음) */
  level: number[];
  want: boolean[];
  flick: number[];
  fixtures: THREE.Mesh[];
  base: number;
  baseWant: number;
  /** 테이프를 볼 때 그 시각의 상태(없으면 라이브) */
  tape: { on: boolean[]; dim: boolean } | null;
}
const LIVE_N = 8; // 한 방에 켜고 끄는 등 최대 개수(셰이더 칸 수)
/** 형광등이 켜질 때 깜빡임: [시각(초), 밝기] — 툭툭 끊기다 켜져요 */
const LIVE_FLICK: [number, number][] = [[0, 0.9], [0.05, 0], [0.11, 1], [0.15, 0.1], [0.24, 0.8], [0.29, 0.25], [0.36, 1]];
const LIVE_GLSL_V = 'varying vec3 vLiveP;\n';
/**
 * 켜고 끄는 등의 빛 계산(벽·바닥 셰이더 조각과 열쇠 셰이더가 같이 써요).
 * (11/19 6단계 2차 추가) 끝없는 복도(FarHall)의 등: 일정한 간격이라, 각 점에서 가장 가까운 등 세 개만 계산해요(등이 몇 개든 같은 부담).
 */
const LIVE_GLSL_F = /* glsl */ `
#define LIVE_N ${LIVE_N}
uniform vec3 uLP[LIVE_N];
uniform vec3 uLC[LIVE_N];
uniform float uLS[LIVE_N];
uniform vec3 uMe;
uniform float uBase;
uniform vec3 uLMin, uLMax;
uniform vec3 uFO, uFD, uFC, uFMin, uFMax; // 끝없는 복도: 가까운 끝(등 높이), 뻗는 쪽, 등 색 × 세기, 빛이 닿는 공간
uniform vec4 uFP;                          // 간격, 등 수, 먼 쪽부터 켜진 수, 보임(0/1)
// 내 몸(세운 원기둥 반지름 20cm, 1.38m 위는 머리 12cm, 높이 1.72m)이 p → 등 사이의 빛을 가리는 정도 0~1
float meBlock(vec3 p, vec3 l) {
  vec2 a = p.xz, ab = l.xz - p.xz, m = uMe.xz;
  float t = clamp(dot(m - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
  float d = length(a + ab * t - m);
  float y = mix(p.y, l.y, t) - uMe.y;
  float r = y < 1.38 ? 0.2 : 0.12;
  float body = step(-0.05, y) * step(y, 1.72);
  return body * (1.0 - smoothstep(r - 0.07, r + 0.09, d)) * step(0.015, t);
}
// 등 하나: 바로 오는 빛(그림자) + 벽에 튕겨 온 은은한 빛. spec = 금속 반짝임(열쇠)
vec3 lampTerm(vec3 p, vec3 n, vec3 v, vec3 lp, vec3 c, float shadow, inout vec3 spec) {
  vec3 L = lp - p;
  float d2 = max(dot(L, L), 1e-4);
  vec3 dir = L * inversesqrt(d2);
  // 천장 등은 아래를 비춰요. 좁은 복도는 벽에 튕기며 빛이 멀리까지 가서, 거리에 따라 덜 가파르게 줄여요(제곱 대신 1.5제곱)
  float fall = 1.0 / pow(max(d2, 0.25), 0.75);
  float sh = shadow > 0.0 ? 1.0 - 0.72 * meBlock(p, lp) : 1.0;
  float ce = max(0.0, dir.y);
  spec += c * pow(max(dot(n, normalize(dir + v)), 0.0), 10.0) * ce * fall * sh;
  return c * (max(0.0, dot(n, dir)) * ce * fall * sh + 0.05 / (1.0 + d2 * 0.3));
}
vec3 liveLightNS(vec3 p, vec3 n, vec3 v, inout vec3 spec) {
  bool inBox = all(greaterThanEqual(p, uLMin)) && all(lessThanEqual(p, uLMax));
  bool inFar = uFP.w > 0.0 && all(greaterThanEqual(p, uFMin)) && all(lessThanEqual(p, uFMax));
  vec3 e = vec3(0.0);
  if (!inBox && !inFar) return e;
  for (int i = 0; i < LIVE_N; i++) {
    vec3 c = uLC[i];
    if (c.r + c.g + c.b <= 0.0) continue;
    e += lampTerm(p, n, v, uLP[i], c, uLS[i], spec);
  }
  if (uFP.w > 0.0 && uFP.z > 0.0) {
    float kc = floor(dot(p - uFO, uFD) / uFP.x);
    for (int j = -1; j <= 1; j++) {
      float k = kc + float(j);
      if (k < 0.0 || k >= uFP.y || k < uFP.y - uFP.z) continue;
      e += lampTerm(p, n, v, uFO + uFD * (uFP.x * (k + 0.5)), uFC, 1.0, spec);
    }
  }
  return e;
}
vec3 liveLight(vec3 p) {
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  vec3 v = normalize(cameraPosition - p);
  if (dot(n, v) < 0.0) n = -n;
  vec3 spec = vec3(0.0);
  return liveLightNS(p, n, v, spec);
}
`;

/**
 * (11/19 6단계 2차 추가) 3D 열쇠 셰이더: 은색 금속(어두운 바탕 + 등 빛의 반짝임 + 가장자리 광택), 빨간 점 스티커는 무광.
 * 빛은 켜고 끄는 등 그대로(내 그림자도) + 그 자리의 구운 빛 × uBase.
 */
const KEY_VERT = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vP = wp.xyz;
  vN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const KEY_FRAG = LIVE_GLSL_F + /* glsl */ `
uniform vec3 uKB;
uniform vec3 uAlb;
uniform float uMetal;
varying vec3 vP;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vP);
  vec3 spec = vec3(0.0);
  vec3 e = uKB * uBase + liveLightNS(vP, n, v, spec);
  // 금속: 몸은 어둡게, 등 빛이 비치는 각도의 면만 환하게 반짝(기울어진 열쇠마다 달라요), 가장자리는 살짝 어둡게 — 바닥과 또렷이 구분
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  vec3 c = uAlb * e * mix(1.0, 0.75, uMetal) + spec * uMetal * 4.5 * uAlb;
  c *= 1.0 - 0.35 * rim * uMetal;
  gl_FragColor = vec4(c, 1.0);
}`;

/**
 * (11/19 2차 추가) 창으로 들어오는 햇살(방의 sun). 방의 모든 면(벽·바닥·문·손자국 그림)에 셰이더 조각을 끼워,
 * 그 점에서 햇빛 반대 방향으로 거슬러 올라가 창 안에 들면(가운데 십자 창살은 그늘) 햇살 색을 더해요. 멀수록 가장자리가 번져요.
 */
interface SunBuild {
  def: Sun;
  u: Record<string, THREE.IUniform>;
  extras: THREE.Object3D[]; // 빛줄기·먼지·창 밖 빛
}
const SUN_GLSL_V = 'varying vec3 vSunP;\n';
const SUN_GLSL_F = /* glsl */ `
uniform float uSun, uSunBar;
uniform vec3 uSunDir, uSunCol, uWinC, uWinU, uWinV, uSunMin, uSunMax;
varying vec3 vSunP;
vec3 sunLight(vec3 p) {
  if (uSun <= 0.0) return vec3(0.0);
  if (any(lessThan(p, uSunMin)) || any(greaterThan(p, uSunMax))) return vec3(0.0);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  if (dot(n, cameraPosition - p) < 0.0) n = -n;
  float ndl = dot(n, -uSunDir);
  if (ndl <= 0.0) return vec3(0.0);
  vec3 wn = normalize(cross(uWinU, uWinV));
  float t = dot(p - uWinC, wn) / dot(uSunDir, wn); // 햇빛을 거슬러 창까지의 거리
  if (t <= 0.0) return vec3(0.0);
  vec3 q = p - uSunDir * t - uWinC;
  vec2 uv = vec2(dot(q, uWinU) / dot(uWinU, uWinU), dot(q, uWinV) / dot(uWinV, uWinV)); // 창 안 = -1~1
  float soft = 0.025 + t * 0.022;
  float m = (1.0 - smoothstep(1.0 - soft, 1.0 + soft, abs(uv.x))) * (1.0 - smoothstep(1.0 - soft, 1.0 + soft, abs(uv.y)));
  vec2 bar = vec2(uSunBar / length(uWinU), uSunBar / length(uWinV));
  m *= smoothstep(bar.x - soft * 0.5, bar.x + soft * 0.5, abs(uv.x)) * smoothstep(bar.y - soft * 0.5, bar.y + soft * 0.5, abs(uv.y));
  return uSunCol * m * sqrt(ndl) * uSun;
}
`;
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`;
const BEAM_FRAG = /* glsl */ `
uniform float uSun, uBeam;
uniform vec3 uSunCol;
varying vec2 vUv;
void main() {
  float a = uBeam * uSun * pow(1.0 - vUv.y, 1.3) * smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
  gl_FragColor = vec4(uSunCol * a, 1.0);
}`;
const MOTE_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime, uRes;
varying float vA;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.21 + aSeed * 6.3), sin(uTime * 0.17 + aSeed * 9.1) * 0.6, cos(uTime * 0.19 + aSeed * 4.7)) * 0.05;
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uRes * 0.0035 / -mv.z, 1.0, 3.0);
  vA = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed) + aSeed * 20.0);
}`;
const MOTE_FRAG = /* glsl */ `
uniform float uSun;
uniform vec3 uSunCol;
varying float vA;
void main() { gl_FragColor = vec4(uSunCol * 0.22 * vA * uSun, 1.0); }`;

/** 캠코더 앞에 든 종이의 자리(카메라 기준: 가운데 살짝 아래, 30cm 앞)와 기울기(손에 든 듯 살짝 비뚤게). */
// (11/19 2차 변경, 사용자 의견) ~~가운데 살짝 아래(y -0.035)~~ → 뒤집은 종이의 빨간 점이 화면 한가운데에 오게(빨간 점 줌 → 갈색 문이 자연스럽게)
const HOLD_AT = new THREE.Vector3(-0.003, 0.004, -0.3);
const HOLD_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, -0.08, 0.1));
/** 떼기 움직임 길이(초): 벽에서 들림 → 캠코더 앞으로, 뒤집기. (11/18) 테이프에서 다시 그릴 때도 같은 값 */
const PICK_LIFT = 0.26, PICK_MOVE = 0.65, FLIP_LEN = 0.52;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
/** 형광등 깜빡임: 꺼짐·켜짐 길이(ms)를 번갈아 — 짧게 툭툭 끊기다가 길게 한 번 죽었다 살아나요. (11/18) 테이프에서도 같은 무늬 */
const FLICKER = [70, 60, 150, 45, 55, 210, 35, 80, 120, 40, 50, 280, 30, 60, 90];
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 소품이 "보이는가" 판정에 쓸 점: 가운데와 네 귀퉁이(조금 안쪽, 벽에서 2cm 띄움). */
function propPoints(def: Prop): V3[] {
  const f = FACES[def.face];
  const hw = def.plane[0] * 0.45, hh = def.plane[1] * 0.45;
  return [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => onFace(def.at, f, hw * a, hh * b, 0.02));
}
/** (11/19 추가) 빨간 점 전환(via: 'red'): 화면을 채우는 빨강, 식어서 된 갈색(빛의 세기), 길이(초) */
const RED: [number, number, number] = [0.72, 0.018, 0.014];
const BROWN: [number, number, number] = [0.085, 0.042, 0.024];
const RED_OUT = 1.1, RED_IN = 1.3;


/**
 * (11/17 추가) 종이 뒷면: 앞면 글씨가 뒤집혀 옅게 비치는 흰 종이 + 빨간 점(영상 41초~의 and you? 뒷면).
 */
function noteBack(front: THREE.Texture | null): THREE.CanvasTexture {
  const src = front?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const w = src?.width || 384, h = src?.height || 265;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f1f1ec';
  c.fillRect(0, 0, w, h);
  if (src) {
    c.save();
    c.globalAlpha = 0.14;
    c.translate(w, 0);
    c.scale(-1, 1);
    c.drawImage(src, 0, 0, w, h);
    c.restore();
  }
  c.fillStyle = 'rgba(0,0,0,0.09)'; // 위쪽 끈끈이 줄
  c.fillRect(0, 0, w, h * 0.12);
  const r = h * 0.12, cx = w * 0.47, cy = h * 0.57;
  c.fillStyle = '#e3261f';
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.beginPath(); c.arc(cx - r * 0.3, cy - r * 0.32, r * 0.32, 0, Math.PI * 2); c.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * (11/19 6단계 추가) 코드로 그린 열쇠(가로 256 × 세로 112, 배경 투명): 왼쪽 둥근 머리(구멍) + 오른쪽 톱니 날. 은색.
 * dot = 머리에 붙은 점 색(빨간 점 열쇠 / 어둠 속에선 어두운 회색).
 */
function keyTexture(dot?: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 112;
  const c = cv.getContext('2d')!;
  // 반짝이는 은색이 바닥보다 밝게 읽히게(빛은 바닥과 똑같이 받아서, 무늬 자체를 밝게) — 테두리는 가늘게
  const g = c.createLinearGradient(0, 18, 0, 96);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#e2e5ea'); g.addColorStop(1, '#a9adb4');
  c.fillStyle = g;
  c.strokeStyle = '#5d6066';
  c.lineWidth = 3;
  // 날(톱니): 어깨에서 끝까지, 아래쪽이 들쭉날쭉
  c.beginPath();
  c.moveTo(92, 40); c.lineTo(236, 40); c.lineTo(248, 52); c.lineTo(236, 70);
  for (const [x, y] of [[222, 70], [214, 82], [204, 70], [192, 70], [184, 86], [172, 70], [160, 70], [152, 80], [140, 70], [104, 70]]) c.lineTo(x, y);
  c.lineTo(92, 74); c.closePath();
  c.fill(); c.stroke();
  c.fillStyle = 'rgba(60,62,66,0.45)'; c.fillRect(104, 52, 124, 5); // 날의 홈
  // 머리: 둥근 판 + 구멍
  c.fillStyle = g;
  c.beginPath(); c.arc(56, 56, 46, 0, Math.PI * 2); c.fill(); c.stroke();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(30, 56, 11, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'source-over';
  c.beginPath(); c.arc(30, 56, 11, 0, Math.PI * 2); c.stroke();
  if (dot) {
    // 빨간 점 스티커(폰 화면에서도 보이게 머리의 절반쯤)
    c.fillStyle = dot;
    c.beginPath(); c.arc(64, 56, 25, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.beginPath(); c.arc(57, 48, 7, 0, Math.PI * 2); c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** (11/19 6단계 2차 추가) 끝없는 복도 셰이더 값(처음엔 꺼짐). */
function farUniforms(): Record<string, THREE.IUniform> {
  return {
    uFO: { value: new THREE.Vector3() }, uFD: { value: new THREE.Vector3(1, 0, 0) }, uFC: { value: new THREE.Vector3() },
    uFMin: { value: new THREE.Vector3() }, uFMax: { value: new THREE.Vector3() }, uFP: { value: new THREE.Vector4(1, 0, 0, 0) },
  };
}

/** (11/19 6단계 2차 추가) 켜고 끄는 등이 없는 방에서 열쇠 셰이더가 쓸 값(등 없음, 구운 빛 그대로). */
function liveOff(): Record<string, THREE.IUniform> {
  return {
    uLP: { value: Array.from({ length: LIVE_N }, () => new THREE.Vector3(0, -99, 0)) },
    uLC: { value: Array.from({ length: LIVE_N }, () => new THREE.Vector3()) },
    uLS: { value: Array(LIVE_N).fill(0) },
    uMe: { value: new THREE.Vector3() }, uBase: { value: 1 },
    uLMin: { value: new THREE.Vector3(1e9, 1e9, 1e9) }, uLMax: { value: new THREE.Vector3(-1e9, -1e9, -1e9) },
    ...farUniforms(),
  };
}

/** (11/19 6단계 2차 추가) 끝없는 복도: 지은 것(바닥·천장·양 벽 + 등 판)과 지금 켜진 등 수. */
interface FarBuild { def: FarHall; group: THREE.Group; fixtures: THREE.Mesh; lit: number }

/**
 * (11/19 6단계 2차 추가) 3D 열쇠 꾸러미: 은색 열쇠(한 번에 그리는 여러 개) + 빨간 점 열쇠 + 고리. 자세(자리·돌림)를 상태마다 미리 정해 두고
 * 상태가 바뀌면 그 사이를 움직여요(떨어짐 0.45초, 헤침 0.28초, 빨간 점 열쇠가 손잡이로 0.6초).
 */
interface KeyPose { p: THREE.Vector3; q: THREE.Quaternion }
interface KeyBuild {
  def: KeyBunch;
  inst: THREE.InstancedMesh;
  red: THREE.Mesh;
  ring: THREE.Mesh;
  dot: THREE.ShaderMaterial;
  /** 상태별 자세: [열쇠들…, 빨간 점 열쇠, 고리] */
  poses: Record<'hang' | 'f0' | 'f1' | 'f2' | 'use', KeyPose[]>;
  state: string;
  cur: KeyPose[];
  anim: { t: number; len: number; from: KeyPose[]; to: KeyPose[]; drop: boolean } | null;
  redOn: number;
  redWant: number;
}

/** (11/19 6단계 2차 추가) 열쇠 하나의 모양(길이 7.4cm): 둥근 머리(구멍) + 톱니 날, 두께 1.8mm + 모서리 깎임. 머리 가운데가 원점, 날은 +x 쪽. */
let keyGeo: THREE.ExtrudeGeometry | null = null;
const KEY_R = 0.0148; // 머리 반지름(캠코더 화면에서 뭉개지지 않게 실제보다 통통하게)
function keyGeometry(): THREE.ExtrudeGeometry {
  if (keyGeo) return keyGeo;
  const s = new THREE.Shape();
  const hb = 0.006, jx = Math.sqrt(KEY_R * KEY_R - hb * hb), ja = Math.atan2(hb, jx);
  s.moveTo(jx, hb);
  s.lineTo(0.068, hb); s.lineTo(0.075, 0); s.lineTo(0.068, -hb);
  for (const [x, y] of [[0.064, -hb], [0.061, -0.0105], [0.057, -hb], [0.052, -hb], [0.049, -0.01], [0.045, -hb], [0.04, -0.0095], [0.036, -hb]]) s.lineTo(x, y);
  s.lineTo(jx, -hb);
  s.absarc(0, 0, KEY_R, -ja, ja, true);
  const hole = new THREE.Path();
  hole.absarc(-0.0052, 0, 0.0042, 0, Math.PI * 2, false);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.0014, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 1, curveSegments: 12 });
  g.translate(0, 0, -0.0007);
  g.scale(KEY_SCALE, KEY_SCALE, KEY_SCALE); // 폰 화면에서도 보이게 조금 크게(keys.ts와 같은 배율)
  g.computeVertexNormals();
  return (keyGeo = g);
}

/**
 * (11/20 추가, 사용자 의견) 문손잡이 모양: 옆모습(반지름, 문에서 나온 길이)을 한 바퀴 돌려 깎아요.
 * 둥근 받침(지름 6.6cm, 모서리 둥긂) → 가는 목 → 둥근 손잡이(지름 5.7cm, 앞쪽이 살짝 납작) → 앞면 열쇠 구멍 원통(지름 1.7cm). 길이 7.35cm
 */
let knobGeo: THREE.LatheGeometry | null = null;
function knobGeometry(): THREE.LatheGeometry {
  if (knobGeo) return knobGeo;
  const prof: [number, number][] = [
    [0.0001, 0], [0.031, 0], [0.033, 0.003], [0.032, 0.007], [0.028, 0.0098], [0.013, 0.0118], // 받침
    [0.011, 0.016], [0.0108, 0.024], // 목
    [0.014, 0.029], [0.021, 0.035], [0.026, 0.042], [0.0285, 0.05], [0.028, 0.057], [0.025, 0.064], [0.019, 0.069], [0.011, 0.0715], // 손잡이
    [0.0085, 0.072], [0.0085, 0.0735], [0.0001, 0.0735], // 열쇠 구멍 원통
  ];
  return (knobGeo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32));
}

/** 걷기 입력. fwd 앞(+1)/뒤(-1), side 오른쪽(+1)/왼쪽(-1). */
export interface Move { fwd: number; side: number; run: boolean }

export class World implements WorldPort {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.05, 100); // (11/19 6단계 2차) 60 → 100m(끝없는 복도)
  readonly walker = new Walker([]);
  readonly screen: Camcorder;
  /** 전체 화면 영상. 틀고 있는 동안(active)은 3D 대신 이걸 그려요. */
  readonly clips = new Clips();

  room: Room | null = null;
  /** 줌 목표값과 지금 값(부드럽게 따라감). */
  zoom = 1;
  zoomCur = 1;
  time = 0;
  /** 내부 해상도의 세로 줄 수(4:3). */
  resH = 480;
  stats = { tris: 0, calls: 0, bakeMs: 0, scatter: 0 };

  private cur: RoomBuild | null = null;
  private cache = new Map<RoomId, Promise<RoomBuild>>();
  private textures = new Map<string, THREE.Texture>();
  private loader = new THREE.TextureLoader();
  private dark = 0; // 0 = 보임, 1 = 완전히 어두움(fade 전환)
  private pass = 0; // 벽을 지나는 중의 지지직 0~1
  private push = new THREE.Vector3(); // 벽을 지나는 동안 카메라를 몸보다 앞(뒤)에 두는 거리
  private pushWalked = 0; // 벽을 지나며 나아간 거리(걸음 출렁임용)
  private anims: { ms: number; t: number; fn: (k: number) => void; res: () => void }[] = [];
  private burst = 0; // 방을 옮길 때 잠깐 튀는 VHS 노이즈
  private glitchT = -1; // 영상 → 3D로 들어온 뒤 흐른 시간(초). -1 = 지지직 없음
  private lightsOff = 0; // (11/17 추가) 방의 불이 꺼진 정도 0~1(light 행동)
  private fill: [number, number, number, number] = [0, 0, 0, 0]; // (11/19 추가) 화면을 한 색으로 덮기(빨간 점 전환)
  private cold = 0; // (11/19 추가) 차가운 맨벽 화면 0~1(방의 cold 조건)
  private coldWant = 0;
  private coldTape = 0;
  private sunWant = 1; // (11/19 2차 추가) 햇살(방의 sun 조건)
  private sunTape = 1;
  private glitchLen = 1.25;
  private frustum = new THREE.Frustum();
  private mat4 = new THREE.Matrix4();
  private v3 = new THREE.Vector3();
  private fresh = false; // 방에 막 들어섬 → 다음 sync는 "안 볼 때까지" 기다리지 않고 바로 맞춰요
  private near = 0; // 너머로 가는 벽에 가까운 정도(캠코더가 살짝 더 흔들려요)
  private v3b = new THREE.Vector3();
  private liveCol: THREE.Color | null = null; // (11/19 6단계) 켜고 끄는 등 색 계산용(매 프레임 새로 만들지 않게)
  private exposureOn = true; // (11/19 6단계 2차) 방의 노출 배율을 쓰는가(exposureOff)
  private brightWant = 0; // (11/20 7단계) Room.bright — 0이면 안 씀, 아니면 노출 배율
  private brightCur = 0;

  // (11/18 추가) 되감기 테이프 보기
  /** 테이프를 보는 중이면 그 시각의 모습(없으면 라이브). */
  private tapeV: TapeView | null = null;
  /** 테이프를 보기 직전의 라이브 모습(보이는 것들, 들고 있던 종이의 자세). 나올 때 그대로 되돌려요. */
  private tapeSaved: {
    props: boolean[]; scat: boolean[]; parts: boolean[];
    held: { p: PropState; pos: THREE.Vector3; q: THREE.Quaternion }[];
  } | null = null;
  /** 테이프에 끼어든 실사 영상. */
  readonly tapeClip = new TapeClip();
  private tapeVideo: THREE.Texture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.scene.background = new THREE.Color(0x000000);
    this.scene.add(this.camera); // 캠코더 앞에 든 종이(pick)는 카메라에 붙여 그려요
    this.screen = new Camcorder((this.resH * 4) / 3, this.resH);
  }

  get zoomMax(): number { return this.room?.zoomMax ?? 3; }

  setSize(w: number, h: number) { this.renderer.setSize(w, h, false); }

  setRes(h: number) {
    this.resH = h;
    this.screen.resize((h * 4) / 3, h);
  }

  // ── 방 짓기 ────────────────────────────────────────

  private async texture(skin: { img: string } | { gen: 'dotted-door' | 'key' | 'key-red' | 'key-dull' }): Promise<THREE.Texture> {
    const key = 'img' in skin ? skin.img : `gen:${skin.gen}`;
    let t = this.textures.get(key);
    if (!t) {
      if ('img' in skin) {
        // (11/20 변경, 폰 점검) 와이파이가 불안할 때: 두 번 더 받아 보고, 그래도 안 되면 빈 그림으로 계속(방 전체가 멈추지 않게)
        let img: THREE.Texture | null = null;
        for (let tryNo = 0; tryNo < 3 && !img; tryNo++) {
          if (tryNo) await new Promise((res) => setTimeout(res, 700 * tryNo));
          img = await this.loader.loadAsync(import.meta.env.BASE_URL + skin.img).catch((e) => {
            if (tryNo === 2) console.warn(`그림을 못 받았어요(빈 그림으로 계속): ${skin.img}`, e);
            return null;
          });
        }
        t = img ?? new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
        t.needsUpdate = true;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      } else if (skin.gen !== 'dotted-door') {
        // (11/19 6단계 추가) 열쇠
        t = keyTexture(skin.gen === 'key-red' ? '#e3261f' : skin.gen === 'key-dull' ? '#3b3b3d' : undefined);
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      } else t = dottedTexture();
      this.textures.set(key, t);
    }
    return t;
  }

  /**
   * (11/17 추가) 뒤에서 방을 짓는 빠르기. idle = 파란 시작 화면(한가함 → 틈나는 대로 빨리),
   * video = 인트로 영상 중(폰에서 영상이 끊기지 않게 한 프레임에 5ms만), play = 게임 중(한 프레임에 6ms).
   */
  setBakeMode(mode: 'idle' | 'video' | 'play') {
    Object.assign(bakePace, mode === 'idle' ? { budget: 12, eager: true } : { budget: mode === 'video' ? 5 : 6, eager: false });
  }

  private async build(room: Room): Promise<RoomBuild> {
    const built = await buildSpaceAsync(room.space);
    const group = new THREE.Group();
    group.add(built.root);
    const props: PropState[] = [];
    // (11/19 2차 추가) 묶음 소품(group): 한 덩어리로 지어 한 번에 그려요. 소품 하나하나의 상태는 그대로 두고 덩어리를 같이 써요
    const batches = new Map<string, Prop[]>();
    for (const def of room.props ?? []) if (def.group) { const l = batches.get(def.group) ?? []; l.push(def); batches.set(def.group, l); }
    for (const [name, defs] of batches) {
      const mesh = await this.buildBatch(name, defs, built, !!room.live);
      group.add(mesh);
      for (const def of defs) props.push({ def, mesh, points: propPoints(def) });
    }
    for (const def of room.props ?? []) {
      if (def.group) continue;
      const f = FACES[def.face];
      const light = built.baker.light(def.at, f.n, f.u, f.v); // 그 자리의 구운 빛으로 물들여요
      const skin = def.skin;
      let portal: THREE.ShaderMaterial | undefined;
      let mat: THREE.Material | undefined;
      let holo: HoloBuild | undefined;
      if ('holo' in skin) {
        // (11/20 추가) 홀로그램 글씨(꼭대기 congratulations! 문): 두께 있는 글씨 + 무지개 빛 + 빛 번짐, 스스로 빛나요(fixtures.ts)
        holo = buildHolo(await this.texture({ img: skin.holo }), await this.texture({ img: skin.glow }), def.plane, def.face);
      } else if ('gen' in skin && skin.gen === 'portal') {
        const wall = new THREE.Color(MATS.white.color); // 흰 벽 색 × 그 자리의 빛
        portal = mat = new THREE.ShaderMaterial({
          vertexShader: PORTAL_VERT,
          fragmentShader: PORTAL_FRAG,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uTime: { value: 0 },
            uFade: { value: 0 },
            uNear: { value: 0 },
            uSize: { value: new THREE.Vector2(...def.plane) },
            uWall: { value: new THREE.Vector3(wall.r * light[0], wall.g * light[1], wall.b * light[2]) },
          },
        });
      } else {
        // (11/19 추가) tint = 그림에 곱할 색(흰 손자국 하나를 여러 색으로), lit: false = 구운 빛에 안 물듦(햇살),
        // blend = 투명한 곳은 비침(alpha) / 빛처럼 더함(add). 벽에서 1cm라 깊이를 살짝 당겨 벽과 깜빡이지 않게
        const col = new THREE.Color(def.tint ?? '#ffffff');
        // (11/19 6단계) 켜고 끄는 등이 있는 방이면 구운 빛을 색에 굽지 않고 따로(셰이더의 uPL) — 정전 때 구운 빛만 줄이고, 다가오는 불빛을 받게
        const lum = 0.2126 * light[0] + 0.7152 * light[1] + 0.0722 * light[2];
        const baked: [number, number, number] = def.lit === 'mono' ? [lum, lum, lum] : [light[0], light[1], light[2]]; // mono = 밝기만(색은 그대로)
        const liveProp = !!room.live && def.lit !== false;
        if (def.lit !== false && !liveProp) col.multiply(new THREE.Color(...baked));
        // (11/20 추가) sign = 코드로 그린 표지판(계단실 층 표시·영어 안내판). (2차) color = 한 가지 색 판(그림 없음)
        if ('color' in skin) col.multiply(new THREE.Color(skin.color));
        if (def.power) col.multiplyScalar(def.power); // (11/20 7단계) 흰색보다 밝게 빛나는 판(문 너머 하얀 공간)
        const map = 'color' in skin ? null : 'sign' in skin ? signTexture(skin.sign, def.plane, skin.bg, skin.fg) : await this.texture(skin);
        const m = new THREE.MeshBasicMaterial({ map, transparent: 'gen' in skin || !!def.blend, color: col });
        if (liveProp) m.userData.liveLight = baked;
        if (def.blend) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
        if (def.blend === 'add') m.blending = THREE.AdditiveBlending;
        mat = m;
      }
      const mesh = holo ? holo.mesh : new THREE.Mesh(new THREE.PlaneGeometry(...def.plane), mat);
      this.placeProp(mesh, def);
      if (def.mirror) mesh.scale.x = -1;
      mesh.name = def.id;
      if (def.lit === false) mesh.userData.noSun = true;
      mesh.visible = false;
      group.add(mesh);
      props.push({ def, mesh, points: propPoints(def), portal, holo });
    }
    // 생겼다 사라지는 벽: 같은 빛으로 따로 지어 두고, 처음엔 숨겨 둬요(sync가 조건을 보고 맞춰요)
    const parts: PartState[] = [];
    for (const def of room.parts ?? []) {
      const b = await runSliced(built.partGen(def.boxes)); // (11/20 변경, 폰 점검) 한 번에 → 나눠서(앞 방에서 미리 지을 때 멈칫하지 않게)
      b.root.visible = false;
      b.root.name = def.id;
      group.add(b.root);
      const st: PartState = { def, b, on: false };
      if (def.swap === 'swing') b.root.matrixAutoUpdate = false; // (11/19 추가) 문: 경첩을 축으로 돌려요(swingMat)
      if (def.swap === 'dissolve') {
        // 지지직 사라짐용: 이 벽 재질에만 셰이더 조각을 끼워 넣어요(그림 프로그램은 아래에서 미리 만들어 둬요)
        const u = { uDissolve: { value: 0 }, uTime: { value: 0 } };
        b.root.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
          if (!m) return;
          m.onBeforeCompile = (sh) => {
            Object.assign(sh.uniforms, u);
            sh.fragmentShader = 'uniform float uDissolve, uTime;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', DISSOLVE_GLSL + '\n#include <dithering_fragment>');
          };
          m.customProgramCacheKey = () => 'part-dissolve';
        });
        st.u = u;
      }
      parts.push(st);
    }
    // (11/17 추가) 흩뿌린 종이(포스트잇 수천 장): 조각마다 하나씩, 나눠서 지어요
    const scat: ScatterChunk[] = [];
    for (const def of room.scatter ?? []) {
      for (const c of await runSliced(buildScatter(def, built, room.space.lamps))) { group.add(c.mesh); scat.push(c); }
    }
    this.stats.scatter = scat.reduce((n, c) => n + c.mesh.count, 0);
    // (11/20 추가) 난간(계단실): 한 덩어리로, 나눠서 지어요(빛을 재는 동안 쉬어 가며)
    const rails = await runSliced(railsGen(room.rails ?? [], built.baker));
    if (rails) group.add(rails);
    const sun = room.sun ? this.buildSun(room.sun, group, built) : undefined;
    // (11/19 6단계 추가) 켜고 끄는 등. (2차) 끝없는 복도는 등 셰이더를 끼우기 전에 지어 두고, 3D 열쇠는 등 셰이더 값을 같이 써요
    const far = room.live?.far ? this.buildFar(room.live.far, group) : undefined;
    const live = room.live ? this.buildLive(room.live, group) : undefined;
    if (far && live) this.farSetup(far, live);
    const keys = (room.keys ?? []).map((k) => this.buildKeys(k, group, built, live));
    // (11/19 6단계 2차 추가) 둥근 은색 문손잡이: 열쇠와 같은 금속 셰이더, 문(parts)과 같이 움직여요
    // (11/20 변경, 사용자 의견: 그냥 공 모양 같음) 둥근 받침 + 목 + 둥근 손잡이 + 앞면 열쇠 구멍(돌려 깎은 모양)
    for (const p of parts) for (const k of p.def.knob ?? []) {
      const f = FACES[k.face];
      const light = built.baker.light(onFace(k.at, f, 0, 0, 0.05), f.n, f.u, f.v);
      const m = new THREE.ShaderMaterial({
        vertexShader: KEY_VERT, fragmentShader: KEY_FRAG,
        uniforms: { ...(live ? live.u : liveOff()), uKB: { value: new THREE.Vector3(...light) }, uAlb: { value: new THREE.Vector3(0.62, 0.63, 0.66) }, uMetal: { value: 1 } },
      });
      const knob = new THREE.Group();
      const body = new THREE.Mesh(knobGeometry(), m);
      // 열쇠 구멍: 세로로 긴 어두운 홈(손잡이 앞면)
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0095, 0.0008, 0.0018), new THREE.MeshBasicMaterial({ color: 0x060606 }));
      slot.position.set(0.0006, 0.0737, 0);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.0009, 10), slot.material);
      hole.position.set(-0.0038, 0.0737, 0);
      knob.add(body, slot, hole);
      // 손잡이 축(로컬 y) = 튀어나오는 쪽, 로컬 x = 위(열쇠 구멍이 세로로)
      const yv = new THREE.Vector3(...f.n), xv = new THREE.Vector3(0, 1, 0).addScaledVector(yv, -yv.y).normalize(), zv = new THREE.Vector3().crossVectors(xv, yv);
      knob.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xv, yv, zv));
      knob.position.set(...k.at);
      knob.traverse((o) => { o.userData.noSun = true; });
      p.b.root.add(knob);
    }
    // (11/17 추가) 그래픽 카드 쪽 준비(그림 프로그램 만들기·무늬 올리기)를 미리 해서, 이 방을 처음 그리는 순간 멈칫하지 않게
    try {
      for (const c of scat) c.mesh.visible = true; // 그림 프로그램을 미리 만들려면 보이는 상태여야 해요
      for (const p of props) if (p.holo) p.mesh.visible = true; // (11/20) 홀로그램 글씨도
      // (11/20 추가, 폰 점검) 실제로 그리는 곳(3D 화면 버퍼)을 대상으로 정해 두고 만들어요. 그림 프로그램은 "어디에 그리는지"
      // (화면 / 버퍼 — 색 공간·톤 매핑)에 따라 다른 것이 쓰여서, 대상 없이 만들면 처음 그릴 때 14개쯤을 다시 만들어
      // 따뜻한 방에 들어서는 첫 장면이 PC에서도 약 0.1초 멈췄어요(폰은 몇 배). 프로그램 종류는 아래 줄에서 바로 정해져요(기다리는 건 완성뿐)
      const was = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.screen.scene);
      const ready = this.renderer.compileAsync(group, this.camera, this.scene);
      this.renderer.setRenderTarget(was);
      await ready;
      for (const c of scat) c.mesh.visible = false;
      for (const p of props) if (p.holo) p.mesh.visible = false;
      group.traverse((o) => {
        const map = ((o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined)?.map;
        if (map) this.renderer.initTexture(map);
      });
    } catch (e) { console.warn('그래픽 준비를 미리 못 했어요(처음 그릴 때 해요)', e); }
    return { built, group, props, parts, scat, sun, live, far, keys };
  }

  /**
   * (11/19 6단계 2차 추가, 사용자 의견) 보기에만 있는 끝없는 복도: 바닥·천장·양 벽을 굽지 않고 길게(구운 빛은 아주 어둡게 — 등이 켜진 곳만 보여요),
   * 천장에 등 판 n개(꺼지면 어두운 회색, 켜지면 빛남 — 꼭짓점 색으로 바꿔요).
   */
  private buildFar(def: FarHall, group: THREE.Group): FarBuild {
    const d: V3 = ({ 'x-': [-1, 0, 0], 'x+': [1, 0, 0], 'z-': [0, 0, -1], 'z+': [0, 0, 1] } as const)[def.dir] as V3;
    const s: V3 = [-d[2], 0, d[0]];
    const A = def.from, L = def.length, W = def.width / 2, Hh = def.height;
    const pt = (t: number, w: number, y: number): [number, number, number] => [A[0] + d[0] * t + s[0] * w, y, A[2] + d[2] * t + s[2] * w];
    const g = new THREE.Group();
    g.name = 'far-hall';
    const BASE = 0.03; // 등이 안 닿는 곳은 거의 검정
    const quad = (mat: Box['mat'], c: [number, number, number][], uv: [number, number][]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(c.flat(), 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(Array(12).fill(BASE), 3));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: matTexture(mat), vertexColors: true, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      g.add(m);
    };
    const tf = MATS[def.mats.floor].tile, tw = MATS[def.mats.wall].tile, tc = MATS[def.mats.ceil].tile;
    quad(def.mats.floor, [pt(0, -W, 0), pt(L, -W, 0), pt(L, W, 0), pt(0, W, 0)], [[0, 0], [L / tf, 0], [L / tf, (2 * W) / tf], [0, (2 * W) / tf]]);
    quad(def.mats.ceil, [pt(0, -W, Hh), pt(0, W, Hh), pt(L, W, Hh), pt(L, -W, Hh)], [[0, 0], [0, (2 * W) / tc], [L / tc, (2 * W) / tc], [L / tc, 0]]);
    for (const w of [-W, W]) quad(def.mats.wall, [pt(0, w, 0), pt(L, w, 0), pt(L, w, Hh), pt(0, w, Hh)], [[0, 0], [L / tw, 0], [L / tw, Hh / tw], [0, Hh / tw]]);
    // 등 판(아래를 봄)
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const [la, lw] = def.lamps.size;
    for (let k = 0; k < def.lamps.n; k++) {
      const t = def.lamps.spacing * (k + 0.5), b = pos.length / 3;
      for (const [ta, tw2] of [[-la / 2, -lw / 2], [la / 2, -lw / 2], [la / 2, lw / 2], [-la / 2, lw / 2]]) { pos.push(...pt(t + ta, tw2, Hh - 0.012)); col.push(0.07, 0.07, 0.075); }
      idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    fg.setIndex(idx);
    const fixtures = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    fixtures.userData.noSun = true;
    fixtures.frustumCulled = false;
    g.add(fixtures);
    g.visible = false;
    group.add(g);
    return { def, group: g, fixtures, lit: -1 };
  }

  /** (11/19 6단계 2차 추가) 끝없는 복도의 등 값을 셰이더에(자리·간격·색·빛이 닿는 공간). */
  private farSetup(F: FarBuild, L: LiveBuild) {
    const def = F.def;
    const d: V3 = ({ 'x-': [-1, 0, 0], 'x+': [1, 0, 0], 'z-': [0, 0, -1], 'z+': [0, 0, 1] } as const)[def.dir] as V3;
    const A = def.from;
    (L.u.uFO.value as THREE.Vector3).set(A[0], def.height - 0.02, A[2]);
    (L.u.uFD.value as THREE.Vector3).set(...d);
    const c = new THREE.Color(def.lamps.color).multiplyScalar(def.lamps.power);
    (L.u.uFC.value as THREE.Vector3).set(c.r, c.g, c.b);
    const e: V3 = [A[0] + d[0] * def.length, def.height, A[2] + d[2] * def.length];
    const w = def.width / 2 + 0.05;
    (L.u.uFMin.value as THREE.Vector3).set(Math.min(A[0], e[0]) - (d[0] ? 0 : w), -0.05, Math.min(A[2], e[2]) - (d[2] ? 0 : w));
    (L.u.uFMax.value as THREE.Vector3).set(Math.max(A[0], e[0]) + (d[0] ? 0 : w), def.height + 0.05, Math.max(A[2], e[2]) + (d[2] ? 0 : w));
    (L.u.uFP.value as THREE.Vector4).set(def.lamps.spacing, def.lamps.n, 0, 0);
  }

  /** (11/19 6단계 2차 추가) 끝없는 복도: 보임과 켜진 등 수(먼 쪽부터)를 셰이더·등 판에. */
  private applyFar(F: FarBuild, L: LiveBuild | undefined, visible: boolean, lit: number) {
    F.group.visible = visible;
    if (L) (L.u.uFP.value as THREE.Vector4).set(F.def.lamps.spacing, F.def.lamps.n, visible ? lit : 0, visible ? 1 : 0);
    if (lit === F.lit) return;
    F.lit = lit;
    const n = F.def.lamps.n, c = new THREE.Color(F.def.lamps.color);
    const col = F.fixtures.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      const on = k >= n - lit;
      for (let v = 0; v < 4; v++) col.setXYZ(k * 4 + v, on ? c.r * 5 : 0.07, on ? c.g * 5 : 0.07, on ? c.b * 5 : 0.075);
    }
    col.needsUpdate = true;
  }

  /** 끝없는 복도의 지금 상태(조건 검사로): 보이는가, 먼 쪽부터 켜진 등 수 */
  private farState(F: FarBuild, test: (c: Cond) => boolean): [boolean, number] {
    const l = F.def.lamps;
    let lit = 0;
    for (let j = 0; j < l.n; j++) if (test({ count: l.count, gte: l.first + j })) lit = j + 1; else break;
    return [test(F.def.when), lit];
  }

  /** (11/19 6단계 2차 추가) 3D 열쇠 꾸러미 짓기. 켜고 끄는 등이 없는 방이면 구운 빛만 받아요. */
  private buildKeys(def: KeyBunch, group: THREE.Group, built: Built, L: LiveBuild | undefined): KeyBuild {
    const lay = keyLayout(def);
    const m4 = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
    const toPose = (d: { p: V3; x: V3; z: V3 }): KeyPose => {
      vx.set(...d.x).normalize(); vz.set(...d.z).normalize(); vy.crossVectors(vz, vx).normalize(); vz.crossVectors(vx, vy);
      return { p: new THREE.Vector3(...d.p), q: new THREE.Quaternion().setFromRotationMatrix(m4.makeBasis(vx, vy, vz)) };
    };
    const poses = Object.fromEntries(Object.entries(lay).map(([k, v]) => [k, v.map(toPose)])) as KeyBuild['poses'];
    const kb = built.baker.light([def.floor[0], 0.01, def.floor[2]], [0, 1, 0], [1, 0, 0], [0, 0, -1]);
    const shared = L ? L.u : { ...liveOff() };
    const mat = (alb: [number, number, number], metal: number) => new THREE.ShaderMaterial({
      vertexShader: KEY_VERT, fragmentShader: KEY_FRAG,
      uniforms: { ...shared, uKB: { value: new THREE.Vector3(...kb) }, uAlb: { value: new THREE.Vector3(...alb) }, uMetal: { value: metal } },
    });
    const metal = mat([0.34, 0.35, 0.38], 1);
    const geo = keyGeometry();
    const inst = new THREE.InstancedMesh(geo, metal, def.keys);
    inst.frustumCulled = false;
    const red = new THREE.Mesh(geo, metal);
    const dot = mat([0.18, 0.18, 0.18], 0);
    const dm = new THREE.Mesh(new THREE.CircleGeometry(0.0064 * KEY_SCALE, 20), dot);
    dm.position.set(0.0012 * KEY_SCALE, 0, 0.00125 * KEY_SCALE + 0.0002);
    red.add(dm);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.018 * KEY_SCALE, 0.0013, 6, 28), metal);
    for (const o of [inst, red, ring]) { o.userData.noSun = true; group.add(o); }
    dm.userData.noSun = true;
    const b: KeyBuild = { def, inst, red, ring, dot, poses, state: 'hang', cur: poses.hang.map((p) => ({ p: p.p.clone(), q: p.q.clone() })), anim: null, redOn: 0, redWant: 0 };
    this.keyApply(b, b.cur);
    return b;
  }

  /** 열쇠 자세를 3D에 */
  private keyApply(b: KeyBuild, ps: KeyPose[]) {
    const N = b.def.keys, m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < N; i++) b.inst.setMatrixAt(i, m.compose(ps[i].p, ps[i].q, one));
    b.inst.instanceMatrix.needsUpdate = true;
    b.red.position.copy(ps[N].p); b.red.quaternion.copy(ps[N].q);
    b.ring.position.copy(ps[N + 1].p); b.ring.quaternion.copy(ps[N + 1].q);
  }

  /** 꾸러미의 지금 상태(조건 검사로) */
  private keyState(def: KeyBunch, test: (c: Cond) => boolean): KeyBuild['state'] {
    if (def.use && test(def.use)) return 'use';
    if (!test(def.fall)) return 'hang';
    return test({ count: def.spread, gte: 2 }) ? 'f2' : test({ count: def.spread, gte: 1 }) ? 'f1' : 'f0';
  }

  /** (11/19 6단계 2차 추가) 열쇠: 상태가 바뀌면 움직이기 시작(방에 막 들어섰을 땐 바로), 빨간 점 색 */
  private keySync(b: KeyBuild, test: (c: Cond) => boolean, force: boolean) {
    const want = this.keyState(b.def, test);
    b.redWant = test(b.def.redOn) ? 1 : 0;
    if (force) b.redOn = b.redWant;
    if (want === b.state && !force) return;
    const to = b.poses[want as keyof KeyBuild['poses']];
    if (force) {
      b.anim = null;
      b.cur = to.map((p) => ({ p: p.p.clone(), q: p.q.clone() }));
      this.keyApply(b, b.cur);
    } else {
      const drop = b.state === 'hang';
      b.anim = { t: 0, len: want === 'use' ? 0.6 : drop ? 0.45 : 0.28, from: b.cur.map((p) => ({ p: p.p.clone(), q: p.q.clone() })), to, drop };
    }
    b.state = want;
  }

  private keyTick(b: KeyBuild, dt: number) {
    b.redOn += Math.sign(b.redWant - b.redOn) * Math.min(Math.abs(b.redWant - b.redOn), dt / 0.3);
    const k = b.redOn;
    (b.dot.uniforms.uAlb.value as THREE.Vector3).set(0.18 + (0.86 - 0.18) * k, 0.18 + (0.05 - 0.18) * k, 0.18 + (0.04 - 0.18) * k);
    const a = b.anim;
    if (!a) return;
    a.t += dt;
    const t = clamp01(a.t / a.len), e = ease(t);
    b.cur.forEach((p, i) => {
      p.p.lerpVectors(a.from[i].p, a.to[i].p, e);
      if (a.drop) p.p.y = a.from[i].p.y + (a.to[i].p.y - a.from[i].p.y) * t * t; // 떨어질 땐 점점 빨리
      p.q.slerpQuaternions(a.from[i].q, a.to[i].q, e);
    });
    this.keyApply(b, b.cur);
    if (t >= 1) b.anim = null;
  }

  /**
   * (11/19 6단계 추가) 켜고 끄는 등 짓기: 방의 모든 면(MeshBasicMaterial)에 셰이더 조각을 끼우고, 등 판(꺼지면 어두운 회색, 켜지면 빛남)을 달아요.
   * 소품(구운 빛을 따로 가진 것 — userData.liveLight)은 "칠할 색 × (구운 빛 × uBase + 등 빛)", 벽·바닥은 "구운 색 × uBase + 무늬 색 × 등 빛".
   */
  private buildLive(def: LiveLight, group: THREE.Group): LiveBuild {
    const n = Math.min(LIVE_N, def.lamps.length);
    if (def.lamps.length > LIVE_N) console.warn(`켜고 끄는 등은 방마다 ${LIVE_N}개까지예요`);
    const u: Record<string, THREE.IUniform> = {
      uLP: { value: Array.from({ length: LIVE_N }, (_, i) => new THREE.Vector3(...(def.lamps[i]?.at ?? [0, -99, 0]))) },
      uLC: { value: Array.from({ length: LIVE_N }, () => new THREE.Vector3()) },
      uLS: { value: Array.from({ length: LIVE_N }, (_, i) => (def.lamps[i]?.shadow ? 1 : 0)) },
      uMe: { value: new THREE.Vector3() },
      uBase: { value: 1 },
      uLMin: { value: new THREE.Vector3(...def.box[0]) },
      uLMax: { value: new THREE.Vector3(...def.box[1]) },
      ...farUniforms(),
    };
    const done = new Set<THREE.Material>(); // (11/20 추가) 여러 물체가 같이 쓰는 재질(포스트잇 조각들)엔 한 번만 끼워요 — 겹쳐 끼우면 그림 프로그램이 깨져요
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (!m || !(m instanceof THREE.MeshBasicMaterial) || m.blending === THREE.AdditiveBlending || o.userData.noSun || done.has(m)) return;
      done.add(m);
      const pl = m.userData.liveLight as [number, number, number] | undefined; // 소품: 구운 빛을 따로 가짐
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        Object.assign(sh.uniforms, u, pl ? { uPL: { value: new THREE.Vector3(...pl) } } : {});
        sh.vertexShader = LIVE_GLSL_V + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vLiveP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vLiveP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
        sh.fragmentShader = (pl ? '#define LIVE_PROP\nuniform vec3 uPL;\n' : '') + LIVE_GLSL_V + LIVE_GLSL_F + sh.fragmentShader
          .replace('#include <map_fragment>', '#include <map_fragment>\n  vec3 liveAlb = diffuseColor.rgb;')
          .replace('#include <alphamap_fragment>', `#ifdef LIVE_PROP
  diffuseColor.rgb *= uPL * uBase + liveLight(vLiveP);
#else
  diffuseColor.rgb = diffuseColor.rgb * uBase + liveAlb * liveLight(vLiveP);
#endif
#include <alphamap_fragment>`);
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => key() + (pl ? '+liveP' : '+live');
    });
    // 등 판: 아래를 보는 네모. 빛은 셰이더가 더하고, 판은 켜진 정도만큼 빛나요
    const fixtures = def.lamps.slice(0, n).map((l) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.size[0], l.size[1]), new THREE.MeshBasicMaterial({ color: 0x121214 }));
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(l.at[0], l.at[1] - 0.012, l.at[2]);
      mesh.userData.noSun = true;
      mesh.visible = !l.hidden; // (11/20 7단계) 보이는 등 판이 없는 빛(문틈에서 쏟아지는 빛)
      mesh.name = `live-${l.id}`;
      group.add(mesh);
      return mesh;
    });
    return { def, u, level: Array(n).fill(0), want: Array(n).fill(false), flick: Array(n).fill(-1), fixtures, base: 1, baseWant: 1, tape: null };
  }

  /** (11/19 6단계 추가) 켜고 끄는 등을 지금 밝기대로 셰이더·등 판에. 테이프를 볼 때는 그 시각의 상태(깜빡임 없이). */
  private applyLive() {
    const L = this.cur?.live;
    if (!L) return;
    const v = this.tapeV;
    const lc = L.u.uLC.value as THREE.Vector3[];
    L.def.lamps.slice(0, LIVE_N).forEach((lamp, i) => {
      const k = L.tape ? (L.tape.on[i] ? 1 : 0) : L.level[i];
      const c = (this.liveCol ??= new THREE.Color()).set(lamp.color);
      lc[i].set(c.r, c.g, c.b).multiplyScalar(lamp.power * k);
      if (!lamp.hidden) (L.fixtures[i].material as THREE.MeshBasicMaterial).color.setRGB(0.07 + c.r * 5 * k, 0.07 + c.g * 5 * k, 0.075 + c.b * 5 * k);
    });
    L.u.uBase.value = L.tape ? (L.tape.dim ? (L.def.dim?.level ?? 1) : 1) : L.base;
    const me = L.u.uMe.value as THREE.Vector3;
    if (v) me.set(v.pose.x, v.pose.y, v.pose.z); // (11/20) 몸(그림자)도 발 높이에서
    else me.set(this.walker.x, this.walker.y, this.walker.z);
  }

  /** (11/19 6단계 추가) 켜고 끄는 등의 깜빡임·정전 진행(매 프레임). */
  private tickLive(dt: number) {
    const L = this.cur?.live;
    if (!L) return;
    for (let i = 0; i < L.level.length; i++) {
      const fade = L.def.lamps[i]?.fade;
      if (fade && L.flick[i] < 0) { const to = L.want[i] ? 1 : 0; L.level[i] += Math.sign(to - L.level[i]) * Math.min(Math.abs(to - L.level[i]), dt / fade); continue; }
      if (L.flick[i] < 0) { L.level[i] = L.want[i] ? 1 : 0; continue; }
      L.flick[i] += dt;
      const t = L.flick[i];
      let k = 1;
      for (const [at, lv] of LIVE_FLICK) if (t >= at) k = lv;
      L.level[i] = k;
      if (t >= LIVE_FLICK[LIVE_FLICK.length - 1][0]) L.flick[i] = -1;
    }
    // 정전(구운 빛 줄이기)은 탁 — 0.12초
    L.base += Math.sign(L.baseWant - L.base) * Math.min(Math.abs(L.baseWant - L.base), dt / 0.12);
  }

  /**
   * (11/19 6단계 추가) 카메라가 그 자리로 저절로 걸어가며 돌아서요(논리의 walk 행동). 몸도 같이 옮겨서 끝나면 그 자리에 서 있어요.
   * 좌우 각도는 가까운 쪽으로 돌아요.
   */
  async walk(s: Spawn, ms: number) {
    const w = this.walker;
    const x0 = w.x, z0 = w.z, y0 = w.yaw, p0 = w.pitch;
    const y1 = (s.yaw * Math.PI) / 180, p1 = ((s.pitch ?? 0) * Math.PI) / 180;
    let dy = (y1 - y0) % (Math.PI * 2);
    if (dy > Math.PI) dy -= Math.PI * 2;
    if (dy < -Math.PI) dy += Math.PI * 2;
    await this.anim(ms, (k) => {
      const e = ease(k);
      w.glide(x0 + (s.at[0] - x0) * e, z0 + (s.at[2] - z0) * e, y0 + dy * e, p0 + (p1 - p0) * e);
    });
  }

  /**
   * (11/20 7단계 추가) 바닥 없는 곳으로 떨어져요(논리의 fall 행동): 중력처럼 점점 빨리 depth미터 아래로(ms 동안),
   * 시선은 살짝 아래로 숙여졌다 돌아오고 캠코더가 크게 흔들려요 — 문 너머 하얀 공간(엔딩)
   */
  async fall(ms: number, depth: number) {
    const w = this.walker;
    const y0 = w.y, p0 = w.pitch, yaw0 = w.yaw;
    this.burst = Math.max(this.burst, 0.5);
    await this.anim(ms, (k) => {
      w.drop(y0 - depth * k * k);
      const tip = Math.sin(Math.min(1, k * 1.6) * Math.PI) * 0.28; // 앞으로 고꾸라지듯 숙였다가
      w.glide(w.x, w.z, yaw0 + Math.sin(k * 9) * 0.03 * (1 - k), p0 - tip);
      this.burst = Math.max(this.burst, 0.25 * (1 - k));
    });
  }

  /**
   * (11/19 2차 추가) 햇살 짓기: 방의 모든 면에 셰이더 조각을 끼우고, 창에서 햇빛 방향으로 빛줄기(네 옆면)·먼지·창 밖 빛을 만들어요.
   * 빛줄기 끝은 창 네 귀퉁이에서 햇빛 방향으로 쏜 선이 처음 닿는 면.
   */
  private buildSun(def: Sun, group: THREE.Group, built: Built): SunBuild {
    const f = FACES[def.window.face];
    const C = new THREE.Vector3(...def.window.at);
    const U = new THREE.Vector3(...f.u).multiplyScalar(def.window.size[0] / 2);
    const V = new THREE.Vector3(...f.v).multiplyScalar(def.window.size[1] / 2);
    const dir = new THREE.Vector3(...def.dir).normalize();
    const col = new THREE.Color(def.color).multiplyScalar(def.power);
    const u: Record<string, THREE.IUniform> = {
      uSun: { value: 1 }, uSunBar: { value: def.bar ?? 0.03 }, uSunDir: { value: dir }, uSunCol: { value: new THREE.Vector3(col.r, col.g, col.b) },
      uWinC: { value: C }, uWinU: { value: U }, uWinV: { value: V },
      uSunMin: { value: new THREE.Vector3(...def.room[0]) }, uSunMax: { value: new THREE.Vector3(...def.room[1]) },
      uBeam: { value: def.beam ?? 0.1 }, uTime: { value: 0 }, uRes: { value: 480 },
    };
    const done = new Set<THREE.Material>(); // (11/20 추가) 같이 쓰는 재질엔 한 번만(buildLive와 같은 이유)
    group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (!m || !(m instanceof THREE.MeshBasicMaterial) || m.blending === THREE.AdditiveBlending || o.userData.noSun || done.has(m)) return;
      done.add(m);
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        Object.assign(sh.uniforms, u);
        sh.vertexShader = SUN_GLSL_V + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vSunP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = SUN_GLSL_F + sh.fragmentShader.replace('#include <color_fragment>', 'vec3 sunAlb = diffuseColor.rgb;\n#include <color_fragment>\n  diffuseColor.rgb += sunAlb * sunLight(vSunP);');
      };
      const key = m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey = () => key() + '+sun';
    });
    // 빛줄기: 창 네 귀퉁이 → 처음 닿는 면. 옆면 넷을 빛처럼 더해 그려요(창 쪽이 진하고 멀어질수록 옅게)
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => C.clone().addScaledVector(U, a * 0.96).addScaledVector(V, b * 0.96));
    const ends = corners.map((w) => {
      const o: V3 = [w.x + dir.x * 0.05, w.y + dir.y * 0.05, w.z + dir.z * 0.05];
      const t = Math.min(12, built.baker.nearest(o, [dir.x, dir.y, dir.z], 12)) + 0.05;
      return w.clone().addScaledVector(dir, t);
    });
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4, b = pos.length / 3;
      for (const [p, uu, vv] of [[corners[i], 0, 0], [corners[j], 1, 0], [ends[j], 1, 1], [ends[i], 0, 1]] as const) { pos.push(p.x, p.y, p.z); uv.push(uu, vv); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    bg.setIndex(idx);
    const beam = new THREE.Mesh(bg, new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: u, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    beam.frustumCulled = false;
    // 떠다니는 먼지: 빛줄기 안에 흩뿌려요
    const reach = Math.min(...ends.map((e, i) => e.distanceTo(corners[i])));
    const mp: number[] = [], seed: number[] = [];
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 260; i++) {
      const p = C.clone().addScaledVector(U, rnd() * 2 - 1).addScaledVector(V, rnd() * 2 - 1).addScaledVector(dir, 0.15 + rnd() * reach * 0.85);
      mp.push(p.x, p.y, p.z);
      seed.push(rnd());
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    motes.frustumCulled = false;
    // 창 밖: 하얗게 날아간 햇빛(창보다 넉넉하게 — 비스듬히 봐도 창을 다 채우게). 꺼지면 아무것도 없어 암흑
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(def.window.size[0] + 2.4, def.window.size[1] + 1.6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(def.color).lerp(new THREE.Color('#ffffff'), 0.45).multiplyScalar(6) }));
    const n = new THREE.Vector3(...f.n);
    glow.position.copy(C).addScaledVector(n, -0.6);
    glow.lookAt(C.clone().addScaledVector(n, 1));
    for (const o of [beam, motes, glow]) group.add(o);
    return { def, u, extras: [beam, motes, glow] };
  }

  /**
   * (11/19 2차 추가) 묶음 소품을 한 덩어리로: 소품마다 네모 하나(자리·면·기울기·좌우 뒤집기 그대로), 색 = tint × 그 자리의 빛(꼭짓점 색).
   * 그림·붙이는 방식은 첫 소품 것을 써요.
   */
  private async buildBatch(name: string, defs: Prop[], built: Built, live = false): Promise<THREE.Mesh> {
    const first = defs[0];
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    const dummy = new THREE.Object3D();
    const v = new THREE.Vector3();
    // (11/19 6단계) 켜고 끄는 등이 있는 방: 꼭짓점 색엔 칠할 색만, 구운 빛은 첫 소품 자리의 빛 하나로(셰이더의 uPL — 열쇠 무더기처럼 한곳에 모인 것)
    const liveProp = live && first.lit !== false;
    if (liveProp) {
      const f = FACES[first.face];
      const l = built.baker.light(first.at, f.n, f.u, f.v), lum = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
      first.lit === 'mono' ? (dummy.userData.liveLight = [lum, lum, lum]) : (dummy.userData.liveLight = [l[0], l[1], l[2]]);
    }
    for (const def of defs) {
      const f = FACES[def.face];
      const light = liveProp ? [1, 1, 1] as V3 : built.baker.light(def.at, f.n, f.u, f.v);
      const c = new THREE.Color(def.tint ?? '#ffffff');
      if (def.lit === 'mono') c.multiplyScalar(0.2126 * light[0] + 0.7152 * light[1] + 0.0722 * light[2]);
      else if (def.lit !== false) c.multiply(new THREE.Color(...light));
      this.placeProp(dummy, def);
      dummy.updateMatrix(); // 좌우 뒤집기는 무늬 좌표(uv)로
      const b = pos.length / 3, [w, h] = def.plane;
      for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
        v.set(x * w, y * h, 0).applyMatrix4(dummy.matrix);
        pos.push(v.x, v.y, v.z);
        uv.push(def.mirror ? 0.5 - x : x + 0.5, y + 0.5);
        col.push(c.r, c.g, c.b);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const skin = first.skin as { img: string } | { gen: 'dotted-door' | 'key' | 'key-red' | 'key-dull' };
    const m = new THREE.MeshBasicMaterial({ map: await this.texture(skin), vertexColors: true, transparent: !!first.blend, side: THREE.DoubleSide });
    if (liveProp) m.userData.liveLight = dummy.userData.liveLight;
    if (first.blend) { m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -2; }
    if (first.blend === 'add') m.blending = THREE.AdditiveBlending;
    if (first.edge) {
      // (11/19 4차 추가) 얇은 어두운 테두리: 둘레 8곳 중 한 곳이라도 그림 밖(투명)이면 가장자리로 보고 어둡게
      const k = first.edge.toFixed(3);
      m.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    float o = 0.022, lo = 1.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      lo = min(lo, texture2D(map, vMapUv + vec2(cos(a), sin(a)) * o).a);
    }
    diffuseColor.rgb *= 1.0 - ${k} * (1.0 - smoothstep(0.25, 0.75, lo));
  }`);
      };
      m.customProgramCacheKey = () => `edge${k}`;
    }
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = name;
    if (first.lit === false) mesh.userData.noSun = true; // (11/19 4차) 햇살도 안 받아요(햇살 속 검정 손자국이 노래 보이던 것)
    mesh.visible = false;
    return mesh;
  }

  /** (11/19 2차 추가) 햇살 켜짐 정도를 셰이더·빛줄기·창 밖 빛에. */
  private applySun(level: number) {
    const s = this.cur?.sun;
    if (!s) return;
    s.u.uSun.value = level;
    s.u.uTime.value = this.time;
    s.u.uRes.value = this.resH;
    for (const o of s.extras) o.visible = level > 0;
  }

  /** 실패해서 방을 다시 시작할 때: 캠코더 앞에 든 종이를 벽 제자리로 돌려놔요. */
  private unhold(b: RoomBuild) {
    for (const p of b.props) {
      if (!p.held) continue;
      p.held = false;
      b.group.add(p.mesh); // 카메라에서 떼어 방으로
      this.placeProp(p.mesh, p.def);
      const back = p.mesh.getObjectByName('back');
      if (back) p.mesh.remove(back);
      p.mesh.visible = false; // 다음 sync가 조건대로 다시 맞춰요
    }
  }

  /**
   * (11/17 추가) 벽의 종이가 떨어져 캠코더 앞(손에 든 자리)으로 와요 — 손은 보여 주지 않아요(CLAUDE.md).
   * 끝이 들리듯 벽에서 살짝 떨어졌다가(0.26초) 캠코더 앞 30cm로 다가와요(0.65초). 그 뒤로는 카메라에 붙어 같이 움직여요.
   */
  async pick(id: string) {
    const p = this.cur?.props.find((x) => x.def.id === id);
    if (!p) return;
    p.held = true;
    p.mesh.visible = true;
    this.camera.updateMatrixWorld();
    this.camera.attach(p.mesh); // 세상에서의 자리는 그대로 두고 카메라에 붙여요
    const from = p.mesh.position.clone(), q0 = p.mesh.quaternion.clone();
    const lift = new THREE.Vector3(...FACES[p.def.face].n).transformDirection(this.camera.matrixWorldInverse).multiplyScalar(0.035);
    await this.anim(PICK_LIFT * 1000, (k) => { p.mesh.position.copy(from).addScaledVector(lift, ease(k)); });
    const from2 = p.mesh.position.clone();
    await this.anim(PICK_MOVE * 1000, (k) => {
      const e = ease(k);
      p.mesh.position.lerpVectors(from2, HOLD_AT, e);
      p.mesh.quaternion.slerpQuaternions(q0, HOLD_Q, e);
    });
  }

  /** (11/17 추가) 캠코더 앞의 종이를 뒤집어 뒷면을 보여요(뒷면 그림은 그때 만들어요). */
  async flip(id: string) {
    const p = this.cur?.props.find((x) => x.def.id === id && x.held);
    if (!p) return;
    let back = p.mesh.getObjectByName('back') as THREE.Mesh | undefined;
    if (!back) {
      const front = p.mesh.material as THREE.MeshBasicMaterial;
      back = new THREE.Mesh(p.mesh.geometry, new THREE.MeshBasicMaterial({ map: noteBack(front.map), color: front.color }));
      back.name = 'back';
      back.rotation.y = Math.PI; // 처음엔 뒤를 보고 있다가, 종이가 뒤집히면 캠코더 쪽을 봐요
      p.mesh.add(back);
    }
    const q0 = p.mesh.quaternion.clone(), pos0 = p.mesh.position.clone();
    const turn = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    await this.anim(FLIP_LEN * 1000, (k) => {
      const e = ease(k);
      p.mesh.quaternion.copy(q0).multiply(turn.setFromAxisAngle(up, Math.PI * e));
      p.mesh.position.copy(pos0);
      p.mesh.position.z -= Math.sin(Math.PI * e) * 0.035; // 뒤집는 동안 살짝 멀어졌다 돌아와요
    });
  }

  /**
   * (11/17 추가) 방의 불. flicker = 형광등이 불규칙하게 깜빡이다 켜진 채로 끝남(약 1.5초, 끝날 때까지 기다려요),
   * off = 암흑(캠코더가 자글자글한 검정 — 이때는 보는 중이어도 바뀌어요), on = 0.45초 동안 빠르게 밝아짐(살짝 하얗게 날아갔다 돌아옴).
   */
  async light(fx: 'flicker' | 'off' | 'on') {
    if (fx === 'off') { this.lightsOff = 1; return; }
    if (fx === 'on') {
      // (11/17 4차 변경) ~~탁 켜짐~~ → 0.45초 동안 빠르게 밝아져요(뚝 끊기듯 켜지는 느낌만 덜게). 노출 번쩍임도 약하게
      this.screen.flash(0.45);
      this.burst = Math.max(this.burst, 0.2);
      await this.anim(450, (k) => { const s = k * k * (3 - 2 * k); this.lightsOff = 1 - s; });
      this.lightsOff = 0;
      return;
    }
    for (let i = 0; i < FLICKER.length; i++) {
      this.lightsOff = i % 2 === 0 ? 0.92 : 0.12 * Math.random();
      await this.anim(FLICKER[i], () => {});
    }
    this.lightsOff = 0;
  }

  /**
   * (11/17 4차 추가) 착시 화살표가 맞춰지는 자리(eye)에 얼마나 가까운가: 바닥에서 잰 거리 20cm 안 = 1, 1.4m 밖 = 0.
   * 들어온 자리는 1.4m 떨어져 있어 0이에요(화살표가 전혀 안 모임).
   */
  private nearTo(eye: V3): number {
    const d = Math.hypot(this.walker.x - eye[0], this.walker.z - eye[2]);
    return 1 - Math.max(0, Math.min(1, (d - 0.2) / 1.2));
  }

  /** (11/17 4차 추가) 한 번 완성된 착시 화살표(그 자리에 서서 다 모임)는 그 뒤로 어디서 봐도 그대로 남아요(사용자 의견). */
  private formed = new Set<string>();
  /** (11/17 5차 추가) 화살표마다 지금 보이는 세기(0~1). sync가 시간에 따라 부드럽게 바꿔요. */
  private figLevel = new Map<string, number>();
  private syncT = 0;

  private figureNear(f: { id: string; eye: V3 }): number {
    if (this.formed.has(f.id)) return 1;
    const near = this.nearTo(f.eye);
    if (near >= 0.98) { this.formed.add(f.id); return 1; } // 다 모인 순간(그 자리 20cm 안쪽)
    return near;
  }

  /** (11/19 추가) 문을 경첩(hinge)을 축으로 ang도만큼 돌린 자리에. */
  private swingMat(p: PartState, ang: number) {
    const [hx, hz] = p.def.swing!.hinge;
    const r = p.b.root;
    r.matrix.makeTranslation(hx, 0, hz).multiply(new THREE.Matrix4().makeRotationY((ang * Math.PI) / 180)).multiply(new THREE.Matrix4().makeTranslation(-hx, 0, -hz));
    r.matrixWorldNeedsUpdate = true;
  }

  private swingTo(p: PartState, ang: number) { p.ang = ang; this.swingMat(p, ang); }

  /** (11/19 추가) 화면 노이즈 한 번(논리의 noise 행동): level = 트래킹 노이즈, ms = 화면이 찢어지는 지지직. */
  noise(level: number, ms?: number) {
    this.burst = Math.max(this.burst, level);
    if (ms) this.glitchIn(ms / 1000);
  }

  /** 소품을 벽(천장)의 제자리에: 면 방향으로 돌리고 기울기(tilt)만큼 면 위에서 돌려요. */
  private placeProp(mesh: THREE.Object3D, def: Prop) {
    const f = FACES[def.face];
    mesh.position.set(...def.at);
    mesh.rotation.set(f.rx, f.ry, ((def.tilt ?? 0) * Math.PI) / 180);
  }

  // ── 논리가 시키는 것 (WorldPort) ────────────────────

  /** 다음에 갈 방을 미리 지어 둬요(나눠서 굽기라 그동안 게임은 그대로 돌아요). */
  prebuild(room: Room) {
    if (this.cache.has(room.id)) return;
    const p = this.build(room);
    p.catch(() => this.cache.delete(room.id)); // 실패하면(그림 파일을 못 받음 등) 다음에 다시 지어요
    this.cache.set(room.id, p);
  }

  async enter(room: Room, spawn: Spawn, via: Fx) {
    this.prebuild(room); // 아직 안 지었으면 지금부터(벽을 지나는 동안 같이 지어져요)
    await this.out(via);
    // (11/17 추가) 미리 다 못 지었으면(폰에서 문으로 바로 뛰어든 경우): 지지직 화면이라 한가하니 기다리는 동안은 최대 속도로 지어요
    const pace = { ...bakePace };
    Object.assign(bakePace, { budget: 16, eager: true });
    let b: RoomBuild;
    try { b = await this.cache.get(room.id)!; } finally { Object.assign(bakePace, pace); }
    if (this.cur) this.scene.remove(this.cur.group);
    if (this.cur && this.cur !== b) this.unhold(this.cur); // (11/19 추가) 다른 방으로 가면 들고 있던 종이는 두고 가요(빨간 점 → 갈색 문)
    this.unhold(b); // 실패해서 방을 다시 시작하면 들고 있던 종이도 벽 제자리로
    this.cur = b;
    this.room = room;
    this.scene.add(b.group);
    this.walker.setRects(this.rects());
    this.fresh = true;
    this.lightsOff = 0; // 방에 들어서면 불은 켜진 채로
    this.stats.tris = b.built.stats.tris + b.parts.reduce((s, p) => s + p.b.tris, 0) + b.scat.reduce((s, c) => s + c.mesh.count * 2, 0);
    this.stats.bakeMs = b.built.stats.bakeMs;
    this.place(spawn, via === 'through');
    this.zoom = this.zoomCur = 1;
    await this.in(via);
  }

  async warp(spawn: Spawn, via: Fx) {
    await this.out(via);
    this.place(spawn, via === 'through');
    await this.in(via);
  }

  /** (11/20 추가, 폰 점검) 이 방에서 틀 영상을 뒤쪽 영상 요소에 미리 올려 둬요(받기 시작). 다른 영상을 틀고 있으면 건드리지 않아요. */
  prepareClip(file: string) {
    if (this.clips.active) return;
    void this.clips.prepare(file);
  }

  /** 전체 화면 영상 한 번(논리의 clip 행동). 끝나면 지지직과 함께 3D로 돌아와요. (11/18 추가) onStart = 화면에 나오기 시작한 순간(테이프 기록) */
  async clip(file: string, onStart?: () => void) {
    await this.clips.play(file, { onStart });
    this.clips.stop();
    this.glitchIn(0.7);
  }

  /**
   * 영상이 끝나고 3D로 들어올 때: 3D 화면 자체가 찢어지듯 지지직거리다(가로 긁힘, 물결치는 양옆 가장자리) 잡혀요.
   * (11/17 변경) 인트로 끝의 실사 하얀 방 지지직(최종 영상 10.5~11.7초)을 잘라 내고 그 자리를 3D 하얀 방으로(사용자 의견).
   * sec = 지지직 길이(앞 60%는 세게, 나머지에 걷힘).
   */
  glitchIn(sec = 1.25) {
    this.glitchT = 0;
    this.glitchLen = sec;
    this.burst = Math.max(this.burst, 0.4);
    this.screen.refocus(0.8);
  }

  /** 지금 지지직 세기 0~1. */
  private get glitch(): number {
    if (this.glitchT < 0) return 0;
    const k = this.glitchT / this.glitchLen;
    if (k >= 1) return 0;
    return k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
  }

  /** 지금 부딪히는 벽: 방의 벽 + 지금 있는 "생겼다 사라지는 벽". */
  private rects() {
    const b = this.cur;
    if (!b) return [];
    return [...b.built.rects, ...b.parts.filter((p) => p.on).flatMap((p) => p.b.rects)];
  }

  /** o에서 d쪽으로 가장 먼저 닿는 벽까지의 거리(지금 있는 "생겼다 사라지는 벽" 포함). */
  private nearest(o: V3, d: V3, tMax: number): number {
    const baker = this.cur!.built.baker;
    let t = baker.nearest(o, d, tMax);
    for (const p of this.cur!.parts) {
      if (!this.solid(p)) continue;
      for (const a of p.b.aabbs) t = Math.min(t, baker.rayBox(o, d, a, Math.min(t, tMax)));
    }
    return t;
  }

  /** 생겼다 사라지는 벽이 지금 있는가(시선을 가리는가). (11/18) 테이프에선 그 시각에 보이던 벽. */
  private solid(p: PartState): boolean { return this.tapeV ? p.b.root.visible : p.on; }

  /**
   * 전환 앞부분.
   *   through = 벽을 통과하듯 그대로 앞으로 걸어 들어감. 벽에 닿는 순간 화면이 지지직으로 덮이고, 그 사이에 공간이 바뀌어요
   *   fade = 어두워짐, cut = 바로
   */
  private async out(via: Fx) {
    if (via === 'through') {
      // 걷던 기세를 멈춰요(안 그러면 몸이 조금 더 나아가 카메라가 벽을 뚫고 벽 뒤 빈 곳이 보여요)
      const w = this.walker;
      w.place(w.x, w.z, (w.yaw * 180) / Math.PI, (w.pitch * 180) / Math.PI);
      const [dx, dz] = this.intoWall();
      // 벽 바로 앞(7cm)까지만 다가가요. 더 가면 벽 뒤의 빈 곳(검정)이 보여서, 벽이 화면을 채운 채 지지직으로 넘어가요
      const dist = Math.max(0.05, this.wallDist(this.walker.x, this.walker.z, dx, dz) - 0.07);
      this.pushWalked = 0;
      await this.anim((dist / PASS_SPEED) * 1000, (k) => {
        this.push.set(dx * dist * k, 0, dz * dist * k);
        this.pushWalked = dist * k;
        this.pass = k * k * k; // 벽에 거의 닿았을 때만 짙어져요
      });
    } else if (via === 'fade') await this.anim(FADE_OUT * 1000, (k) => { this.dark = k; });
    else if (via === 'red') {
      // (11/19 추가) 빨간 점: 끝까지 줌을 당기며 화면이 빨갛게 차올라요(영상 41~42초)
      const z0 = this.zoomCur;
      // 든 종이의 빨간 점(뒷면 그림의 점 자리)이 화면 한가운데로 오게 종이를 살짝 옮겨요 — 그대로면 줌을 당길수록 점이 화면 아래로 밀려나요
      this.camera.updateMatrixWorld();
      const moves = (this.cur?.props ?? []).filter((p) => p.held).map((p) => {
        const [w, h] = p.def.plane;
        const dot = p.mesh.localToWorld(new THREE.Vector3(w * 0.03, -h * 0.07, 0));
        const c = this.camera.worldToLocal(dot);
        return { p, from: p.mesh.position.clone(), off: new THREE.Vector3(-c.x, -c.y, 0) };
      });
      await this.anim(RED_OUT * 1000, (k) => {
        const e = ease(Math.min(1, k * 1.6));
        for (const m of moves) m.p.mesh.position.copy(m.from).addScaledVector(m.off, e);
        this.zoom = this.zoomCur = z0 + (this.zoomMax - z0) * ease(k);
        this.fill = [...RED, Math.pow(k, 1.7)];
      });
    }
  }

  /** 전환 뒷부분. through = 새 공간의 벽 속에서 나와 서는 자리까지 그대로 걸어 나옴. */
  private async in(via: Fx) {
    if (via === 'through') {
      const w = this.walker;
      const dx = -Math.sin(w.yaw), dz = -Math.cos(w.yaw); // 서는 자리가 바라보는 쪽 = 걸어 나오는 쪽
      const dist = Math.max(0.05, this.wallDist(w.x, w.z, -dx, -dz) - 0.07); // 등 뒤 벽 바로 앞에서 출발
      const walked0 = this.pushWalked;
      this.push.set(-dx * dist, 0, -dz * dist); // 다음 그림부터 바로 출발 자리에서(한 프레임도 엉뚱한 곳이 안 보이게)
      this.screen.refocus(0.5);
      this.burst = 0.2;
      await this.anim((dist / PASS_SPEED) * 1000, (k) => {
        this.push.set(-dx * dist * (1 - k), 0, -dz * dist * (1 - k));
        this.pushWalked = walked0 + dist * k;
        this.pass = (1 - k) * (1 - k) * (1 - k); // 금방 걷혀서 새 공간이 지지직 너머로 비쳐 나와요
      });
      this.push.set(0, 0, 0);
      this.pass = 0;
    } else if (via === 'red') {
      // (11/19 추가) 빨강이 갈색으로 식으며 걷혀요 — 그 너머에 갈색 문
      this.screen.refocus(0.9);
      this.burst = Math.max(this.burst, 0.3);
      await this.anim(RED_IN * 1000, (k) => {
        const e = Math.min(1, k * 1.8), a = 1 - ease(k);
        this.fill = [RED[0] + (BROWN[0] - RED[0]) * e, RED[1] + (BROWN[1] - RED[1]) * e, RED[2] + (BROWN[2] - RED[2]) * e, a];
      });
      this.fill = [0, 0, 0, 0];
    } else if (via === 'fade') {
      this.screen.refocus(0.9);
      this.burst = 0.25;
      await this.anim(FADE_IN * 1000, (k) => { this.dark = 1 - k; });
    } else {
      this.screen.refocus(0.5);
      this.burst = Math.max(this.burst, 0.3); // 바로 넘어가도 트래킹은 한 번 흐트러졌다 잡혀요
    }
  }

  /** 벽 속으로 들어가는 방향(바닥 위 x, z). 가까운 '너머로 가는 벽'이 있으면 그 벽 쪽, 없으면 바라보는 쪽. */
  private intoWall(): [number, number] {
    const w = this.walker;
    let best = 2.5;
    let dir: [number, number] = [-Math.sin(w.yaw), -Math.cos(w.yaw)];
    for (const p of this.cur?.props ?? []) {
      if (!p.portal || !p.mesh.visible) continue;
      const d = Math.hypot(p.def.at[0] - w.x, p.def.at[2] - w.z);
      if (d < best) {
        best = d;
        const n = FACES[p.def.face].n;
        dir = [-n[0], -n[2]];
      }
    }
    return dir;
  }

  /** (x, z)의 눈높이에서 (dx, dz) 쪽으로 가장 가까운 벽까지의 거리(최대 2.5m). */
  private wallDist(x: number, z: number, dx: number, dz: number): number {
    const d = this.cur ? this.nearest([x, this.walker.y + 1.5, z], [dx, 0, dz], 2.5) : Infinity; // (11/20) 눈높이 = 발 + 1.5
    return Math.min(d, 2.5);
  }

  /** keepPitch = 위아래 시선은 그대로(벽을 지나 이어 걸을 때). */
  private place(s: Spawn, keepPitch = false) {
    const pitch = keepPitch ? (this.walker.pitch * 180) / Math.PI : (s.pitch ?? 0);
    this.walker.place(s.at[0], s.at[2], s.yaw, pitch, s.at[1]); // (11/20) 서는 자리의 높이(계단 — 그 높이의 바닥에 바로 섬)
    this.pose();
  }

  /** ms 동안 fn(0→1)을 불러요. 시간은 tick이 흘려 줘요(화면이 멈춰 있으면 같이 멈춤). */
  private anim(ms: number, fn: (k: number) => void): Promise<void> {
    return new Promise((res) => this.anims.push({ ms, t: 0, fn, res }));
  }

  // ── 되감기 테이프 보기 ── (11/18 추가) ──────────────
  //
  // 라이브 모습은 건드리지 않고 보관했다가, 테이프를 보는 동안만 "그 시각의 모습"으로 보이고 숨겨요.
  // 착시 화살표 색·완성 여부, 지지직 사라짐, 부딪히는 벽, 걷는 몸은 전혀 안 건드려요(나오면 들어가기 직전 그대로).

  /** 되감기를 시작해도 되는 세계 상태인가: 벽 통과·어두워짐·지지직 사라짐·전체 화면 영상·연출 움직임(떼기·깜빡임)이 없을 때. */
  get settled(): boolean {
    return !!this.cur && !this.anims.length && this.pass === 0 && this.push.lengthSq() === 0 && this.dark === 0
      && this.glitchT < 0 && !this.clips.active && !this.cur.parts.some((p) => !!p.dis || !!p.sw) && this.fill[3] === 0;
  }

  /** 지금 불이 꺼진 정도(0~1). 테이프에선 그 시각의 불(정전도 찍혀 있어요). */
  private get lightsNow(): number {
    const v = this.tapeV;
    if (!v) return this.lightsOff;
    const l = v.light;
    if (!l || l.since < 0) return 0;
    if (l.fx === 'off') return 1;
    if (l.fx === 'on') { const k = clamp01(l.since / 0.45); return 1 - k * k * (3 - 2 * k); }
    let acc = 0;
    for (let i = 0; i < FLICKER.length; i++) {
      acc += FLICKER[i] / 1000;
      if (l.since < acc) return i % 2 === 0 ? 0.92 : 0.06;
    }
    return 0;
  }

  /** (11/18 추가) 테이프 속 순간이동의 어두워짐: 그때 fade였으면 테이프에서도 어두워졌다 밝아져요(사용자 의견: 뚝 끊기지 않게). */
  private get tapeDark(): number {
    const w = this.tapeV?.warp;
    if (!w || w.via !== 'fade') return 0;
    // 자리가 바뀐 순간(cut)에 가장 어둡게: 그 전 FADE_OUT 동안 어두워지고, 뒤 FADE_IN 동안 밝아져요
    if (w.cut !== null) return w.cut < 0 ? clamp01(1 + w.cut / FADE_OUT) : Math.max(0, 1 - w.cut / FADE_IN);
    if (w.after !== null) return 0;
    if (w.since < FADE_OUT) return w.since / FADE_OUT;
    return Math.max(0, 1 - (w.since - FADE_OUT) / FADE_IN);
  }

  /** 테이프 보기 시작: 지금 라이브 모습을 통째로 보관해요. */
  tapeBegin() {
    const b = this.cur;
    if (!b) return;
    this.tapeSaved = {
      props: b.props.map((p) => p.mesh.visible),
      scat: b.scat.map((c) => c.mesh.visible),
      parts: b.parts.map((p) => p.b.root.visible),
      held: b.props.filter((p) => p.held).map((p) => ({ p, pos: p.mesh.position.clone(), q: p.mesh.quaternion.clone() })),
    };
    this.burst = Math.max(this.burst, 0.5); // 철컥 — 트래킹이 한 번 흐트러져요
    this.screen.refocus(0.35);
  }

  /** 테이프의 그 시각 모습으로 맞춰요(매 프레임). layer: 'live'는 숨고 'tape'은 보이고, 조건은 그 시각의 상태로. */
  tapeShow(v: TapeView) {
    const b = this.cur;
    if (!b || !this.tapeSaved) return;
    this.tapeV = v;
    this.pose(); // 카메라를 먼저(들고 있던 종이를 카메라 기준으로 다시 놓아야 해서)
    const want = (when: Cond | undefined, layer: 'live' | 'tape' | undefined) => layer !== 'live' && (!when || v.test(when));
    for (const p of b.props) {
      if (p.held) this.tapeHeld(p, v);
      else p.mesh.visible = want(p.def.when, p.def.layer);
    }
    for (const c of b.scat) c.mesh.visible = want(c.def.when, c.def.layer);
    for (const p of b.parts) {
      const on = !p.def.when || v.test(p.def.when);
      if (p.def.swap === 'swing') { p.b.root.visible = !p.def.show || v.test(p.def.show); this.swingMat(p, on ? 0 : p.def.swing!.deg); } // 문은 그 시각에 열려 있었는지((11/20) 보일 조건도 그 시각대로)
      else p.b.root.visible = on;
    }
    this.coldTape = this.room?.cold && v.test(this.room.cold) ? 1 : 0;
    this.sunTape = !this.room?.sun?.when || v.test(this.room.sun.when) ? 1 : 0;
    // (11/19 6단계) 켜고 끄는 등도 그 시각대로. (2차) 끝없는 복도·3D 열쇠도
    if (b.live) b.live.tape = { on: b.live.def.lamps.slice(0, LIVE_N).map((l) => !l.when || v.test(l.when)), dim: !!b.live.def.dim && v.test(b.live.def.dim.when) };
    if (b.far) { const [vis, lit] = this.farState(b.far, v.test); this.applyFar(b.far, b.live, vis, lit); }
    for (const kb of b.keys) this.keyApply(kb, kb.poses[this.keyState(kb.def, v.test) as keyof KeyBuild['poses']]);
    if (v.insert) this.tapeVideo = this.tapeClip.show(v.insert.file, v.insert.t, v.speed);
    else { this.tapeVideo = null; this.tapeClip.hide(); }
  }

  /**
   * 캠코더 앞에 들고 있는 종이(라이브에서 뗀 것)를 테이프의 그 시각대로: 떼기 전엔 없음(벽엔 테이프용 소품이 붙어 있어요),
   * 떼는 중엔 벽에서 들려 다가오고, 그 뒤엔 캠코더 앞, 뒤집은 뒤엔 뒷면.
   */
  private tapeHeld(p: PropState, v: TapeView) {
    const pk = v.picks.get(p.def.id);
    p.mesh.visible = !!pk;
    if (!pk) return;
    const pos = HOLD_AT.clone(), q = HOLD_Q.clone();
    const k = pk.pick;
    if (k < PICK_LIFT + PICK_MOVE) {
      // 벽의 제자리를 카메라 기준으로 바꿔서, 거기서부터 다가오게
      const f = FACES[p.def.face];
      const inv = this.camera.matrixWorldInverse;
      const wall = new THREE.Vector3(...p.def.at).applyMatrix4(inv);
      const lift = new THREE.Vector3(...f.n).transformDirection(inv).multiplyScalar(0.035);
      const wq = this.camera.quaternion.clone().invert().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(f.rx, f.ry, ((p.def.tilt ?? 0) * Math.PI) / 180)));
      if (k < PICK_LIFT) {
        pos.copy(wall).addScaledVector(lift, ease(k / PICK_LIFT));
        q.copy(wq);
      } else {
        const e = ease((k - PICK_LIFT) / PICK_MOVE);
        pos.lerpVectors(wall.add(lift), HOLD_AT, e);
        q.slerpQuaternions(wq, HOLD_Q, e);
      }
    }
    if (pk.flip !== null) {
      const e = ease(clamp01(pk.flip / FLIP_LEN));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * e));
      pos.z -= Math.sin(Math.PI * e) * 0.035;
    }
    p.mesh.position.copy(pos);
    p.mesh.quaternion.copy(q);
  }

  /** 테이프 보기 끝: 보관해 둔 라이브 모습 그대로 되돌려요. */
  tapeEnd() {
    const b = this.cur, s = this.tapeSaved;
    this.tapeV = null;
    this.tapeSaved = null;
    this.tapeVideo = null;
    this.tapeClip.hide();
    if (b?.live) b.live.tape = null; // (11/19 6단계) 켜고 끄는 등은 라이브 상태로
    for (const kb of b?.keys ?? []) this.keyApply(kb, kb.cur); // (2차) 열쇠도 라이브 자세로(끝없는 복도는 다음 sync가 맞춰요)
    if (b && s) {
      b.props.forEach((p, i) => { p.mesh.visible = s.props[i]; });
      b.scat.forEach((c, i) => { c.mesh.visible = s.scat[i]; });
      b.parts.forEach((p, i) => { p.b.root.visible = s.parts[i]; if (p.def.swap === 'swing') this.swingMat(p, p.ang ?? 0); });
      for (const h of s.held) { h.p.mesh.position.copy(h.pos); h.p.mesh.quaternion.copy(h.q); }
    }
    this.burst = Math.max(this.burst, 0.45);
    this.screen.refocus(0.5);
    this.pose();
  }

  // ── 매 프레임 ──────────────────────────────────────

  /** 시간을 흘리고, 걷고, 카메라를 맞춰요. move가 null이면 서 있어요(조작 잠김). */
  tick(dt: number, move: Move | null) {
    this.time += dt;
    this.walker.update(dt, move?.fwd ?? 0, move?.side ?? 0, move?.run ?? false);
    this.zoom = Math.max(1, Math.min(this.zoomMax, this.zoom));
    this.zoomCur += (this.zoom - this.zoomCur) * Math.min(1, dt * 8);

    const a = this.anims[0];
    if (a) {
      a.t += dt * 1000;
      const k = Math.min(1, a.t / a.ms);
      a.fn(k);
      if (k >= 1) { this.anims.shift(); a.res(); }
    }
    this.burst = Math.max(0, this.burst - dt * 1.5);
    // 지지직 사라짐(나타남) 진행
    for (const p of this.cur?.parts ?? []) {
      if (!p.u) continue;
      p.u.uTime.value = this.time;
      if (!p.dis) continue;
      p.dis.t += dt;
      const k = Math.min(1, p.dis.t / ((p.def.ms ?? 1400) / 1000));
      p.u.uDissolve.value = p.dis.want ? 1 - k : k;
      if (k >= 1) {
        const want = p.dis.want;
        p.dis = undefined;
        p.u.uDissolve.value = 0;
        p.on = p.b.root.visible = want;
        this.walker.setRects(this.rects());
      }
    }
    // (11/19 추가) 문 열림, 차가운 맨벽으로 바뀜(0.25초 — 강한 지지직과 함께 순식간에)
    for (const p of this.cur?.parts ?? []) {
      if (!p.sw) continue;
      p.sw.t += dt;
      const k = clamp01(p.sw.t / (p.sw.ms / 1000));
      this.swingTo(p, p.sw.from + (p.sw.to - p.sw.from) * (p.sw.close ? k * k : 1 - (1 - k) ** 3));
      if (k >= 1) p.sw = undefined;
    }
    for (const kb of this.cur?.keys ?? []) this.keyTick(kb, dt); // (11/19 6단계 2차) 3D 열쇠 움직임
    this.cold += Math.sign(this.coldWant - this.cold) * Math.min(Math.abs(this.coldWant - this.cold), dt / 0.25);
    if (this.glitchT >= 0) this.glitchT = this.glitchT + dt > this.glitchLen ? -1 : this.glitchT + dt;
    this.tickLive(dt); // (11/19 6단계) 켜고 끄는 등의 깜빡임·정전
    this.pose();
    // (11/20 추가) 홀로그램 글씨: 처음 눈에 들어오는 순간 형광등처럼 깜빡이며 켜져요(숨으면 다시 꺼진 채로). 테이프에선 보이면 켜진 채로
    for (const p of this.cur?.props ?? []) {
      const h = p.holo;
      if (!h) continue;
      h.u.uTime.value = this.time;
      if (this.tapeV) { h.u.uOn.value = p.mesh.visible ? 1 : 0; continue; }
      if (!p.mesh.visible) { h.t = -1; h.u.uOn.value = 0; continue; }
      if (h.t < 0 && this.seen(p.points)) h.t = 0;
      if (h.t >= 0) h.t += dt;
      h.u.uOn.value = holoOn(h.t);
    }
  }

  private pose() {
    const c = this.camera;
    const v = this.tapeV;
    c.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) / (v ? v.pose.zoom : this.zoomCur)) * 180) / Math.PI;
    c.updateProjectionMatrix();
    if (v) {
      // (11/18 추가) 테이프: 기록된 자리·시선·줌으로. 걸음 출렁임·손떨림도 라이브와 같은 식(손떨림은 테이프 시각 기준 → 멈추면 화면도 멈춰요)
      const p = v.pose;
      // (11/18 변경) 빨리 감을수록 흔들림을 약하게(calm = 1 / 빠르기) — 사용자 의견: 되감을 때 흔들려서 멀미남
      Walker.pose(c, { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, walked: v.walked, moving: v.moving, pace: 0 }, v.t + 3.7, this.walker.shake * v.calm); // (11/20) 발 높이도
      c.updateMatrixWorld();
      return;
    }
    this.walker.apply(c, this.time);
    if (this.pass > 0 || this.push.lengthSq() > 0) {
      // 벽을 지나는 중: 몸보다 앞(뒤)에 카메라를 두고, 걸음 출렁임을 이어요
      c.position.add(this.push);
      c.position.y += Math.sin((this.pushWalked / STRIDE) * Math.PI * 2) * 0.02 * this.walker.shake;
    }
    c.updateMatrixWorld();
  }

  /**
   * 세계가 본 것: 조준한 대상과 서 있는 영역.
   * at을 주면 화면의 그 자리(-1~1)에서, 안 주면 화면 한가운데에서 선을 쏴요.
   */
  sense(targets: Target[], at?: [x: number, y: number] | null): { aim: string | null; zones: string[]; seen: string[] } {
    const zones: string[] = [];
    const seen: string[] = [];
    if (!this.room || !this.cur) return { aim: null, zones, seen };
    const w = this.walker;
    const [vx, vz] = w.vel;
    const speed = Math.hypot(vx, vz);
    for (const z of this.room.zones ?? []) {
      if (Math.abs(w.x - z.at[0]) >= z.size[0] / 2 || Math.abs(w.z - z.at[2]) >= z.size[2] / 2) continue;
      // (11/20 추가) 높이도: 발 높이가 영역의 높이 범위 안일 때만(계단 — 시작 칸 바로 위층이 꼭대기). 다른 방 영역은 0~2m라 그대로
      if (Math.abs(w.y - z.at[1]) > z.size[1] / 2) continue;
      if (z.into) {
        // 그 벽 쪽으로 걸어 들어가는 중일 때만(움직임 방향이 벽과 70° 안쪽, 초당 25cm 넘게)
        const n = FACES[z.into].n;
        if (speed < 0.25 || (vx * n[0] + vz * n[2]) / speed < 0.35) continue;
      }
      zones.push(z.id);
    }

    const cam = this.camera;
    const d = this.v3;
    if (at) d.set(at[0], at[1], 0.5).unproject(cam).sub(cam.position).normalize();
    else cam.getWorldDirection(d);
    const o: V3 = [cam.position.x, cam.position.y, cam.position.z];
    const dir: V3 = [d.x, d.y, d.z];
    const baker = this.cur.built.baker;
    let aim: string | null = null;
    let best = Infinity;
    for (const t of targets) {
      if (t.on === 'seen') continue; // seen은 조준이 아니라 "화면에 보이는가"(아래)
      if (t.held) {
        // (11/19 추가) 캠코더 앞에 든 종이: 들고 있는 동안은 늘 조준한 것(가장 가까움)
        if (this.cur.props.some((p) => p.held && p.def.id === t.held)) { aim = t.id; best = 0; }
        continue;
      }
      const box = {
        min: [t.at[0] - t.size[0] / 2, t.at[1] - t.size[1] / 2, t.at[2] - t.size[2] / 2] as V3,
        max: [t.at[0] + t.size[0] / 2, t.at[1] + t.size[1] / 2, t.at[2] + t.size[2] / 2] as V3,
      };
      const dist = baker.rayBox(o, dir, box, t.maxDist);
      if (dist >= best) continue;
      if (this.nearest(o, dir, dist) < dist - 0.06) continue; // 벽에 가려짐
      best = dist;
      aim = t.id;
    }

    // (11/18 추가) seen: 대상 상자의 가운데나 넓은 면의 네 점 중 하나라도 화면 안쪽(가장자리 10% 제외)에 있고,
    // 벽에 가리지 않고, 닿는 거리 안이면 — 조준하지 않아도 돼요(벽 한쪽을 덮은 무리처럼 큰 것도 일부만 보이면 돼요)
    if (this.lightsNow <= 0.85) {
      for (const t of targets) {
        if (t.on !== 'seen') continue;
        if (this.seenPoints(t).some((p) => this.inView(p, o, t.maxDist))) seen.push(t.id);
      }
    }
    return { aim, zones, seen };
  }

  /** seen 대상의 판정 점: 가운데 + 가장 넓은 두 방향으로 70% 안쪽의 네 점(벽에서 3cm 앞으로 띄움). */
  private seenPoints(t: Target): V3[] {
    const axes = [0, 1, 2].sort((a, b) => t.size[b] - t.size[a]);
    const [a, b, n] = axes;
    const pts: V3[] = [[...t.at]]; // 방 데이터는 고치지 않게 복사해서
    for (const [sa, sb] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p: V3 = [...t.at];
      p[a] += sa * t.size[a] * 0.35;
      p[b] += sb * t.size[b] * 0.35;
      pts.push(p);
    }
    // 가장 얇은 방향으로는 카메라 쪽 면에 맞춰요(벽 속에 묻힌 점이 가렸다고 치이지 않게)
    const cam = this.camera.position;
    const toward = Math.sign([cam.x, cam.y, cam.z][n] - t.at[n]) || 1;
    for (const p of pts) p[n] = t.at[n] + toward * (t.size[n] / 2 + 0.03);
    return pts;
  }

  /** 한 점이 화면 안쪽(가장자리 10% 제외)에 있고, 벽에 가리지 않고, maxDist 안인가. */
  private inView(p: V3, o: V3, maxDist: number): boolean {
    const q = this.v3b.set(p[0], p[1], p[2]).project(this.camera);
    if (q.z > 1 || Math.abs(q.x) > 0.8 || Math.abs(q.y) > 0.8) return false;
    const dx = p[0] - o[0], dy = p[1] - o[1], dz = p[2] - o[2];
    const len = Math.hypot(dx, dy, dz);
    if (len > maxDist || len < 1e-4) return false;
    return this.nearest(o, [dx / len, dy / len, dz / len], len) >= len - 0.06;
  }

  /** 소품·벽의 점들 중 하나라도 지금 화면에 보이는가(화면 안에 있고 벽에 가리지 않음). */
  private seen(points: V3[]): boolean {
    // 불이 꺼진 암흑에서는 아무것도 안 보여요(그사이 바뀜). (11/20 추가) fade 전환으로 캄캄한 순간도(계단 루프 — 다음 바퀴의 이상현상이 그때 바뀌어요)
    if (Math.max(this.lightsNow, this.dark) > 0.85) return false;
    const cam = this.camera;
    this.frustum.setFromProjectionMatrix(this.mat4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const o: V3 = [cam.position.x, cam.position.y, cam.position.z];
    for (const q of points) {
      if (!this.frustum.containsPoint(this.v3.set(q[0], q[1], q[2]))) continue;
      const d: V3 = [q[0] - o[0], q[1] - o[1], q[2] - o[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-6) return true;
      if (this.nearest(o, [d[0] / len, d[1] / len, d[2] / len], len) >= len - 0.05) return true;
    }
    return false;
  }

  /**
   * 조건에 맞춰 소품을 보이거나 숨겨요.
   * swap: 'unseen'인 소품은 화면에 안 보일 때까지 기다렸다가 바뀌어요. force = 기다리지 않고 바로(방에 막 들어섰을 때).
   * tape = 되감은 테이프를 그리는 중(테이프에만 찍힌 것이 보이고, 지금 눈에만 보이는 것은 숨어요).
   */
  sync(test: (c: Cond) => boolean, force = false, tape = false) {
    if (!this.cur) return;
    force ||= this.fresh;
    this.fresh = false;
    this.coldWant = this.room?.cold && test(this.room.cold) ? 1 : 0;
    if (force) this.cold = this.coldWant;
    this.sunWant = !this.room?.sun?.when || test(this.room.sun.when) ? 1 : 0;
    this.exposureOn = !this.room?.exposureOff || !test(this.room.exposureOff); // (11/19 6단계 2차) 창밖 복도에선 따뜻한 방의 노출 배율을 안 씀
    // (11/20 7단계) 하얀 빛이 차오름: 노출 배율을 천천히 바꿔요(render에서)
    this.brightWant = this.room?.bright && test(this.room.bright.when) ? this.room.bright.x : 0;
    if (force) this.brightCur = this.brightWant;
    // (11/19 6단계) 켜고 끄는 등: 켜지면 형광등처럼 깜빡이며(방에 막 들어섰을 땐 바로), 꺼지면 탁. 정전(구운 빛 줄이기)도
    const L = this.cur.live;
    if (L) {
      L.def.lamps.slice(0, LIVE_N).forEach((lamp, i) => {
        const want = !lamp.when || test(lamp.when);
        if (want === L.want[i] && !force) return;
        L.flick[i] = want && !force && !L.want[i] && !lamp.fade ? 0 : -1; // (11/20 7단계) fade 등은 깜빡이지 않고 서서히(tickLive)
        L.want[i] = want;
        if (force) L.level[i] = want ? 1 : 0;
      });
      L.baseWant = L.def.dim && test(L.def.dim.when) ? L.def.dim.level : 1;
      if (force) L.base = L.baseWant;
    }
    // (11/19 6단계 2차) 끝없는 복도·3D 열쇠
    if (this.cur.far) { const [vis, lit] = this.farState(this.cur.far, test); this.applyFar(this.cur.far, L, vis, lit); }
    for (const kb of this.cur.keys) this.keySync(kb, test, force);
    const layerOk = (l?: 'live' | 'tape') => !l || l === (tape ? 'tape' : 'live');
    // (11/17 5차 추가) 착시 화살표 세기: 조건이 맞는 화살표는 가까움(완성되면 1)을, 나머지는 0을 0.35초쯤에 걸쳐 따라가요
    const dtS = Math.min(0.1, Math.max(0, this.time - this.syncT));
    this.syncT = this.time;
    const ease = 1 - Math.exp(-dtS / 0.12);
    for (const def of new Set(this.cur.scat.map((c) => c.def))) {
      const active = def.figures?.findIndex((f) => test(f.when)) ?? -1;
      def.figures?.forEach((f, i) => {
        const target = i === active ? this.figureNear(f) : 0;
        const cur = this.figLevel.get(f.id) ?? 0;
        let next = force ? target : cur + (target - cur) * ease;
        if (Math.abs(target - next) < 0.003) next = target;
        this.figLevel.set(f.id, next);
      });
    }
    for (const p of this.cur.props) {
      if (p.held) continue; // 캠코더 앞에 든 종이는 조건과 상관없이 그대로
      const want = (!p.def.when || test(p.def.when)) && layerOk(p.def.layer);
      if (want === p.mesh.visible) continue;
      if (!force && p.def.swap === 'unseen' && this.seen(p.points)) continue;
      p.mesh.visible = want;
    }
    for (const c of this.cur.scat) {
      const want = (!c.def.when || test(c.def.when)) && layerOk(c.def.layer);
      if (want !== c.mesh.visible && (force || c.def.swap !== 'unseen' || !this.seen(c.points))) c.mesh.visible = want;
      // 착시 화살표: 조건이 맞는 첫 화살표 하나만. 맞춰지는 자리에 가까울수록 화살표 종이들이 하나둘 같은 색으로 물들어요
      // (11/17 4차 변경) ~~바꾸는 건 이 조각을 안 보는 사이에~~ → 가까움에 따라 계속
      if (c.mesh.visible && c.def.figures?.length) tint(c, c.def.figures.map((f) => this.figLevel.get(f.id) ?? 0));
    }
    let moved = false;
    for (const p of this.cur.parts) {
      const want = !p.def.when || test(p.def.when);
      if (p.def.swap === 'swing') {
        // (11/19 추가) 문: 사라지지 않고 열려요. 처음(방에 들어설 때)·다시 닫힐 때(실패)는 바로, 열릴 때는 천천히
        // (11/20 7단계) show = 보일 조건 — 안 보는 사이에만 나타나고 사라져요(congratulations! 문)
        const vis = !p.def.show || test(p.def.show);
        if (vis !== p.b.root.visible && (force || !this.seen(p.b.points))) p.b.root.visible = vis;
        if (want === p.on && p.ang !== undefined) continue;
        p.on = want;
        moved = true;
        const to = want ? 0 : p.def.swing!.deg;
        // (11/19 6단계 2차 변경) 다시 닫힐 때도 움직여요(쾅 닫히는 문 — closeMs). 방에 막 들어섰을 때·실패해서 다시 시작할 땐 바로
        if (force || p.ang === undefined) { p.sw = undefined; this.swingTo(p, to); }
        else p.sw = { t: 0, from: p.ang, to, ms: want ? (p.def.closeMs ?? p.def.ms ?? 1400) : (p.def.ms ?? 1400), close: want };
        continue;
      }
      if (p.dis) { p.dis.want = want; continue; } // 지지직 사라지는 중이면 끝날 때 맞춰요
      if (want === p.on) continue;
      if (!force && p.def.swap === 'dissolve' && p.u) {
        // 보는 중이어도 지지직거리며 사라져요(나타날 땐 보이게 한 뒤 반대로). 부딪힘·가림은 다 사라진 뒤에 빠져요
        p.dis = { t: 0, want };
        p.b.root.visible = true;
        p.u.uDissolve.value = want ? 1 : 0;
        if (want) { p.on = true; moved = true; }
        continue;
      }
      if (!force && p.def.swap === 'unseen' && this.seen(p.b.points)) continue;
      p.on = p.b.root.visible = want;
      if (p.u) p.u.uDissolve.value = 0;
      moved = true;
    }
    if (moved) this.walker.setRects(this.rects());
  }

  /**
   * 그리기. vhs = 논리가 정한 노이즈 세기(0~1), look = 화면 분위기, dt = 실제로 흐른 시간,
   * aim = 조준 대상에 맞음, osd = 캠코더 글씨.
   */
  render(f: { vhs: number; look: Look; dt: number; aim: boolean; osd: OsdState }) {
    // (11/18 추가) 테이프를 볼 때는 끼어든 실사 영상(있으면), 아니면 그 시각의 3D
    const video = this.tapeV ? this.tapeVideo : this.clips.texture;
    const lights = this.lightsNow;
    if (!video) this.render3d();
    this.screen.render(this.renderer, {
      dt: f.dt,
      look: f.look,
      // 방 기본값 0.25일 때 시험 방에서 확인받은 세기(0.35)가 되게 맞춰요. 영상은 이미 찍힌 화면이라 약하게
      vhs: video ? 0.12 + this.burst : Math.min(1, (0.35 * f.vhs) / 0.25 + this.burst + this.near * 0.18),
      dark: Math.max(this.tapeV ? this.tapeDark : this.dark, lights),
      night: video ? 0 : lights,
      cold: video ? 0 : this.tapeV ? this.coldTape : this.cold,
      bias: this.bias(f.dt),
      fill: this.fill,
      pass: this.pass,
      zoom: video ? 1 : this.tapeV ? this.tapeV.pose.zoom : this.zoomCur,
      aim: f.aim && !video,
      osd: f.osd,
      video,
      glitch: video ? 0 : this.glitch,
    });
  }

  /** 노출 배율. (11/20 7단계) Room.bright가 켜지면 약 2.5초에 걸쳐 그 배율로 차올라요(문틈 빛 → 하얗게 날아감) */
  private bias(dt: number): number {
    const base = 1 + ((this.exposureOn ? this.room?.exposure ?? 1 : 1) - 1) * (1 - (this.tapeV ? this.coldTape : this.cold));
    const want = this.brightWant || base;
    if (!this.brightCur) this.brightCur = base;
    this.brightCur += (want - this.brightCur) * Math.min(1, dt * 1.2);
    if (!this.brightWant && Math.abs(this.brightCur - base) < 0.01) this.brightCur = 0;
    return this.brightCur || base;
  }

  private render3d() {
    // 너머로 가는 벽: 다가갈수록 문 모양이 떠오르고 지지직이 짙어져요. 아주 가까이 가면 캠코더도 살짝 흔들려요
    let near = 0;
    const cam = this.camera.position;
    const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (const p of this.cur?.props ?? []) {
      if (!p.portal) continue;
      const d = Math.hypot(p.def.at[0] - cam.x, p.def.at[2] - cam.z);
      const u = p.portal.uniforms;
      u.uTime.value = this.time;
      u.uFade.value = 1 - smooth(PORTAL_FADE[1], PORTAL_FADE[0], d);
      u.uNear.value = 1 - smooth(0.7, 2.2, d);
      if (p.mesh.visible) near = Math.max(near, u.uNear.value as number);
    }
    this.near = near;
    this.applySun(this.tapeV ? this.sunTape : this.sunWant);
    this.applyLive(); // (11/19 6단계) 켜고 끄는 등
    this.renderer.setRenderTarget(this.screen.scene);
    this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
  }
}
