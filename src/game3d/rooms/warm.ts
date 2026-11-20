import type { Action, Box, Cond, Face, KeyBunch, LiveLamp, Prop, Room, Target, V3, Zone } from '../schema.ts';
import { TAPE_HINT } from './common.ts';
import { redDotAt } from '../keys.ts';

/**
 * (11/19 추가) 빨간 점 → 갈색 문 → 따뜻한 방 → 옛 녹화 → 어두운 맨벽 → 창밖 (최종 영상 41~71초) — 5단계.
 * 퍼즐은 사용자 설계서 docs/puzzles/WARM_ROOM.md 그대로, 평면도와 흐름은 TECH_DESIGN 13장.
 *
 * 흐름
 *   포스트잇의 방에서 뒤집은 종이의 빨간 점에 줌 → 화면이 빨갛게 차올라 갈색으로 식으며 이 방의 "문 앞 공간"에 서요(한 방향, 사용자 결정).
 *   갈색 문 손잡이를 누르고 있으면 삐걱 열리고(열린 채로, 사용자 결정) 햇살 가득한 따뜻한 방 + 음악(Dreamy Flashback) + 위쪽 안내 "파란 손바닥에 손 대기".
 *   코발트 손자국을 누르면 벽 너머 웃음소리와 함께 옛 녹화 4개(실사 영상)가 순식간에 지나가고, 바로 뒤 위쪽 문구 + 되감기 안내.
 *   ◀◀로 옛 녹화를 멈춰 읽고(왼쪽 아래 3글자 메모, 오른쪽 아래 "연도. 월 - [색깔 동그라미]") 방의 색깔별 손자국 수를 세어 빼면 → W E R E.
 *   벽의 "we were here" 중 were를 누르면: 강한 지지직, 음악·웃음이 늘어지며 멈춤, 햇살·손자국·글씨가 사라지고 창밖은 암흑,
 *   차갑고 어두운 맨벽 + 형광등 험 → 나가는 문이 열려요 → 창밖 복도(창살 너머 완전한 암흑, 완전한 무음). 어두운 방과 복도는 오갈 수 있어요(사용자 결정).
 *   틀린 손자국·we·here(·옛 녹화 전의 were): 화면이 살짝 지지직 + 지지직 소리 + 음악·웃음이 잠깐 끊김.
 *   복도 끝의 문은 6단계(잠긴 문)에서 이어 지어요(지금은 그냥 닫힌 문).
 *
 * (11/19 2차 변경, 사용자 의견) 벽이 군데군데 뚫려 보이던 것 고침 — 방 짓기는 "벽 면의 한가운데가 방 안에 있을 때만" 그 면을 만들어서,
 *   두 공간에 걸친 긴 벽 상자는 한쪽 면이 안 생겼어요(문 앞 공간의 문 양옆, 복도의 문 옆, 나가는 문 오른쪽). 이제 벽 조각을 공간마다 따로 놓아요.
 *   → 새 방을 지을 때도 벽 상자 하나가 두 공간을 걸치지 않게(TECH_DESIGN 13-5).
 * (11/19 2차 변경) 창 없이 벽에 붙이던 햇살 무늬 → 왼쪽 벽에 진짜 창, 거기서 들어온 햇살이 앞벽·바닥에 창 모양으로(Room.sun).
 *   손자국 15개만 띄엄띄엄 → 퍼즐 색이 아닌 손자국(검정·갈색·크림)을 더해 영화처럼 빽빽하게. 글씨는 작게, 코발트는 글씨 바로 위.
 *
 *                 x=0.4                                       x=6.7
 *         z=-2.7    ┌──── ▦창(암흑) ─────────── ▦창(암흑) ─────────┐
 *                   │              창밖 복도 (완전한 무음)        ▮│ ← 잠긴 문(6단계)
 *         z=-1.4 ┌──┴───────┬┄┄┄┄┬────────────────────────────────┘
 *                │ ✋        │ 문 │ ☀☀ ← 햇살이 앞벽 오른쪽·바닥에   (풀면 방 쪽으로 열림, 오갈 수 있음)
 *                │   ✋(파랑)                        │
 *          창 ▦▦ │   we were here    ✋  ✋           │  ✋ 손자국 약 70개(퍼즐 15 + 다른 색)
 *    (햇빛 ↘)  ▦▦ │ 따뜻한 방 4.4 × 4.2m               │
 *                │ ✋        ✋              ✋       │
 *          z=3.0 └──────────┐ 갈색 ┌───────────────┘
 *                           │ 문   │ ← 손잡이 누르고 있기 → 열림(열린 채로)
 *          z=4.8            │ ● 시작│  문 앞 공간 1.4 × 1.6m(어둑함)
 *                           └──────┘
 *               x=-2.2                      x=2.2
 */

const H = 2.6;

// 따뜻한 방 안쪽 면
const FRONT = -1.2, LEFT = -2.2, RIGHT = 2.2, BACK = 3.0;
const E = 0.012; // 벽에서 띄우는 거리(그림이 벽과 깜빡이지 않게)
/** 왼쪽 벽의 창(햇빛이 들어오는 곳): z 0.6~2.0, 높이 0.85~2.15 */
const WIN = { z0: 0.6, z1: 2.0, y0: 0.85, y1: 2.15 };

/**
 * 설계서의 다섯 색(#3A5BA0 코발트 · #7FD1B9 민트 · #E0A526 머스터드 · #B69CE0 라일락 · #E86A9E 핑크)을
 * 화면에서 또렷하게 읽히게 조금 진하게 칠해요(사용자 의견: 보라·노랑·초록이 흐려서 완성도가 낮아 보임). 빛은 밝기만 받아요(lit: 'mono').
 */
// (11/19 3차 변경, 사용자 의견: 어둡게가 아니라 채도를 높여 밝고 또렷하게) ~~진하게(어둡게)~~ → 밝고 채도 높은 색.
// 섞인 색이 거의 없는 순한 색(빨강·초록·파랑 중 하나가 0에 가까움)이라 캠코더의 밝은 부분 눌림에도 파스텔로 바래지 않아요.
// 라일락은 설계서의 색이라 보라 그대로(더 선명한 보라)
// (11/19 4차 변경, 사용자 의견: 같은 노랑이 그늘에선 겨자색, 햇살 속 검정은 노래 보여 헷갈림)
//   → 손자국은 구운 빛·햇살을 전혀 안 받고(lit: false) 어디서 봐도 같은 색. 노랑은 캠코더의 밝은 부분 눌림에 주황으로 기울지 않게 조금 더 노랗게
// (11/19 4차) 노랑은 밝은 베이지 벽에 묻혀서 옛 녹화의 머스터드 동그라미와 같은 진한 황금빛으로. 옛 녹화 동그라미도 이 다섯 색과 똑같이 맞췄어요
const C = { cobalt: '#1e6bff', mint: '#14e07e', mustard: '#f2ac00', lilac: '#a64dff', pink: '#ff2e96' } as const;
/**
 * (11/19 2차 추가) 퍼즐과 상관없는 손자국 색 — 다섯 색과 헷갈리지 않는 색만.
 * (11/19 4차 변경) ~~검정·갈색·크림~~ → 색기가 전혀 없는 검정·회색·흰색(갈색은 어두운 겨자색, 크림은 노랑과 헷갈릴 수 있어서)
 */
const OTHER = ['#262423', '#8a8a8a', '#ececec'] as const;
type Color = keyof typeof C;

const NOT_SOLVED: Cond = { not: { flag: 'warm.solved' } };
const PLAYED: Cond = { flag: 'warm.played' };

/** (11/19 2차 추가) 문을 열면 바로 보이는 안내(첫 손자국은 퀴즈가 아니라서 — 사용자 의견). 개조식 */
const G0 = '파란 손바닥에 손 대기';
/** 코발트 손자국 뒤 문구와, 1분 뒤 그 자리를 바꾸는 문구 — 설계서 확정안. (11/19 2차 변경) 아래에 더하지 않고 바꿔요 */
const G1 = '기쁨은 붙잡을 새도 없이 엉킨 채 스쳐 지나간다.';
const G2 = '벽에 남은 색의 무게를 덜어내면, 엉켜 있던 해가 제자리를 찾는다.';
/** (11/21 8단계 ③ 추가, 사용자 결정) G2 아래 한 줄 더 — 정답은 글자 하나(were)라는 힌트 */
const G3 = '모든 글자가 모여도, 진실이 되는 것은 단 하나뿐.';

/**
 * 틀림(설계서 4.2: 문구 없음). (11/19 2차 변경, 사용자 의견: 음악만 끊기면 오류 같음)
 * 화면이 살짝 찢어지듯 지지직 + 짧은 지지직 소리 + 음악·웃음소리가 잠깐 뚝.
 */
const WRONG: Action[] = [{ do: 'noise', level: 0.55, ms: 280 }, { do: 'sound', sound: 'sfx.wrong' }, { do: 'hush', ms: 650 }];

const wall = (id: string, x0: number, x1: number, z0: number, z1: number, mat: Box['mat'], y0 = 0, y1 = H, solid = true): Box => ({
  id, at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], mat, ...(solid ? {} : { solid: false }),
});

// ── 공간 — 벽 조각은 공간마다 따로(한 상자가 두 공간에 걸치면 한쪽 면이 안 생겨요) ──
const boxes: Box[] = [
  // 바닥·천장(따뜻한 방 / 문 앞 공간 / 복도)
  wall('floor', -2.4, 2.4, -1.4, 3.2, 'carpet', -0.2, 0),
  wall('ceil', -2.4, 2.4, -1.4, 3.2, 'white', H, H + 0.2),
  wall('v-floor', -0.8, 0.8, 3.2, 4.9, 'carpet', -0.2, 0),
  wall('v-ceil', -0.8, 0.8, 3.2, 4.9, 'white', H, H + 0.2),
  // (11/19 6단계 2차 변경) 문 앞(x 5.0~6.6)은 무늬 적은 회색 바닥 — 쏟아진 은색 열쇠가 또렷하게(점박이·카펫엔 묻혀서, 시험 방에서 확인)
  wall('h-floor', 0.3, 5.0, -2.9, -1.4, 'carpet', -0.2, 0),
  wall('h-floor-door', 5.0, 6.6, -2.9, -1.4, 'gray', -0.2, 0),
  wall('h-ceil', 0.3, 6.6, -2.9, -1.4, 'white', H, H + 0.2),

  // 따뜻한 방 왼쪽 벽: 창 구멍을 남기고 네 조각 + 창틀(십자 창살·창턱)
  wall('wl-a', -2.4, LEFT, -1.4, WIN.z0, 'beige'),
  wall('wl-b', -2.4, LEFT, WIN.z1, 3.2, 'beige'),
  wall('wl-low', -2.4, LEFT, WIN.z0, WIN.z1, 'beige', 0, WIN.y0),
  wall('wl-top', -2.4, LEFT, WIN.z0, WIN.z1, 'beige', WIN.y1, H),
  wall('win-v', -2.33, -2.27, 1.275, 1.325, 'white', WIN.y0, WIN.y1, false),
  wall('win-h', -2.33, -2.27, WIN.z0, WIN.z1, 'white', 1.475, 1.525, false),
  wall('win-sill', -2.25, -2.13, WIN.z0 - 0.06, WIN.z1 + 0.06, 'white', WIN.y0 - 0.03, WIN.y0, false),
  // 오른쪽 벽
  wall('wr', RIGHT, 2.4, -1.4, 3.2, 'beige'),
  // 앞벽: 방 쪽(z -1.35~-1.2)과 복도 쪽(-1.4~-1.35)을 따로. 나가는 문 자리 x 1.05~1.95
  wall('wf-a', -2.4, 1.05, -1.35, FRONT, 'beige'),
  wall('wf-b', 1.95, 2.4, -1.35, FRONT, 'beige'),
  wall('wf-top', 1.05, 1.95, -1.4, FRONT, 'beige', 2.05, H),
  wall('hf-a', 0.3, 1.05, -1.4, -1.35, 'gray'),
  wall('hf-b', 1.95, 6.8, -1.4, -1.35, 'gray'),
  // 뒤쪽 벽: 방 쪽(3.0~3.15)과 문 앞 공간 쪽(3.15~3.2)을 따로. 갈색 문 자리 x -0.45~0.45
  wall('wb-a', -2.4, -0.45, BACK, 3.15, 'beige'),
  wall('wb-b', 0.45, 2.4, BACK, 3.15, 'beige'),
  wall('vb-a', -0.8, -0.45, 3.15, 3.2, 'beige'),
  wall('vb-b', 0.45, 0.8, 3.15, 3.2, 'beige'),
  wall('wb-top', -0.45, 0.45, BACK, 3.2, 'beige', 2.05, H),

  // 문 앞 공간(어둑한 베이지)
  wall('v-left', -0.8, -0.7, 3.2, 4.9, 'beige'),
  wall('v-right', 0.7, 0.8, 3.2, 4.9, 'beige'),
  wall('v-back', -0.8, 0.8, 4.8, 4.9, 'beige'),

  // 창밖 복도(어두운 회색). 끝 벽 두 개
  // (11/19 6단계 2차 변경, 사용자 의견) 서쪽 끝 벽은 추격이 시작되면 사라지고(parts의 hall-end) 그 너머로 보기에만 있는 끝없는 복도(live.far).
  //   그 자리엔 보이지 않는 벽만 남아 지금 복도까지만 걸을 수 있어요
  { id: 'hall-end-ghost', at: [0.4, H / 2, -2.15], size: [0.2, H, 1.5], mat: 'gray', ghost: true },
  // 동쪽 끝 벽: 잠긴 문 구멍(z -2.49~-1.61, 높이 2.05)을 남기고 세 조각 — 문 너머는 계단실 입구(현관)
  wall('h-end-a', 6.6, 6.8, -2.9, -2.49, 'gray'),
  wall('h-end-b', 6.6, 6.8, -1.61, -1.4, 'gray'),
  wall('h-end-top', 6.6, 6.8, -2.49, -1.61, 'gray', 2.05, H),
  // 먼 벽: 창 두 개(x 1.05~1.95, 3.85~4.75 / 높이 0.95~2.0)가 뚫린 벽 — 창 너머엔 아무것도 없어요(완전한 암흑)
  wall('h-far-low', 0.3, 6.8, -2.9, -2.7, 'gray', 0, 0.95),
  wall('h-far-top', 0.3, 6.8, -2.9, -2.7, 'gray', 2.0, H),
  wall('h-far-a', 0.3, 1.05, -2.9, -2.7, 'gray', 0.95, 2.0),
  wall('h-far-b', 1.95, 3.85, -2.9, -2.7, 'gray', 0.95, 2.0),
  wall('h-far-c', 4.75, 6.8, -2.9, -2.7, 'gray', 0.95, 2.0),
  ...[1.5, 4.3].flatMap((cx, w) => bars(`win${w}`, cx)),

  // (11/19 6단계 2차 추가) 잠긴 문 너머 계단실 입구(현관): 빨간 점 열쇠로 문을 열면 뛰어들어 돌아서서 쾅 — 계단 방(stairs.ts)의 시작 칸과 같은 모습.
  // 올리브색 벽, 테라초 바닥, 위로 올라가는 계단 첫머리(영상 01:31~)
  wall('vt-floor', 6.6, 9.0, -2.9, -1.2, 'terrazzo', -0.2, 0),
  wall('vt-ceil', 6.6, 9.0, -2.9, -1.2, 'white', H + 0.6, H + 0.8),
  wall('vt-l', 6.8, 9.0, -2.9, -2.7, 'olive', 0, H + 0.6),
  wall('vt-r', 6.8, 9.0, -1.4, -1.2, 'olive', 0, H + 0.6),
  wall('vt-end', 8.8, 9.0, -2.7, -1.4, 'olive', 0, H + 0.6),
  wall('vt-over', 6.6, 6.8, -2.9, -1.2, 'olive', H, H + 0.6), // 문 위로 높아진 계단실 천장까지
  // 계단 첫머리(상자끼리 겹치면 가려진 면이 안 생겨서 칸마다 따로)
  ...[0, 1, 2].map((i) => wall(`vt-step${i}`, 7.95 + i * 0.3, i < 2 ? 8.25 + i * 0.3 : 8.8, -2.7, -1.4, 'terrazzo', 0, 0.17 * (i + 1))),
];

// ── (11/19 6단계 추가) 잠긴 문 추격 — 사용자 설계서 docs/puzzles/LOCKED_DOOR.md, 흐름·정한 것은 TECH_DESIGN 14장 ──
const HZ = -2.05; // 창밖 복도 가운데 z
const CHASE: Cond = { flag: 'lock.chase' };
const DONE: Cond = { flag: 'lock.done' };
const RUNNING: Cond = { all: [CHASE, { not: DONE }] };
const FAR_N = 12; // 끝없는 복도의 등(4m마다, 먼 쪽부터 켜짐)
const FAR_X = (k: number) => 0.3 - 4 * (k + 0.5); // k번째 먼 등의 x(0 = 가까운 쪽)
const NEAR_X = [1.0, 2.1, 3.2, 4.3, 5.4]; // 걸을 수 있는 복도의 등 ①~⑤
const lit = (n: number): Cond => ({ count: 'lights', gte: n });
const only = (name: string, n: number): Cond => ({ all: [{ count: name, gte: n }, { not: { count: name, gte: n + 1 } }] });
const near = (i: number) => lit(FAR_N + i); // ①~⑤가 켜짐
const FAR_END: V3 = [FAR_X(FAR_N - 1), 1.3, HZ];

/** 손잡이에 걸린 열쇠 꾸러미(3D) — 셋째 시도에 바닥으로 쏟아짐. 빨간 점은 ②가 켜져야(등 뒤 빛이 바닥까지) 빨갛게 */
const BUNCH: KeyBunch = {
  id: 'bunch', knob: [6.48, 1.0, -1.74], face: 'x-', floor: [6.28, 0, -1.86], keys: 9, seed: 11,
  fall: { count: 'lock.try', gte: 3 }, spread: 'lock.spread', redOn: near(2), use: { flag: 'lock.used' },
};
const RED_AT = redDotAt(BUNCH);
const PILE_AT: V3 = [BUNCH.floor[0], 0.008, BUNCH.floor[2]];

/** 불이 한 칸 다가올 때(타이머·틀린 열쇠): 그 등 자리에서 형광등 켜지는 소리 + 쿵(먼 불은 세 칸마다) — 입체 음향 */
const STEP_FX: Action[] = Array.from({ length: FAR_N + 5 }, (_, j): Action => {
  const n = j + 1;
  const x = n <= FAR_N ? FAR_X(FAR_N - n) : NEAR_X[n - FAR_N - 1];
  const at: V3 = [x, 1.3, HZ];
  const thud = n > FAR_N || n % 3 === 1;
  return { do: 'if', when: only('lights', n), then: [{ do: 'sound', sound: 'sfx.lightson', at }, ...(thud ? [{ do: 'sound', sound: 'sfx.thud', at } as Action] : [])] };
});

/** 추격 시작(둘째 시도, 다시 할 땐 바로): 형광등 탁 → 끝없는 복도가 열리고 → 저 멀리서 쿵 + 경고음 → 불이 다가오기 시작 */
const CHASE_START: Action[] = [
  { do: 'set', flag: 'lock.chase' },
  { do: 'sound', sound: 'sfx.lightsout' },
  { do: 'wait', ms: 450 },
  { do: 'sound', sound: 'sfx.thud', at: FAR_END },
  { do: 'sound', sound: 'sfx.alarm' },
  { do: 'timer', timer: 'chase' },
];

/** 줌을 덜 당기고 열쇠를 눌렀을 때(사용자 의견: 아무 일이 안 일어나 당황) — 조작 안내는 개조식 */
const ZOOM_HINT: Action[] = [{ do: 'hint', text: '휠 줌 인 · 열쇠 고르기', touch: '왼쪽 아래 막대 줌 인 · 열쇠 고르기' }];
/** 틀린 열쇠: 자물쇠가 걸리는 소리 + 불이 한 칸 다가옴(설계서 2장) */
const WRONG_KEY: Action[] = [
  { do: 'stat', key: 'keysTried' },
  { do: 'sound', sound: 'sfx.try2' },
  { do: 'noise', level: 0.35 },
  { do: 'add', count: 'lights' },
  ...STEP_FX,
];

/**
 * 빨간 점 열쇠(불빛이 바닥까지 온 뒤 줌 + 누르기): ~~안내음성 →~~ 딸깍 → 문이 열리고 뛰어들어 돌아서서 쾅! 정적 뒤 계단으로(한 방향 — 사용자 결정).
 * (11/20 변경, 사용자 의견: 열쇠를 고르면 안내음성 없이 바로 문이 열리고 탈출) ~~"Only your own key will open the door." → 딸깍 →
 *   "Please do not lo—"(쾅에 잘림)~~ — 안내음성 둘 다 뺌(소리 파일은 남겨 둬요). 열쇠가 손잡이로 날아가 꽂히는 0.6초만 기다려요
 */
const UNLOCK: Action[] = [
  { do: 'timer', timer: 'chase', stop: true },
  { do: 'set', flag: 'lock.done' },
  { do: 'stat', key: 'keysTried' },
  { do: 'sound', sound: 'sfx.redkey' },
  { do: 'set', flag: 'lock.used' }, // 빨간 점 열쇠가 손잡이로 날아가 꽂힘(keys.ts 0.6초)
  // (11/20 4차 변경, 사용자 의견: 문이 너무 빨리 열렸다 닫힘 → 열쇠를 찾은 뒤 동작들을 조금 더 느리게) 약 1.6배 — 열쇠 뒤 쾅까지 2.1초 → 약 3.4초
  { do: 'wait', ms: 900 }, // ~~650~~ 꽂히고 한 박자
  { do: 'sound', sound: 'sfx.unlock' },
  { do: 'wait', ms: 400 }, // ~~150~~ 열쇠가 돌아가고
  { do: 'sound', sound: 'sfx.dooropen' },
  { do: 'set', flag: 'lock.open' }, // 문이 열리는 데 ~~0.45~~ 0.8초(아래 lock-door의 ms)
  { do: 'wait', ms: 350 }, // ~~150~~
  { do: 'walk', spawn: 'vest-in', ms: 850 }, // ~~550~~
  { do: 'walk', spawn: 'vest-turn', ms: 700 }, // ~~450~~
  { do: 'set', flag: 'lock.shut' }, // 쾅 닫힘(~~0.14~~ 0.2초)
  { do: 'wait', ms: 190 }, // ~~130~~ 닫히는 끝에 맞춰 쾅
  { do: 'stop', sound: 'sfx.alarm' },
  { do: 'sound', sound: 'sfx.slam' },
  { do: 'sound', sound: 'sfx.slamboom' },
  { do: 'noise', level: 0.8, ms: 160 },
  { do: 'light', fx: 'off' },
  { do: 'wait', ms: 1300 }, // 완전한 정적
  { do: 'room', room: 'stairs', via: 'cut' },
];

/** 실패해서 다시 시작(사용자 의견: 손잡이를 다시 누르지 않고 바로 경고음부터 — 열쇠는 이미 바닥에) */
const RESTART: Action[] = [
  { do: 'add', count: 'lock.try', set: 3 },
  { do: 'add', count: 'lock.spread', set: 0 },
  { do: 'add', count: 'lights', set: 0 },
  { do: 'set', flag: 'lock.chase' },
  { do: 'sound', sound: 'sfx.alarm' },
  { do: 'sound', sound: 'sfx.thud', at: FAR_END },
  // 두 번 넘게 실패했을 때만 보험 힌트(설계서 3.1)
  { do: 'if', when: { count: 'fails.lockdoor', gte: 2 }, then: [{ do: 'hint', text: '빛은 너를 돕지만, 오래 바라보는 순간 너를 배신할 것이다.' }] }, // (11/21 8단계 ③ 변경, 사용자 결정) ~~빛을 마주해야 해답이 보인다.~~ — 빛만 보다 문을 잊어서
  { do: 'timer', timer: 'chase' },
];

const LIVE_LAMPS: LiveLamp[] = [
  // 추격 전: 복도 등(전엔 구운 등이었어요)과 문 위 등 — 둘째 시도에 탁 꺼져요
  { id: 'hall', at: [3.6, H - 0.02, HZ], size: [1.1, 0.16], power: 1.7, color: '#e6eeff', when: { not: CHASE } },
  { id: 'door', at: [6.05, H - 0.02, HZ], size: [0.45, 0.14], power: 0.9, color: '#e6eeff', when: { not: CHASE } },
  // 다가오는 불 ①~⑤(내 그림자를 드리움)
  ...NEAR_X.map((x, i): LiveLamp => ({ id: `c${i + 1}`, at: [x, H - 0.02, HZ], size: [0.9, 0.14], power: 4.5, color: '#eef3ff', when: near(i + 1), shadow: true })),
];

/** 불빛이 지나간 자리에 서 있으면 잡힘 → 테이프 씹힘 → 문 앞부터. ⑤가 켜지면 문 앞까지. 따뜻한 방으로 도망가도 ①부터 잡힘 */
const CAUGHT: Zone[] = [
  ...NEAR_X.map((x, i): Zone => {
    const x0 = x - 0.5, x1 = i < 4 ? NEAR_X[i + 1] - 0.5 : 6.6;
    return { id: `caught${i + 1}`, at: [(x0 + x1) / 2, 1, HZ], size: [x1 - x0, 2, 1.3], when: near(i + 1), enter: [{ do: 'fail' }] };
  }),
  { id: 'caught-room', at: [0, 1, 0.9], size: [4.4, 2, 4.2], when: { all: [RUNNING, near(1)] }, enter: [{ do: 'fail' }] },
  { id: 'caught-front', at: [0, 1, 4.0], size: [1.4, 2, 1.6], when: { all: [RUNNING, near(1)] }, enter: [{ do: 'fail' }] },
];

/** 방범창살: 세로 6개 + 가로 2개 + 창턱. 빛은 안 가려요(solid: false — 가늘어서). */
function bars(id: string, cx: number): Box[] {
  const z = -2.705, out: Box[] = [];
  for (let i = 0; i < 6; i++) out.push({ id: `${id}-v${i}`, at: [cx - 0.375 + i * 0.15, 1.475, z], size: [0.022, 1.05, 0.022], mat: 'metal', solid: false });
  for (const y of [1.18, 1.78]) out.push({ id: `${id}-h${y}`, at: [cx, y, z], size: [0.9, 0.022, 0.022], mat: 'metal', solid: false });
  out.push({ id: `${id}-sill`, at: [cx, 0.94, -2.69], size: [1.0, 0.03, 0.08], mat: 'metal', solid: false });
  return out;
}

// ── "we were here" — 글씨 그림 하나 + 낱말마다 조준 대상(설계서 3.2). (11/19 2차 변경) 0.9m → 0.56m(사용자: 너무 큼) ──
const TEXT_AT: V3 = [-1.0, 1.33, FRONT + E];
const TEXT_W = 0.56;
const TEXT_H = TEXT_W * (100 / 512);

// ── 손자국 ──
type WallName = 'front' | 'left' | 'right' | 'back';
const HAND_SIZE: [number, number] = [0.25, 0.3]; // (11/19 4차) 23 → 25cm(멀리서도 색이 보이게)

/** 벽 위 자리(앞·뒤 벽은 x, 옆벽은 z)와 높이 → 세상 좌표·면. */
function onWall(w: WallName, u: number, y: number): { at: V3; face: Face } {
  if (w === 'front') return { at: [u, y, FRONT + E], face: 'z+' };
  if (w === 'back') return { at: [u, y, BACK - E], face: 'z-' };
  if (w === 'left') return { at: [LEFT + E, y, u], face: 'x+' };
  return { at: [RIGHT - E, y, u], face: 'x-' };
}

/**
 * 퍼즐 손자국 15개(설계서 3.1: 코발트 1 · 민트 2 · 머스터드 3 · 라일락 4 · 핑크 5). [색, 벽, 가로 자리, 높이, 기울기, 좌우 뒤집기]
 * 앞벽 오른쪽 아래는 햇살이 비치는 자리라 퍼즐 색은 두지 않아요(주황 햇살에 물들면 색을 헷갈려서).
 */
const PUZZLE: [Color, WallName, number, number, number, boolean?][] = [
  ['cobalt', 'front', -1.0, 1.6, -6], // "we were here" 바로 위(사용자 의견)
  ['pink', 'front', -1.85, 1.95, 18, true],
  ['pink', 'front', 0.55, 2.08, -22],
  ['pink', 'left', -0.4, 1.85, -18, true],
  ['pink', 'right', 0.3, 1.25, -12],
  ['pink', 'back', -1.5, 1.5, 10],
  ['lilac', 'front', -1.6, 0.95, 10],
  ['lilac', 'left', 2.55, 1.2, -6, true],
  ['lilac', 'right', 1.6, 1.9, 16, true],
  ['lilac', 'back', 1.3, 1.05, -14],
  ['mint', 'front', -0.35, 1.95, -14, true],
  ['mint', 'right', 2.5, 1.0, 12],
  ['mustard', 'left', -0.9, 1.0, 8],
  ['mustard', 'right', -0.6, 1.75, -20, true],
  ['mustard', 'back', 1.9, 1.85, 20],
];

/** 손자국을 붙일 수 있는 벽 구역 [벽, 가로 범위, 높이 범위] — 창·문·글씨 자리는 아래에서 빼요. */
const AREAS: [WallName, [number, number], [number, number]][] = [
  ['front', [-2.05, 0.92], [0.55, 2.3]],
  ['left', [-1.08, 2.88], [0.55, 2.3]],
  ['right', [-1.08, 2.88], [0.55, 2.3]],
  ['back', [-2.08, -0.62], [0.55, 2.3]],
  ['back', [0.62, 2.08], [0.55, 2.3]],
];
const blocked = (w: WallName, u: number, y: number) =>
  (w === 'left' && u > WIN.z0 - 0.18 && u < WIN.z1 + 0.18 && y > WIN.y0 - 0.2 && y < WIN.y1 + 0.18) || // 창
  (w === 'front' && Math.abs(u - TEXT_AT[0]) < TEXT_W / 2 + 0.12 && Math.abs(y - TEXT_AT[1]) < TEXT_H / 2 + 0.14); // 글씨

/**
 * (11/19 2차 추가) 퍼즐과 상관없는 손자국을 빽빽하게(영화처럼): 정해진 씨앗으로 벽마다 흩뿌리되 서로 34cm 넘게 떨어지게.
 * 늘 같은 자리에 나와요(새로 고침·테이프에서도 같음).
 */
function scatterHands(): { w: WallName; u: number; y: number; tilt: number; mirror: boolean; color: string }[] {
  let s = 20261119;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const placed: { w: WallName; u: number; y: number }[] = PUZZLE.map(([, w, u, y]) => ({ w, u, y }));
  const out: ReturnType<typeof scatterHands> = [];
  const area = AREAS.map(([, [u0, u1], [y0, y1]]) => (u1 - u0) * (y1 - y0));
  const total = area.reduce((a, b) => a + b, 0);
  for (let tries = 0; tries < 4000 && out.length < 56; tries++) {
    let r = rnd() * total, k = 0;
    while (r > area[k]) r -= area[k++];
    const [w, [u0, u1], [y0, y1]] = AREAS[k];
    const u = u0 + rnd() * (u1 - u0), y = y0 + rnd() * (y1 - y0);
    if (blocked(w, u, y)) continue;
    if (placed.some((p) => p.w === w && Math.hypot(p.u - u, p.y - y) < 0.38)) continue;
    placed.push({ w, u, y });
    out.push({ w, u, y, tilt: Math.round(rnd() * 56 - 28), mirror: rnd() < 0.5, color: OTHER[Math.floor(rnd() * OTHER.length)] });
  }
  return out;
}

const hand = (id: string, w: WallName, u: number, y: number, tilt: number, mirror: boolean | undefined, color: string) => {
  const { at, face } = onWall(w, u, y);
  // 손자국 71개를 한 덩어리로 그려요(group — 그리기 1회, 폰 부담)
  const prop: Prop = { id, plane: HAND_SIZE, at, face, tilt, mirror: mirror || undefined, skin: { img: 'media/warm/hand.webp' }, blend: 'alpha', tint: color, lit: false, edge: 0.45, when: NOT_SOLVED, group: 'hands' }; // (11/19 4차) 빛·그늘·햇살에 안 물듦 + 얇은 어두운 테두리
  const size: V3 = face === 'z+' || face === 'z-' ? [0.26, 0.3, 0.08] : [0.08, 0.3, 0.26];
  return { id, prop, at, size };
};
const puzzleHands = PUZZLE.map(([color, w, u, y, tilt, mirror], i) => ({ color, ...hand(color === 'cobalt' ? 'hand-cobalt' : `hand-${i}-${color}`, w, u, y, tilt, mirror, C[color]) }));
const otherHands = scatterHands().map((h, i) => hand(`hand-x${i}`, h.w, h.u, h.y, h.tilt, h.mirror, h.color));
const cobalt = puzzleHands.find((h) => h.color === 'cobalt')!;

/** 틀린 손자국(코발트 말고 전부): 누르면 정적. */
const wrongHands: Target[] = [...puzzleHands.filter((h) => h.color !== 'cobalt'), ...otherHands].map((h) => ({
  id: h.id, label: '손자국 — 틀림', at: h.at, size: h.size, on: 'click', maxDist: 3, when: NOT_SOLVED, do: WRONG,
}));

/** 그림(512×100) 안에서 낱말이 차지하는 가로 범위(0~1). */
const word = (id: string, a: number, b: number, label: string, when: Cond, act: Action[]): Target => ({
  id, label, on: 'click', maxDist: 3, when, do: act,
  at: [TEXT_AT[0] - TEXT_W / 2 + ((a + b) / 2) * TEXT_W, TEXT_AT[1], TEXT_AT[2]],
  size: [(b - a) * TEXT_W, 0.13, 0.08],
});

/**
 * 정답 were: 강한 지지직 → 햇살·손자국·글씨가 사라지고 창밖은 암흑, 화면이 차갑게 → 음악·웃음소리는 뚝 끊기지 않고
 * 테이프가 늘어지듯 낮아지며 멈춤(11/19 2차 사용자 의견) → 형광등 험 → 나가는 문이 열림.
 */
const SOLVE: Action[] = [
  { do: 'noise', level: 1, ms: 950 },
  { do: 'stop', sound: 'warm.music', fadeMs: 2600, slow: true },
  { do: 'stop', sound: 'warm.laugh', fadeMs: 2600, slow: true },
  { do: 'goal' },
  { do: 'timer', timer: 'hint2', stop: true },
  { do: 'set', flag: 'warm.solved' },
  { do: 'wait', ms: 2000 },
  { do: 'amb', sound: 'hum' },
  { do: 'wait', ms: 1100 },
  { do: 'sound', sound: 'sfx.creak' },
  { do: 'set', flag: 'warm.exit' }, // 나가는 문이 천천히 열려요
];

export const warm: Room = {
  id: 'warm',
  title: '따뜻한 방',
  vhs: 0.25,
  // (11/19 6단계 2차 변경) 차가운 화면은 방 안에서만 — 창밖 복도에선 색을 그대로(바닥 빨간 점이 빨갛게 보여야 해서)
  cold: { all: [{ flag: 'warm.solved' }, { not: { flag: 'warm.inhall' } }] },
  exposure: 1.3, // (11/19 3차 추가, 사용자 의견: 어두침침함) 자동 노출보다 30% 밝게. 풀고 나면(cold) 원래대로
  exposureOff: { flag: 'warm.inhall' }, // (11/19 6단계 2차) 창밖 복도에선 안 씀
  // (11/19 6단계, 사용자 결정) 잠긴 문 추격 중엔 되감기 끔. 추격 전 복도·따뜻한 방에선 됨
  tape: { offWhen: RUNNING },
  // (11/19 6단계 2차, 사용자 의견) 실패하면 경고음이 늘어지며 낮아지고 지지직 — 더 섬뜩하게 되돌아가요
  fail: { slow: ['sfx.alarm'], sound: 'sfx.chew' },
  keys: [BUNCH],
  live: {
    lamps: LIVE_LAMPS,
    box: [[0.25, -0.05, -2.75], [6.65, H + 0.05, -1.35]],
    dim: { when: RUNNING, level: 0.2 }, // 둘째 시도에 정전 — 다가오는 불만 남게(문 앞은 열쇠가 겨우 실루엣으로 보일 만큼)
    // (11/19 6단계 2차 추가, 사용자 의견) 뒤돌아보면 끝없이 늘어진 복도: 저 멀리서부터 불이 켜져 다가와요(보기에만 — 걸어 들어갈 수 없음)
    far: {
      from: [0.3, 0, HZ], dir: 'x-', length: 56, width: 1.3, height: H, mats: { floor: 'carpet', wall: 'gray', ceil: 'white' },
      lamps: { spacing: 4, n: FAR_N, power: 4.5, color: '#eef3ff', size: [0.9, 0.14], count: 'lights', first: 1 },
      when: CHASE,
    },
  },
  // (11/19 2차 추가) 왼쪽 창으로 늦은 오후 햇살이 비스듬히(앞벽 오른쪽·바닥에 창 모양). 풀면 꺼지고 창밖은 암흑
  sun: {
    when: NOT_SOLVED,
    window: { at: [LEFT, (WIN.y0 + WIN.y1) / 2, (WIN.z0 + WIN.z1) / 2], size: [WIN.z1 - WIN.z0, WIN.y1 - WIN.y0], face: 'x+' },
    dir: [1, -0.25, -0.75],
    color: '#ff8a36',
    power: 4.6,
    room: [[LEFT - 0.01, -0.01, FRONT - 0.01], [RIGHT + 0.01, H + 0.01, BACK + 0.01]],
    bar: 0.025,
    beam: 0.2,
  },

  space: {
    boxes,
    lamps: [
      // 문 앞 공간: 어둑한 빛 하나(등은 안 보임)
      { at: [0, H - 0.02, 4.1], size: [0.5, 0.5], power: 3.2, color: '#ffd8ae', hide: true },
      // 따뜻한 방: 영화처럼 주황빛이 도는 은은한 빛 + 창 쪽에서 번지는 빛
      // (등 하나가 늘 때마다 굽는 시간이 늘어서 둘로 — 폰에서 미리 짓는 시간)
      // (11/19 3차 변경, 사용자 의견: 어두침침함 → 아름답고 신비롭게) 더 밝게
      { at: [0.2, H - 0.02, 0.9], size: [1.4, 1.2], power: 9.5, color: '#ffd2a4', hide: true },
      { at: [-1.75, H - 0.02, 1.3], size: [0.5, 1.2], power: 3.6, color: '#ffbf80', hide: true },
      // ~~창밖 복도: 차가운 형광등 하나~~ (11/19 6단계 2차 변경) 켜고 끄는 등(live.lamps의 hall)으로 옮겼어요 — 추격 때 탁 꺼지게
      // (11/19 6단계 2차 추가) 잠긴 문 너머 계단실 입구: 어둑한 녹색빛 등(추격 중엔 정전으로 같이 어두움)
      { at: [7.7, H + 0.58, -2.05], size: [0.4, 0.4], power: 2.0, color: '#dfe8cf' },
    ],
  },

  spawns: {
    // 빨간 점에서 넘어오면: 문 앞 공간, 갈색 문을 바라봄
    start: { at: [0, 0, 4.5], yaw: 0 },
    // (11/19 6단계 추가) 잠긴 문 앞(체크포인트 — 실패하면 여기부터), 문을 열고 뛰어든 자리, 돌아서서 문을 봄
    lockdoor: { at: [5.95, 0, HZ], yaw: -90 },
    hall: { at: [3.8, 0, HZ], yaw: -90 }, // (11/20 추가) 개발용 바로가기 자리(창밖 복도 가운데, 잠긴 문을 바라봄 — 몇 걸음 가면 체크포인트)
    'vest-in': { at: [7.45, 0, HZ], yaw: -90 },
    'vest-turn': { at: [7.45, 0, HZ], yaw: 90 },
  },

  parts: [
    {
      // 갈색 문: 손잡이를 누르고 있으면 따뜻한 방 쪽으로 열려요(열린 채로)
      id: 'brown-door', when: { not: { flag: 'warm.open' } }, swap: 'swing', ms: 1700, swing: { hinge: [-0.45, 3.1], deg: 100 },
      boxes: [
        { id: 'bd', at: [0, 1.025, 3.1], size: [0.9, 2.05, 0.05], mat: 'wood' },
        // 은색 레버 손잡이(영상처럼) + 둥근 받침 — 어두운 문에서도 보이게 밝은 색
        { id: 'bd-h1', at: [0.3, 1.0, 3.155], size: [0.15, 0.03, 0.03], mat: 'white', solid: false },
        { id: 'bd-r1', at: [0.36, 1.0, 3.132], size: [0.07, 0.07, 0.015], mat: 'white', solid: false },
        { id: 'bd-h2', at: [0.3, 1.0, 3.045], size: [0.15, 0.03, 0.03], mat: 'white', solid: false },
      ],
    },
    {
      // (11/19 6단계 2차 추가) 창밖 복도 서쪽 끝 벽: 추격이 시작되면(불이 꺼진 순간이라 안 보임) 사라지고 끝없는 복도가 이어져요
      id: 'hall-end', when: { not: CHASE },
      boxes: [wall('h-end-l', 0.3, 0.5, -2.9, -1.4, 'gray')],
    },
    {
      // (11/19 6단계 추가) 잠긴 문(영상처럼 흰 문 + 둥근 은색 손잡이): 빨간 점 열쇠로 열리면 계단실 쪽으로 활짝 → 뛰어든 뒤 쾅 닫혀요(0.14초)
      id: 'lock-door', when: { any: [{ not: { flag: 'lock.open' } }, { flag: 'lock.shut' }] },
      swap: 'swing', ms: 800, closeMs: 200, swing: { hinge: [6.6, -2.49], deg: 100 }, // (11/20 4차 변경, 사용자 의견: 너무 빨리 열렸다 닫힘) ~~ms 450 · closeMs 140~~
      boxes: [{ id: 'ld', at: [6.575, 1.025, -2.05], size: [0.05, 2.05, 0.88], mat: 'white' }],
      knob: [{ at: [6.55, 1.0, -1.74], face: 'x-' }, { at: [6.6, 1.0, -1.74], face: 'x+' }], // (11/20) 복도 쪽(열쇠 구멍 x 6.477)·계단실 쪽
    },
    {
      // 나가는 문: 퍼즐을 풀면 방 쪽으로 열려요(복도는 좁아서 — 오갈 수 있음)
      id: 'exit-door', when: { not: { flag: 'warm.exit' } }, swap: 'swing', ms: 2000, swing: { hinge: [1.95, -1.3], deg: 100 },
      boxes: [
        { id: 'xd', at: [1.5, 1.025, -1.3], size: [0.9, 2.05, 0.05], mat: 'wood' },
        { id: 'xd-h1', at: [1.2, 1.0, -1.255], size: [0.15, 0.03, 0.03], mat: 'white', solid: false },
        { id: 'xd-h2', at: [1.2, 1.0, -1.345], size: [0.15, 0.03, 0.03], mat: 'white', solid: false },
      ],
    },
  ],

  props: [
    ...puzzleHands.map((h) => h.prop),
    ...otherHands.map((h) => h.prop),
    { id: 'we-were-here', plane: [TEXT_W, TEXT_H], at: TEXT_AT, face: 'z+', skin: { img: 'media/warm/text.webp' }, blend: 'alpha', when: NOT_SOLVED },
  ],

  targets: [
    {
      id: 'handle',
      label: '갈색 문 손잡이(누르고 있기)',
      at: [0.3, 1.0, 3.15],
      size: [0.28, 0.26, 0.2],
      on: 'hold',
      holdMs: 700,
      maxDist: 1.6,
      once: true,
      block: true,
      when: { not: { flag: 'warm.open' } },
      do: [
        { do: 'timer', timer: 'doorhint', stop: true },
        { do: 'sound', sound: 'sfx.creak' },
        { do: 'set', flag: 'warm.open' },
        { do: 'wait', ms: 500 },
        { do: 'sound', sound: 'warm.music' },
        { do: 'goal', text: G0 },
      ],
    },
    {
      // 코발트 손자국: 옛 녹화(실사)가 순식간에 지나가요. 다시 누르면 또 틀어요. 끝나자마자 되감기 안내(TECH_DESIGN 12-6 끝)
      id: 'hand-cobalt',
      label: '코발트 손자국 — 옛 녹화',
      at: cobalt.at,
      size: cobalt.size,
      on: 'click',
      maxDist: 3,
      block: true,
      when: NOT_SOLVED,
      do: [
        { do: 'if', when: { not: PLAYED }, then: [{ do: 'sound', sound: 'warm.laugh' }] }, // 벽 너머 웃음소리(이때부터 계속)
        { do: 'set', flag: 'warm.played' },
        { do: 'sound', sound: 'sfx.memory' },
        { do: 'sound', sound: 'sfx.mlaugh' },
        // (11/21 8단계 ②) index = 테이프에서 저절로 멈추는 자리(4장면의 가운데, 장면 0.6초씩 — scripts/assets.config.ts의 shots)
        { do: 'clip', clip: 'warm/old.mp4', index: [0.3, 0.9, 1.5, 2.1] },
        { do: 'if', when: { not: { flag: 'warm.told' } }, then: [{ do: 'set', flag: 'warm.told' }, { do: 'goal', text: G1 }, { do: 'timer', timer: 'hint2' }] },
        // (11/21 8단계 ② 변경, 사용자 결정) 되감기는 여기서 처음 열려요(~~포스트잇의 방 정전 뒤~~)
        { do: 'set', flag: 'tape' },
        TAPE_HINT,
      ],
    },
    ...wrongHands,
    word('word-we', 0.05, 0.29, 'we — 틀림', NOT_SOLVED, WRONG),
    word('word-here', 0.68, 0.96, 'here — 틀림(YOU ARE HERE 함정)', NOT_SOLVED, WRONG),
    word('word-were', 0.34, 0.645, 'were — 정답', { all: [PLAYED, NOT_SOLVED] }, SOLVE),
    word('word-were-early', 0.34, 0.645, 'were — 옛 녹화 전엔 틀림', { all: [{ not: PLAYED }, NOT_SOLVED] }, WRONG),
    {
      id: 'exit-locked',
      label: '나가는 문(풀기 전)',
      at: [1.2, 1.0, -1.25],
      size: [0.3, 0.3, 0.12],
      on: 'click',
      maxDist: 1.6,
      when: { not: { flag: 'warm.exit' } },
      do: [{ do: 'note', note: 'warm-door' }],
    },
    // 복도 창: 창살 너머를 잠깐 바라보면
    ...[1.5, 4.3].map((cx, i): Target => ({
      id: `window-${i}`, label: '창밖(암흑)', at: [cx, 1.47, -2.72], size: [0.9, 1.05, 0.06], on: 'aim', dwellMs: 900, maxDist: 2.6,
      when: { not: RUNNING }, // (11/19 6단계) 추격 중엔 문구 없이(설계서 3.1)
      do: [{ do: 'note', note: 'warm-window' }],
    })),

    // ── (11/19 6단계 추가) 잠긴 문 ──
    {
      // 손잡이 세 번: ① 열쇠가 헛돎 ② 형광등 탁 → 끝없는 복도 끝에서 쿵 + 경고음(추격) ③ 손이 미끄러져 꾸러미가 바닥에 와르르
      id: 'knob',
      label: '잠긴 문 손잡이(세 번)',
      at: [6.5, 1.0, -1.74],
      size: [0.12, 0.14, 0.14],
      on: 'click',
      maxDist: 1.7,
      when: { all: [{ not: { count: 'lock.try', gte: 3 } }, { not: DONE }] },
      do: [
        { do: 'timer', timer: 'knobhint', stop: true },
        { do: 'stat', key: 'keysTried' },
        {
          do: 'if', when: { not: { count: 'lock.try', gte: 1 } },
          then: [{ do: 'add', count: 'lock.try' }, { do: 'sound', sound: 'sfx.try1' }],
          else: [{
            do: 'if', when: { not: { count: 'lock.try', gte: 2 } },
            then: [{ do: 'add', count: 'lock.try' }, { do: 'sound', sound: 'sfx.try2' }, ...CHASE_START],
            else: [{ do: 'sound', sound: 'sfx.try3' }, { do: 'wait', ms: 160 }, { do: 'add', count: 'lock.try' }, { do: 'sound', sound: 'sfx.keysdrop' }],
          }],
        },
      ],
    },
    {
      // 엉킨 열쇠 더미: 한두 번 누르면 짤랑 — 위의 열쇠들이 옆으로 헤쳐져 빨간 점 열쇠가 드러나요(줌 없이도)
      id: 'pile', label: '열쇠 더미 — 헤치기', at: PILE_AT, size: [0.22, 0.016, 0.22], on: 'click', maxDist: 1.9,
      when: { all: [{ count: 'lock.try', gte: 3 }, { not: { count: 'lock.spread', gte: 2 } }, { not: DONE }] },
      do: [{ do: 'add', count: 'lock.spread' }, { do: 'sound', sound: 'sfx.jingle' }],
    },
    {
      // 헤친 뒤 아무 열쇠: 줌을 당기고 누르면 틀림(불이 한 칸), 줌 없이 누르면 줌 안내
      id: 'pile-keys', label: '보통 열쇠 — 틀림', at: PILE_AT, size: [0.24, 0.016, 0.24], on: 'click', maxDist: 1.9, needZoom: 1.5,
      when: { all: [{ count: 'lock.spread', gte: 2 }, { not: DONE }] }, do: WRONG_KEY, unzoomed: ZOOM_HINT,
    },
    {
      // 빨간 점 열쇠: 더미보다 살짝 높은 상자라 먼저 잡혀요. 불빛이 바닥까지(②) 오기 전엔 어둠 속 다른 열쇠와 같아서 틀림
      id: 'red-key', label: '빨간 점 열쇠', at: [RED_AT[0], 0.012, RED_AT[2]], size: [0.05, 0.024, 0.05], on: 'click', maxDist: 1.9, needZoom: 1.5, block: true,
      look: true, // (11/20 추가, 사용자 의견) 연출 중 ~~안내음성이 나오는 동안은~~ (2차) 문이 열리기까지 둘러볼 수 있게(뛰어들기 시작하면 잠김)
      when: { all: [{ count: 'lock.spread', gte: 2 }, { not: DONE }] },
      do: [{ do: 'if', when: near(2), then: UNLOCK, else: WRONG_KEY }],
      unzoomed: ZOOM_HINT,
    },
    {
      // "뒤를 보는 중": 뒤쪽(끝없는) 복도가 화면 안쪽에 가리지 않고 보이는 동안 불이 4배 빨리(타이머 chase의 faster)
      id: 'back', label: '뒤쪽 복도(뒤를 보는 중 판정)', on: 'seen', when: RUNNING,
      at: [-8, 1.3, HZ], size: [16, 1.6, 1.0], maxDist: 30, dwellMs: 1e9, do: [],
    },
  ],

  zones: [
    {
      // 창밖 복도에 들어서면 험도 멎어요(완전한 무음). 방으로 돌아오면 다시 험
      // (11/19 6단계 2차) 복도에 있는 동안은 차가운 화면·노출 배율을 안 써요(warm.inhall)
      id: 'hall',
      at: [3.6, 1, -2.05],
      size: [6.2, 2, 1.3],
      enter: [{ do: 'amb' }, { do: 'set', flag: 'warm.inhall' }],
      leave: [{ do: 'amb', sound: 'hum' }, { do: 'set', flag: 'warm.inhall', off: true }],
    },
    {
      // (11/19 6단계 추가) 잠긴 문 앞에 서면 체크포인트(실패해도 여기부터 — 따뜻한 방 퍼즐은 다시 안 풀어요). (11/20 변경, 사용자 의견) ~~거친 숨~~ 숨소리는 빼요
      id: 'lockcp', at: [5.6, 1, HZ], size: [2.0, 2, 1.3], when: { not: { flag: 'lock.cp' } },
      enter: [{ do: 'set', flag: 'lock.cp' }, { do: 'checkpoint', spawn: 'lockdoor', name: 'lockdoor' }, { do: 'timer', timer: 'knobhint' }],
    },
    ...CAUGHT,
  ],

  timers: {
    // 문 앞에서 한참 안 열면 조작 안내(개조식)
    doorhint: { length: { ms: 9000 }, end: [{ do: 'hint', text: '손잡이 조준 · 길게 누르기', touch: '손잡이 길게 누르기' }] },
    // (11/19 2차 변경) ~~아래에 한 줄 더~~ → 첫 문구 자리를 바꿔요(사용자 의견)
    hint2: { length: { ms: 60_000 }, end: [{ do: 'goal', text: G2, strong: true }, { do: 'goal', text: G3, add: true }] }, // (11/19 3차) 노랗게 빛나는 글씨
    // (11/19 6단계 추가) 잠긴 문 앞에서 한참 손잡이를 안 누르면 조작 안내(개조식)
    knobhint: { length: { ms: 9000 }, end: [{ do: 'if', when: { not: { count: 'lock.try', gte: 1 } }, then: [{ do: 'hint', text: '손잡이 조준 · 누르기', touch: '손잡이 톡' }] }] },
    // (11/19 6단계 추가) 다가오는 불 = 타이머. 끝없는 복도의 먼 불 12개는 짧게 차르르(0.9 → 0.4초), 걸을 수 있는 복도의 ①~⑤는 한 칸에 5초.
    // 뒤를 보는 동안은 4배 빨리(설계서 1.2). 문을 보면 32초쯤, 뒤만 보면 8초쯤에 등 뒤까지 와요
    chase: {
      length: { ms: 5000 },
      steps: { count: 'lights', ms: [900, 750, 650, 600, 550, 500, 500, 450, 450, 400, 400, 400, 5000, 5000, 5000, 5000, 5000] },
      faster: { seen: 'back', x: 4 },
      end: [{ do: 'add', count: 'lights' }, ...STEP_FX, { do: 'timer', timer: 'chase' }],
    },
  },

  enter: [
    // ~~이 방에 왔다면 포스트잇의 방에서 되감기가 이미 열렸어요~~ (11/21 변경) 옛 녹화를 본 뒤에만(이어 하기·?room=warm)
    { do: 'if', when: PLAYED, then: [{ do: 'set', flag: 'tape' }] },
    // 이어 하기·다시 들어올 때 지금 상태에 맞는 소리와 문구로
    { do: 'if', when: { not: { flag: 'warm.open' } }, then: [{ do: 'timer', timer: 'doorhint' }] },
    {
      do: 'if',
      when: { flag: 'warm.solved' },
      then: [{ do: 'amb', sound: 'hum' }],
      else: [
        { do: 'if', when: { flag: 'warm.open' }, then: [{ do: 'sound', sound: 'warm.music' }] },
        { do: 'if', when: { all: [{ flag: 'warm.open' }, { not: PLAYED }] }, then: [{ do: 'goal', text: G0 }] },
        { do: 'if', when: PLAYED, then: [{ do: 'sound', sound: 'warm.laugh' }, { do: 'goal', text: G1 }, { do: 'timer', timer: 'hint2' }] },
      ],
    },
    // (11/19 6단계 추가) 잠긴 문 체크포인트에서 다시 시작(실패·이어 하기): 창밖 복도는 무음. 실패한 뒤라면 손잡이 없이 바로 추격부터
    {
      do: 'if',
      when: { all: [{ flag: 'lock.cp' }, { not: DONE }] },
      then: [
        { do: 'amb' },
        { do: 'if', when: { count: 'fails.lockdoor', gte: 1 }, then: RESTART, else: [{ do: 'timer', timer: 'knobhint' }] },
      ],
    },
  ],
};
