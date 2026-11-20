/**
 * 캠코더 화면 — 3D로 그린 한 장을 "캠코더로 찍어 VHS 테이프에 녹화한 화면"으로 바꿔요.
 * 시험 방의 임시 필터(src/lab3d/vhs.ts)를 대신하는 정식 셰이더예요(셰이더 = 화면 전체에 효과를 입히는 작은 그래픽 프로그램).
 *
 * 순서 (PIVOT_3D_PLAN.md 4장)
 *   ① 3D → scene (640×480, 밝은 곳이 1을 넘어도 담기는 화면)
 *   ② 밝기 재기 (1×1)  : 화면 평균 밝기를 재서 천천히 따라가요 → 자동 노출. GPU 안에서만 돌아서 폰이 멈칫하지 않아요
 *   ③ 렌즈 (640×480)    : 노출, 줌할 때 초점 흐림, 조준하면 살짝 또렷
 *   ④ 테이프 (창 크기, 최대 1920×1440) : OSD 글씨를 찍고 → 색 번짐, 트래킹 흔들림, 맨 아래 지그재그, 알갱이,
 *                         상황마다 다른 화면(되감기 노이즈 띠, 멈춤 떨림, 테이프 씹힘, 파란 화면, 벽을 지나는 지지직)
 *   ⑤ 화면 (창 크기)    : 주사선과 약한 인터레이스를 얹음
 *
 * (11/17 추가) 전체 화면 영상(인트로·옛 녹화·엔딩)일 때는 ①~③ 대신 영상을 그대로 ④에 넣어요.
 *   영상은 이미 찍힌 화면이라 자동 노출·초점은 빼고, 테이프 효과(번짐·트래킹·주사선)만 똑같이 입혀요.
 *
 * (11/16 변경) 사용자 의견: "걸을 때 시험 방보다 흐리고 어지럽다" → 잔상을 빼고, ④를 시험 방처럼 창 크기에서 계산해요.
 * "가끔 생기는 하얀 줄은 빼기", "맨 아래 노이즈 줄은 지그재그로", "노이즈 띠는 진짜 지지직처럼", "휩팬 빼기"도 반영했어요.
 *
 * (11/18 추가) 테이프를 돌려 볼 때(play·slow·pause·rew·ff)는 녹화 화면과 확실히 다르게(사용자 의견: 녹화인지 테이프인지 헷갈림):
 *   - 작은 모니터로 돌려 보는 화면: 그림이 살짝 작아지고(84%), 볼록한 브라운관 모양 + 둥근 모서리, 둘레는 어두운 테두리(⑤)
 *   - 복사한 테이프 같은 색: 색이 바래고 살짝 차가운 색, 검정이 뜨고 대비가 낮고, 조금 더 번져요(④ — 캠코더 글씨는 또렷하게 그대로)
 *   - 들어갈 때 0.25초쯤 그림이 모니터 안으로 줄어들고, 나올 때 다시 화면 가득 펼쳐져요
 *   - 멀미 줄이기: 멈춤 화면의 위아래 떨림을 뺐고, 되감기 노이즈 띠를 조금 가늘고 천천히
 */
import * as THREE from 'three';
import { Osd, type OsdState } from './osd.ts';

/** 화면 분위기. live = 녹화 중, rew~ff = 테이프 볼 때(되감기 단계에서 씀), fail = 테이프 씹힘, menu = 파란 화면. */
export type Look = 'live' | 'play' | 'slow' | 'pause' | 'rew' | 'ff' | 'fail' | 'menu';
export const LOOKS: Look[] = ['live', 'play', 'slow', 'pause', 'rew', 'ff', 'fail', 'menu'];

/** 한 프레임에 넘기는 값. */
export interface ScreenFrame {
  /** 실제로 흐른 시간(초). 멈춤 화면에서도 노이즈가 살아 있게 게임 시간과 따로 받아요. */
  dt: number;
  look: Look;
  /** 노이즈 세기 0~1(논리가 정한 값 + 방 옮길 때 튀는 값). */
  vhs: number;
  /** 0 = 보임, 1 = 완전히 어두움(fade 전환). */
  dark: number;
  /** 벽을 지나는 중의 지지직 0~1(through 전환). */
  pass: number;
  zoom: number;
  aim: boolean;
  osd: OsdState;
  /** (11/17 추가) 전체 화면 영상. 있으면 3D 대신 이걸 그려요. */
  video?: THREE.Texture | null;
  /** (11/17 추가) 영상 → 3D로 들어올 때의 찢어지는 지지직 0~1(인트로 끝 → 하얀 방). */
  glitch?: number;
  /** (11/17 추가) 불이 꺼진 정도 0~1: 캠코더가 어둠 속에서 밝기를 끌어올려 자글자글한 검정 */
  night?: number;
  /** (11/19 추가) 차갑고 어두운 화면 0~1(따뜻한 방을 풀고 난 뒤의 어두운 맨벽 — 색이 빠진 회색빛) */
  cold?: number;
  /** (11/19 3차 추가) 노출 배율(방의 exposure) */
  bias?: number;
  /** (11/19 추가) 화면을 한 색으로 덮기 [r, g, b(빛의 세기), 덮는 정도 0~1] — 빨간 점이 화면을 채움 → 갈색으로 식음 */
  fill?: [number, number, number, number];
}

/**
 * 자동 노출 기준 밝기. 통로 첫 화면(복도 끝을 바라봄)에서 잰 평균 밝기예요.
 * 여기서 노출 1배 = 시험 방과 같은 밝기. 이보다 어두운 곳에서는 밝기를 끌어올리고(대신 자글자글해짐), 밝은 곳에서는 줄여요.
 */
const AE_KEY = 0.6;
/**
 * (11/18 추가) 테이프를 돌려 볼 때의 모니터: 그림 크기(화면에 대한 비율)와 그림 가운데를 위로 올리는 정도(화면 높이 비율).
 * pc: 아래 테두리가 더 두꺼워서 키 안내 줄(폰 버튼 줄을 그림 밖에 둘 자리가 없을 때는 버튼 줄도)이 테두리 위에 놓여요.
 * (11/19 추가) phone: 폰 화면은 작아서 90%로 키워요(사용자 결정). 버튼 줄은 그림 밖 검은 자리로 가서 테두리는 얇게.
 * main.ts가 고르고(setMonitor), 폰에서 누른 자리를 그림 안 자리로 바꿀 때도 써요.
 */
export interface Monitor { scale: number; lift: number }
export const MONITOR = {
  pc: { scale: 0.84, lift: 0.04 },
  phone: { scale: 0.9, lift: 0.02 },
} satisfies Record<string, Monitor>;
/** ④ 테이프 단계를 그리는 가장 큰 크기 = 내부 해상도의 몇 배(큰 모니터에서 너무 무거워지지 않게). */
const TAPE_MAX = 3;

// ── 셰이더 ───────────────────────────────────────────

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COMMON = /* glsl */ `
varying vec2 vUv;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// 자동 노출 배율: 기준보다 어두우면 끌어올리고 밝으면 줄여요(다 맞추지는 않고 65%만 — 캠코더처럼)
float exposure(sampler2D lum, float key, bool on) {
  if (!on) return 1.0;
  float a = texture2D(lum, vec2(0.5)).r;
  return clamp(pow(key / max(a, 1e-4), 0.65), 0.7, 1.9);
}`;

/** ② 밝기 재기: 화면을 12×9 곳에서 재서(가운데를 더 중요하게) 직전 값에서 천천히 따라가요. */
const LUM = /* glsl */ `
${COMMON}
uniform sampler2D tScene, tPrev;
uniform float uDt;
uniform bool uReset;
void main() {
  float s = 0.0, ws = 0.0;
  for (int j = 0; j < 9; j++) for (int i = 0; i < 12; i++) {
    vec2 uv = (vec2(float(i), float(j)) + 0.5) / vec2(12.0, 9.0);
    vec3 c = texture2D(tScene, uv).rgb;
    vec2 q = uv - 0.5;
    float w = 1.0 - dot(q, q) * 1.6;
    s += log(dot(c, vec3(0.2126, 0.7152, 0.0722)) + 0.001) * w;
    ws += w;
  }
  float cur = exp(s / ws);
  float prev = texture2D(tPrev, vec2(0.5)).r;
  // 밝아질 때는 빨리(0.45초), 어두워질 때는 천천히(0.9초). 그 사이에 잠깐 하얗게 날아가거나 어두워요
  float k = 1.0 - exp(-uDt / (cur > prev ? 0.45 : 0.9));
  gl_FragColor = vec4(uReset ? cur : mix(prev, cur, k), 0.0, 0.0, 1.0);
}`;

/** ③ 렌즈. */
const LENS = /* glsl */ `
${COMMON}
uniform sampler2D tScene, tLum;
uniform vec2 uRes;
uniform float uKey, uDark, uBlur, uSharp, uFlash, uCold, uBias;
uniform vec4 uFill;
uniform bool uAe;
float ev;
// 캠코더 밝기 반응: 밝은 곳이 부드럽게 날아가요(시험 방에서 확인받은 곡선)
vec3 grab(vec2 uv) { vec3 c = texture2D(tScene, clamp(uv, 0.0, 1.0)).rgb * ev; return c / (1.0 + c * 0.8); }

void main() {
  vec2 px = 1.0 / uRes;
  ev = exposure(tLum, uKey, uAe) * (1.0 - uDark) * (1.0 + uFlash * 1.8) * uBias; // uFlash: 불이 팍 켜진 순간 하얗게 날아갔다 돌아옴
  vec3 c = grab(vUv);
  if (uBlur > 0.01) {
    // 줌을 당기면 초점이 잠깐 나갔다 맞아요
    vec3 a = c;
    for (int i = 0; i < 8; i++) { float t = float(i) * 0.785398; a += grab(vUv + vec2(cos(t), sin(t)) * px * uBlur * 2.6); }
    c = a / 9.0;
  }
  if (uSharp > 0.01) {
    // 조준하면 초점이 맞듯 살짝 또렷하게
    vec3 nb = grab(vUv + vec2(px.x, 0.0)) + grab(vUv - vec2(px.x, 0.0)) + grab(vUv + vec2(0.0, px.y)) + grab(vUv - vec2(0.0, px.y));
    c = max(c + (c - nb * 0.25) * uSharp * 0.55, 0.0);
  }
  if (uCold > 0.001) {
    // (11/19 추가) 차가운 맨벽: 색을 70% 빼고 살짝 푸른 회색으로, 40% 어둡게(자동 노출 뒤라 다시 밝아지지 않아요)
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(l) * vec3(0.86, 0.95, 1.12), 0.7 * uCold) * (1.0 - 0.4 * uCold);
  }
  c = mix(c, uFill.rgb, uFill.a); // (11/19 추가) 한 색으로 덮기(빨간 점)
  gl_FragColor = vec4(c, 1.0);
}`;

/** (11/17 추가) 영상 → 렌즈 자리. 영상 그림은 화면 값(sRGB)이라 빛의 세기로 바꿔 넣어요. */
const VIDEO = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tVideo;
void main() { gl_FragColor = vec4(pow(texture2D(tVideo, vUv).rgb, vec3(2.2)), 1.0); }`;

/** ④ 테이프. */
const TAPE = /* glsl */ `
${COMMON}
uniform sampler2D tCam, tOsd, tLum;
uniform vec2 uRes; // 내부 해상도(640×480) — 번짐·줄 떨림은 이 단위로(시험 방과 같게)
uniform float uTime, uVhs, uKey, uLookT, uFailMs, uMenu, uPass, uGlitch, uNight, uGrade;
uniform int uLook; // 0 live 1 play 2 slow 3 pause 4 rew 5 ff 6 fail 7 menu
uniform bool uAe, uRaw;
const vec3 BLUE = vec3(0.00169, 0.0033, 0.4423); // VCR 파란 화면 #0E13B0 (빛의 세기로)

vec3 toYiq(vec3 c) { return vec3(dot(c, vec3(.299, .587, .114)), dot(c, vec3(.596, -.274, -.322)), dot(c, vec3(.211, -.523, .312))); }
vec3 toRgb(vec3 c) { return vec3(c.x + .956 * c.y + .621 * c.z, c.x - .272 * c.y - .647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z); }

// (11/18 추가) 돌려 보는 테이프의 색: 복사를 거듭한 테이프처럼 색이 바래고, 살짝 차갑고(녹화 화면은 따뜻해요), 검정이 뜨고 대비가 낮아요
vec3 tapeColor(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), 0.5 * uGrade);
  c *= mix(vec3(1.0), vec3(0.9, 1.0, 1.06), uGrade);
  return mix(c, c * 0.8 + 0.022, uGrade);
}

// 렌즈 화면에 비네트를 입히고, 파란 화면과 섞고, 그 위에 OSD 글씨를 찍어요(글씨는 테이프 색을 안 입어 또렷하게)
vec3 grab(vec2 uv) {
  uv = clamp(uv, 0.0, 1.0);
  vec2 q = uv - 0.5;
  vec3 c = mix(tapeColor(texture2D(tCam, uv).rgb) * (1.0 - dot(q, q) * 0.55), BLUE, uMenu);
  vec4 o = texture2D(tOsd, uv);
  return mix(c, pow(o.rgb, vec3(2.2)), o.a);
}

// 진짜 지지직(스노우): 줄마다 1~4칸씩 옆으로 끌린 흰·검 알갱이. 칸 = 내부 해상도의 가로 1.5배 × 세로 한 줄
float snow(float f) {
  vec2 g = floor(vUv * uRes * vec2(1.5, 1.0));
  float len = 1.0 + floor(hash(vec2(g.y, f)) * 4.0);
  return hash(vec2(floor(g.x / len) + floor(hash(vec2(g.y, f + 1.0)) * 50.0), g.y + f * 61.0));
}
// 가운데 y, 두께 w인 띠(0~1). 가장자리가 물결쳐요
float bandAt(float y, float c, float w, float t) {
  c += sin(t * 2.3 + c * 9.0) * w * 0.25;
  float d = abs(y - c); d = min(d, 1.0 - d);
  return 1.0 - smoothstep(w * 0.25, w, d);
}

void main() {
  if (uRaw) { gl_FragColor = vec4(pow(clamp(grab(vUv), 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); return; }
  vec2 uv = vUv;
  float px = 1.0 / uRes.x;
  float f30 = floor(uTime * 30.0);
  float vhs = uVhs;
  float fail = uLook == 6 ? clamp(uLookT * 1000.0 / uFailMs, 0.0, 1.0) : 0.0;
  bool search = uLook == 4 || uLook == 5;
  float live = 1.0 - uMenu;

  // 화면이 위아래로 움직임: 씹힘 = 점점 빨리 굴러감
  // (11/18 변경) ~~멈춤 = 두 필드가 번갈아 떨림~~ → 사용자 의견(멈출 때 너무 흔들려 멀미남)으로 뺐어요. 멈춘 화면은 가만히 있어요
  if (fail > 0.0) uv.y = fract(uv.y + fail * fail * fail * 1.6);
  float line = floor(uv.y * uRes.y);

  // 줄마다 좌우로 미세하게 떨림 (시험 방과 같은 세기)
  float jit = (hash(vec2(line, f30)) - 0.5) * px * (0.8 + vhs);
  // 트래킹 띠: 천천히 흐르는 띠 안에서 크게 밀림
  float band = fract(uv.y * 0.9 + uTime * 0.06);
  band = smoothstep(0.0, 0.015, band) * (1.0 - smoothstep(0.03, 0.07, band));
  jit += band * px * (3.0 + 10.0 * vhs) * (hash(vec2(line, f30 + 7.0)) - 0.3);
  // 맨 아래 몇 줄(헤드 스위칭): 줄마다 좌우로 엇갈려 지그재그로 지지직. 아래로 갈수록 세져요
  float hs = (1.0 - smoothstep(0.0, 0.028, vUv.y)) * live;
  float zig = abs(fract(line * 0.5 + floor(uTime * 20.0) * 0.37) * 2.0 - 1.0) * 2.0 - 1.0;
  jit += hs * px * (zig * (2.5 + 3.5 * hash(vec2(line, f30 + 3.0))) + 5.0 * hs);

  // 노이즈 띠: 찾기(◀◀ ▶▶) = 굵은 띠 세 개가 흘러감, 느리게 = 하나가 천천히, 멈춤 = 하나가 거의 제자리
  // (11/18 변경) 멀미가 덜 나게: 되감기 띠는 0.07 → 0.055 굵기, 0.7 → 0.45 빠르기, 찢김 34 → 22칸. 멈춤 띠는 맨 아래 가장자리에 가늘게(찢김 약하게)
  float bar = 0.0;
  if (search) {
    float dir = uLook == 4 ? 1.0 : -1.0;
    for (int i = 0; i < 3; i++) bar = max(bar, bandAt(vUv.y, fract(float(i) / 3.0 + uTime * 0.45 * dir), 0.055, uTime + float(i)));
  } else if (uLook == 2) bar = bandAt(vUv.y, fract(0.85 - uTime * 0.1), 0.05, uTime);
  else if (uLook == 3) bar = bandAt(vUv.y, 0.06, 0.035, uTime * 0.2);
  // 띠 가장자리는 줄마다 들쭉날쭉, 띠 안의 줄은 제각각 옆으로 찢겨요
  float inBar = smoothstep(0.0, 0.35, bar - hash(vec2(line, floor(uTime * 15.0))) * 0.6);
  jit += inBar * px * (uLook == 3 ? 8.0 : 22.0) * (hash(vec2(line, f30 + 11.0)) - 0.5);

  // 테이프 씹힘: 물결치며 휘고, 줄 묶음이 통째로 밀림
  if (fail > 0.0) {
    jit += sin(vUv.y * 22.0 + uTime * 13.0) * px * 24.0 * fail + sin(vUv.y * 5.0 - uTime * 4.0) * 0.05 * fail * fail;
    jit += (hash(vec2(floor(vUv.y * 14.0), f30)) - 0.5) * 0.12 * fail * step(0.55, hash(vec2(floor(vUv.y * 14.0), f30 + 5.0)));
  }
  // 벽을 지나는 중: 줄이 흔들리다 지지직으로 덮여요(가장 짙을 때도 너머가 살짝 비쳐요)
  float pass = smoothstep(0.3, 1.0, uPass) * 0.85;
  jit += pass * px * 18.0 * (hash(vec2(line, f30 + 21.0)) - 0.5);
  // (11/17 추가) 영상 → 3D로 들어올 때(인트로 끝 → 하얀 방): 화면이 가로로 살짝 줄고, 양옆 가장자리가 물결치며,
  // 줄 묶음이 통째로 밀려요(최종 영상 10.5~11.7초의 실사 하얀 방 지지직처럼)
  float gl = uGlitch;
  if (gl > 0.0) {
    float wav = sin(vUv.y * 41.0 + uTime * 11.0) * 0.6 + sin(vUv.y * 13.0 - uTime * 6.0) * 0.4;
    uv.x = (uv.x - 0.5) * (1.0 + 0.07 * gl) + 0.5;
    jit += wav * 0.012 * gl;
    jit += (hash(vec2(floor(vUv.y * 60.0), f30 + 41.0)) - 0.5) * px * 10.0 * gl;
  }
  uv.x += jit;
  float outside = gl > 0.0 ? 1.0 - step(0.0, uv.x) * step(uv.x, 1.0) : 0.0;

  // 밝기는 비교적 또렷하게, 색은 옆으로 번지게 (VHS는 색 해상도가 낮아요)
  vec3 c0 = toYiq(grab(uv));
  float bl = px * (1.0 + 0.8 * uGrade); // (11/18) 돌려 보는 테이프는 조금 더 무르게
  float y = c0.x * 0.5 + toYiq(grab(uv + vec2(bl, 0.0))).x * 0.25 + toYiq(grab(uv - vec2(bl, 0.0))).x * 0.25;
  y += (c0.x - toYiq(grab(uv - vec2(3.0 * px, 0.0))).x) * (0.12 + 0.06 * uGrade); // 가장자리 메아리
  vec2 iq = vec2(0.0);
  float spread = 2.0 + fail * 5.0 + 1.4 * uGrade;
  for (int i = -3; i <= 3; i++) iq += toYiq(grab(uv + vec2((float(i) * spread + 2.5 + fail * 10.0) * px, 0.0))).yz;
  iq /= 7.0;
  float sat = mix(1.08, 1.0, uMenu) * (1.0 - 0.7 * fail) * (search ? 0.7 : 1.0) * (uLook == 3 ? 0.85 : 1.0);
  vec3 col = toRgb(vec3(y, iq * sat));

  // 알갱이 (시험 방과 같은 식). 캠코더가 어두운 곳에서 밝기를 끌어올리면 어두운 부분이 더 자글자글해져요
  float gain = max(0.0, exposure(tLum, uKey, uAe) - 1.0) * live;
  float n = hash(vUv * uRes + fract(uTime) * 91.7);
  col += (n - 0.5) * 0.07 * (0.6 + vhs) * (1.0 + gain * 2.5 * (1.0 - clamp(y * 2.0, 0.0, 1.0))) * (1.0 - 0.75 * uMenu);
  col += (vec3(hash(vUv * uRes + 3.1 + uTime), hash(vUv * uRes + 7.7 + uTime), hash(vUv * uRes + 1.3 + uTime)) - 0.5) * 0.03 * gain;
  // (11/17 추가) 정전: 거의 검은 화면에 굵은 알갱이가 자글자글(캠코더가 어둠 속에서 밝기를 한껏 끌어올린 화면)
  col += (hash(floor(vUv * uRes * 0.75) + fract(uTime * 7.0) * 53.1) - 0.5) * 0.03 * uNight;

  // 노이즈 띠의 지지직: 꽉 찬 띠가 아니라, 길이가 제각각인 가로 긁힘(대부분 흰색, 가끔 검은색)이
  // 찢긴 화면 위에 흩어져 있고, 띠 가운데일수록 촘촘해요(실제 VHS를 빨리 감을 때처럼)
  if (inBar > 0.0) {
    float xs = vUv.x * uRes.x + hash(vec2(line, f30 + 2.0)) * 300.0;
    float seg = 3.0 + floor(hash(vec2(line, f30 + 4.0)) * 28.0); // 긁힘 길이 3~30칸
    float sid = floor(xs / seg);
    float dens = inBar * mix(0.12, 0.7, bar);
    float on = step(1.0 - dens, hash(vec2(sid, line + f30 * 7.0)));
    float b = hash(vec2(sid + 9.0, line + f30 * 3.0));
    vec3 sc = vec3(b > 0.3 ? mix(0.7, 1.0, b) : b * 0.4);
    col = mix(col, col * 0.85 + 0.06, inBar * 0.6); // 띠 안은 화면이 살짝 바래요
    col = mix(col, sc, on * (0.6 + 0.4 * hash(vec2(sid, line))));
  }
  // (11/17 추가) 들어올 때의 지지직: 화면 전체에 길이가 제각각인 가로 긁힘(대부분 밝은 색), 화면 밖으로 밀린 곳은 어두운 띠
  if (gl > 0.0) {
    float xs = vUv.x * uRes.x + hash(vec2(line, f30 + 6.0)) * 400.0;
    float seg = 6.0 + floor(hash(vec2(line, f30 + 8.0)) * 70.0); // 긁힘 길이 6~75칸
    float sid = floor(xs / seg);
    float row = step(1.0 - 0.17 * gl, hash(vec2(line, f30 + 9.0))); // 긁힘이 있는 줄(영상처럼 드문드문)
    float on = step(1.0 - 0.55 * gl, hash(vec2(sid, line + f30 * 5.0))) * row;
    float b = hash(vec2(sid + 3.0, line + f30));
    col = mix(col, vec3(b > 0.25 ? mix(0.75, 1.0, b) : 0.15), on * 0.85);
    col = mix(col, vec3(0.06, 0.06, 0.07), outside);
  }
  // 눈보라(스노우): 벽을 지나는 순간, 씹힘 끝
  float fe = smoothstep(0.72, 0.97, fail);
  if (pass > 0.0 || fe > 0.0) {
    float sn = snow(f30);
    vec3 sc = vec3(mix(0.12, 0.85, smoothstep(0.15, 1.0, sn))); // 어두운 알갱이가 많고 밝은 알갱이가 섞인 지지직
    col = mix(col, sc, pass);
    col = mix(col, sc * 0.35, fe); // 씹힘 끝: 어두운 눈보라 (그 사이에 방이 처음으로 돌아가요)
  }
  if (fail > 0.0) col *= 1.0 + 0.35 * sin(uTime * 47.0) * fail * (1.0 - fe);

  // 뜬 검정, 살짝 따뜻한 색 (파란 화면에서는 빼요)
  col = col * mix(1.0, 0.94, live) + 0.035 * live * (1.0 - 0.65 * uNight); // 정전엔 검정을 덜 띄워 진짜 어둡게
  col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), live);
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

/**
 * ⑤ 화면: 주사선과 약한 인터레이스를 얹어요.
 * (11/18 추가) uMon(0~1) = 테이프를 돌려 볼 때의 작은 모니터: 그림이 줄어들고 볼록한 브라운관 + 둥근 모서리, 둘레는 어두운 테두리.
 */
const SHOW = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tTape;
uniform vec2 uRes;
uniform float uScan, uField, uMon, uScale, uLift;
const vec2 ASP = vec2(4.0 / 3.0, 1.0);
void main() {
  // 화면 자리 → 그림 안 자리(-0.5~0.5). uMon = 0이면 그대로(녹화 화면)
  float s = 1.0 - (1.0 - uScale) * uMon;
  vec2 p = (vUv - vec2(0.5, 0.5 + uLift * uMon)) / s;
  vec2 a = p * ASP;
  p *= 1.0 + 0.075 * uMon * dot(a, a); // 볼록한 브라운관
  // 둥근 모서리 네모까지의 거리(안쪽이 -)
  float r = 0.045 * uMon;
  vec2 q = abs(p * ASP) - (ASP * 0.5 - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  if (uMon > 0.001 && d > 0.0) {
    // 테두리: 어두운 플라스틱, 위가 아주 살짝 밝고, 화면 둘레에 가는 테
    vec3 bz = vec3(0.075, 0.075, 0.082) + 0.03 * vUv.y;
    bz += 0.05 * (1.0 - smoothstep(0.0, 0.01, d));
    gl_FragColor = vec4(mix(vec3(0.0), bz, uMon), 1.0);
    return;
  }
  vec2 uv = p + 0.5;
  vec3 col = texture2D(tTape, uv).rgb;
  float l = uv.y * uRes.y;
  // 주사선(한 줄 걸러 살짝 어둡게 — 시험 방과 같은 세기) + 약한 인터레이스(홀짝 줄이 번갈아 아주 조금 밝아짐)
  col *= 1.0 - uScan + uScan * (0.5 + 0.5 * cos(3.14159265 * l));
  col *= 1.0 + 0.012 * (mod(floor(l) + uField, 2.0) - 0.5);
  // 모니터 화면 가장자리 그늘
  col *= 1.0 - uMon * 0.4 * smoothstep(-0.06, 0.0, d);
  gl_FragColor = vec4(col, 1.0);
}`;

// ── 연결 ─────────────────────────────────────────────

const LOOK_ID: Record<Look, number> = { live: 0, play: 1, slow: 2, pause: 3, rew: 4, ff: 5, fail: 6, menu: 7 };

function target(w: number, h: number, type: THREE.TextureDataType, depth = false, filter: THREE.MagnificationTextureFilter = THREE.LinearFilter) {
  return new THREE.WebGLRenderTarget(w, h, { type, minFilter: filter, magFilter: filter, depthBuffer: depth, generateMipmaps: false });
}

function material(frag: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export class Camcorder {
  /** 3D를 그려 넣는 낮은 해상도 화면. */
  scene!: THREE.WebGLRenderTarget;
  readonly osd: Osd;
  /** 개발용: VHS 효과 끄기(3D 그대로 + OSD). */
  raw = false;
  /** 자동 노출 켜기/끄기. */
  ae = true;
  /** 테이프 씹힘 연출 길이(ms). 논리의 FAIL_MS와 같아야 해요. */
  failMs = 1400;

  private lum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private lens!: THREE.WebGLRenderTarget;
  private tape: THREE.WebGLRenderTarget | null = null;
  private flip = 0;
  private reset = true;
  private quad: THREE.Mesh;
  private stage = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mLum: THREE.ShaderMaterial;
  private mLens: THREE.ShaderMaterial;
  private mTape: THREE.ShaderMaterial;
  private mShow: THREE.ShaderMaterial;
  private mVideo: THREE.ShaderMaterial;
  private warmed = false;
  private size = new THREE.Vector2();
  private res = new THREE.Vector2();

  // 시간에 따라 변하는 값
  private time = 0;
  private look: Look = 'menu';
  private lookT = 0;
  private menu = 1;
  private burst = 0;
  private blur = 0;
  private sharp = 0;
  private lastZoom = 1;
  /** (11/18 추가) 테이프를 돌려 보는 모니터가 된 정도(0 = 녹화 화면, 1 = 모니터). */
  private mon = 0;

  /** (11/18 추가) 지금 테이프 모니터 모습인 정도(0~1). main.ts가 폰에서 누른 자리를 그림 안 자리로 바꿀 때 써요. */
  get monitor(): number { return this.mon; }
  /** (11/19 추가) 모니터 모양(PC 84% / 폰 90%). */
  private shape: Monitor = MONITOR.pc;
  get monitorShape(): Monitor { return this.shape; }
  setMonitor(m: Monitor) {
    this.shape = m;
    this.mShow.uniforms.uScale.value = m.scale;
    this.mShow.uniforms.uLift.value = m.lift;
  }

  constructor(w: number, h: number) {
    this.lum = [target(1, 1, THREE.HalfFloatType, false, THREE.NearestFilter), target(1, 1, THREE.HalfFloatType, false, THREE.NearestFilter)];
    this.osd = new Osd(w, h);
    this.mLum = material(LUM, { tScene: { value: null }, tPrev: { value: null }, uDt: { value: 0 }, uReset: { value: true } });
    this.mLens = material(LENS, {
      tScene: { value: null }, tLum: { value: null }, uRes: { value: this.res },
      uKey: { value: AE_KEY }, uAe: { value: true }, uDark: { value: 0 }, uBlur: { value: 0 }, uSharp: { value: 0 }, uFlash: { value: 0 },
      uCold: { value: 0 }, uFill: { value: new THREE.Vector4() }, uBias: { value: 1 },
    });
    this.mTape = material(TAPE, {
      tCam: { value: null }, tOsd: { value: this.osd.texture }, tLum: { value: null }, uRes: { value: this.res },
      uTime: { value: 0 }, uVhs: { value: 0.35 }, uKey: { value: AE_KEY }, uAe: { value: true }, uRaw: { value: false },
      uLook: { value: 7 }, uLookT: { value: 0 }, uFailMs: { value: this.failMs }, uMenu: { value: 1 }, uPass: { value: 0 },
      uGlitch: { value: 0 }, uNight: { value: 0 }, uGrade: { value: 0 },
    });
    this.mVideo = material(VIDEO, { tVideo: { value: null } });
    this.mShow = material(SHOW, {
      tTape: { value: null }, uRes: { value: this.res }, uScan: { value: 0.03 }, uField: { value: 0 },
      uMon: { value: 0 }, uScale: { value: MONITOR.pc.scale }, uLift: { value: MONITOR.pc.lift },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mShow);
    this.quad.frustumCulled = false;
    this.stage.add(this.quad);
    this.resize(w, h);
  }

  resize(w: number, h: number) {
    this.scene?.dispose();
    this.lens?.dispose();
    this.scene = target(w, h, THREE.HalfFloatType, true); // 밝은 곳(천장등)이 1을 넘어도 담기게
    this.lens = target(w, h, THREE.HalfFloatType);
    this.res.set(w, h);
    this.osd.resize(w, h);
    this.mTape.uniforms.tOsd.value = this.osd.texture;
  }

  /** 방에 막 들어섰을 때: 초점을 한 번 다시 잡아요. */
  refocus(amount = 0.8) { this.blur = Math.max(this.blur, amount); }

  /** (11/17 추가) 어두운 데서 불이 팍 켜진 순간: 하얗게 날아갔다가 0.7초쯤에 걸쳐 돌아와요(캠코더 자동 노출이 늦게 따라감). */
  flash(amount = 1) { this.flashV = Math.max(this.flashV, amount); }
  private flashV = 0;

  /**
   * 개발용: 지금 재고 있는 평균 밝기(AE_KEY를 정할 때 씀)와 자동 노출 배율.
   * GPU에서 한 번 읽어 와서 느려요 — ?dev 표시에서만 써요.
   */
  readExposure(renderer: THREE.WebGLRenderer): { adapted: number; ev: number } {
    const buf = new Uint16Array(4);
    renderer.readRenderTargetPixels(this.lum[this.flip], 0, 0, 1, 1, buf);
    const adapted = THREE.DataUtils.fromHalfFloat(buf[0]);
    const ev = this.ae ? Math.min(1.9, Math.max(0.7, Math.pow(AE_KEY / Math.max(adapted, 1e-4), 0.65))) : 1;
    return { adapted, ev };
  }

  private pass(renderer: THREE.WebGLRenderer, m: THREE.ShaderMaterial, out: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    renderer.setRenderTarget(out);
    renderer.render(this.stage, this.cam);
  }

  /** ④를 그릴 크기: 창 크기, 단 내부 해상도의 TAPE_MAX배까지. */
  private tapeTarget(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.min(this.size.x, this.res.x * TAPE_MAX));
    const h = Math.max(1, Math.min(this.size.y, this.res.y * TAPE_MAX));
    if (!this.tape || this.tape.width !== w || this.tape.height !== h) {
      this.tape?.dispose();
      this.tape = target(w, h, THREE.UnsignedByteType);
    }
    return this.tape;
  }

  /** scene에 3D가 그려진 뒤에 불러요. */
  render(renderer: THREE.WebGLRenderer, f: ScreenFrame) {
    const dt = f.dt;
    this.time += dt;

    // 분위기가 바뀌는 순간: 트래킹이 흐트러졌다 다시 잡혀요
    if (f.look !== this.look) {
      if (this.look === 'menu' || f.look === 'menu' || this.look === 'fail') this.burst = Math.max(this.burst, 0.55);
      else this.burst = Math.max(this.burst, 0.35);
      if (this.look === 'fail') this.refocus(0.7);
      this.look = f.look;
      this.lookT = 0;
    } else this.lookT += dt;
    this.burst = Math.max(0, this.burst - dt * 1.4);
    // 파란 화면은 금방 덮이고(0.12초), 걷어질 때는 바로 걷혀요(대신 트래킹 노이즈)
    this.menu = f.look === 'menu' ? Math.min(1, this.menu + dt / 0.12) : 0;
    // (11/18 추가) 테이프를 돌려 볼 때: 그림이 모니터 안으로 0.25초쯤에 줄어들고, 나올 때 0.2초쯤에 다시 펼쳐져요
    const tapeLook = f.look === 'play' || f.look === 'slow' || f.look === 'pause' || f.look === 'rew' || f.look === 'ff';
    this.mon = tapeLook ? Math.min(1, this.mon + dt / 0.25) : Math.max(0, this.mon - dt / 0.2);

    // 초점: 줌을 움직이는 동안 흐려지고, 멈추면 0.3초쯤 뒤 맞아요
    const zs = dt > 0 ? Math.abs(f.zoom - this.lastZoom) / dt : 0;
    this.lastZoom = f.zoom;
    const want = Math.min(1, zs * 0.7);
    this.blur += (want - this.blur) * Math.min(1, dt * (want > this.blur ? 12 : 3.5));
    this.sharp += ((f.aim ? 1 : 0) - this.sharp) * Math.min(1, dt * 6);

    this.osd.update(f.osd, this.time, dt);

    let u: Record<string, THREE.IUniform>;
    let lumNow = this.lum[this.flip];
    if (!this.warmed) {
      // (11/17 추가) 영상용 그림 프로그램을 시작 화면에서 미리 만들어 둬요(인트로가 시작되는 순간 멈칫하지 않게)
      this.warmed = true;
      const dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      dummy.needsUpdate = true;
      this.mVideo.uniforms.tVideo.value = dummy;
      this.pass(renderer, this.mVideo, this.lens);
    }
    if (f.video) {
      // 영상: 렌즈 자리에 영상을 그대로. 3D로 돌아오면 자동 노출을 새로 재요
      this.mVideo.uniforms.tVideo.value = f.video;
      this.pass(renderer, this.mVideo, this.lens);
      this.reset = true;
    } else {
      const lumPrev = lumNow;
      this.flip ^= 1;
      lumNow = this.lum[this.flip];

      // ② 밝기 재기
      u = this.mLum.uniforms;
      u.tScene.value = this.scene.texture;
      u.tPrev.value = lumPrev.texture;
      u.uDt.value = dt;
      u.uReset.value = this.reset;
      this.pass(renderer, this.mLum, lumNow);
      this.reset = false;

      // ③ 렌즈
      u = this.mLens.uniforms;
      u.tScene.value = this.scene.texture;
      u.tLum.value = lumNow.texture;
      u.uAe.value = this.ae;
      u.uDark.value = f.dark;
      u.uBlur.value = this.raw ? 0 : this.blur;
      u.uSharp.value = this.raw ? 0 : this.sharp;
      u.uFlash.value = this.flashV;
      u.uCold.value = f.cold ?? 0;
      u.uBias.value = f.bias ?? 1;
      (u.uFill.value as THREE.Vector4).fromArray(f.fill ?? [0, 0, 0, 0]);
      this.pass(renderer, this.mLens, this.lens);
    }

    // ④ 테이프
    const tape = this.tapeTarget(renderer);
    u = this.mTape.uniforms;
    u.tCam.value = this.lens.texture;
    u.tLum.value = lumNow.texture;
    u.uTime.value = this.time;
    // 파란 화면은 VCR이 만든 화면이라 노이즈가 거의 없어요
    u.uVhs.value = f.look === 'menu' ? 0.1 : Math.min(1, f.vhs + this.burst);
    u.uAe.value = this.ae && !f.video; // 영상엔 자동 노출의 자글자글함을 안 얹어요
    u.uRaw.value = this.raw;
    u.uLook.value = LOOK_ID[f.look];
    u.uLookT.value = this.lookT;
    u.uFailMs.value = this.failMs;
    u.uMenu.value = this.menu;
    u.uPass.value = f.pass;
    u.uGlitch.value = this.raw ? 0 : (f.glitch ?? 0);
    u.uNight.value = this.raw ? 0 : (f.night ?? 0);
    const monK = this.mon * this.mon * (3 - 2 * this.mon);
    // (11/19 변경) 테이프에 끼어든 실사 영상(옛 녹화)은 색을 덜 바래게 — 손바닥 색(라일락·민트·핑크·머스터드)을 구분해 읽어야 해서
    u.uGrade.value = this.raw ? 0 : monK * (f.video ? 0.3 : 1);
    this.flashV = Math.max(0, this.flashV - dt * 1.4);
    this.pass(renderer, this.mTape, tape);

    // ⑤ 화면
    u = this.mShow.uniforms;
    u.tTape.value = tape.texture;
    // 창이 작아서 한 줄이 1.5픽셀도 안 되면 주사선이 물결무늬로 깨져요 → 그럴 땐 약하게
    const ratio = this.size.y / this.res.y;
    u.uScan.value = this.raw ? 0 : 0.06 * Math.max(0, Math.min(1, ratio - 1.2));
    u.uField.value = Math.floor(this.time * 30) % 2;
    u.uMon.value = monK;
    this.pass(renderer, this.mShow, null);
  }
}
