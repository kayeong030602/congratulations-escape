import type { Action, Cond, Room, Target, V3 } from '../schema.ts';
import { TAPE_HINT } from './common.ts';
import {
  CONGRATS_X, ENGLISH_SIGN, LT, SLAM_DOOR, STAIR_AMB, STAIR_BOXES, STAIR_EXPOSURE, STAIR_LAMPS, STAIR_RAILS, STAIR_REACH, STAIR_SPAWNS, VOID, XE0, XE1, ZM, ZN, ZONE_AT, ZS,
  congratsDoor, doorPlug, floorPlate, postitCluster, tapeTraces, topWall, voidProps,
} from './stairwell.ts';

/**
 * (11/19 6단계 추가 · 11/20 루프 완성) 계단참 루프 0-1~0-4 — 잠긴 문이 쾅 닫힌 뒤(최종 영상 01:31~). 설계서 docs/puzzles/STAIRWELL_LOOP.md,
 * 정한 것 TECH_DESIGN 14-1·14-9·14-10. 계단실 모양은 rooms/stairwell.ts(시험 방과 같이 씀).
 *
 *   올라가는 쪽이 정방향. 어긋난 것이 보이면 되돌아 내려가고, 없으면 올라가요. 판정은 계단참(M)까지 올라간 뒤에만.
 *     시작 칸 → 계단 A → 계단참 M(층 표시 0-n · 영어 안내판) ┬→ 계단 B → 꼭대기 → 다음 계단 A' 밟음 = "올라감"
 *                                                          └→ 계단 A로 되돌아 내려와 시작 칸 = "내려감"
 *   둘 다 페이드 → 시작 칸(다음 바퀴). 맞으면 다음 층, 틀리면 멀리서 쿵 + 노이즈 → 0-1(사용자 결정, 테이프 씹힘 없음)
 *
 *   0-1 정상(올라감) · 0-2 보호색 포스트잇(내려감) · 0-3 정상(올라감) · 0-4 눈앞은 멀쩡하지만 테이프에 흔적(내려감 — 테이프에서 봐야만 통과)
 *   0-4: 계단 A 중간에서 험이 물속처럼 먹먹 + 트래킹 노이즈 한 번 + (11/20 2차) 등 뒤 아래에서 열쇠 짤랑 → 되감으면 테이프에만 앞 방들의 흔적
 *        (포스트잇·손자국·열쇠 — (2차) 계단참 벽·바닥에도) → 봄(플래그, 처음 찾은 순간 기억이 차오르는 소리) → 내려가면 통과. 빨리 감아도 본 걸로 쳐요.
 *        그냥 올라가면 0-1로 + 실패 문구 한 번 + 되감기 안내. 테이프를 안 보고 내려가면 벌 없이 0-4 다시 + 되감기 안내
 *   0-4 통과 → 마지막 바퀴: 층 표시 없음, 꼭대기에 congratulations! 문(홀로그램), 다음 계단 자리는 벽으로 막힘, 체크포인트 — 6단계 끝(문 열기·엔딩은 7단계)
 *
 * (11/20 7단계 추가) 엔딩(최종 영상 01:37~01:57, TECH_DESIGN 15장): 손잡이 누르고 있기 → 문이 하얀 공간 쪽으로 열리며 홀로그램이 꺼지고 하얀 빛이 차오름
 *   (노출 Room.bright, 험 멎음, 드론 The Gates of Heaven) → 문턱을 넘으면 화면 가운데에 검은 커서 → 더 걸어 들어가면 뒤의 문이 안 보는 사이 사라지고
 *   타자 글씨: YOU NEVER ESCAPE THE MAZE. / YOU ONLY OUTGROW IT. → WELCOME TO LEVEL 1 → 크레딧 → 테이프 멈춤 → 끝 화면(main.ts).
 *   플래그 end.open(문 열림) · end.in(문턱 넘음). 문이 열린 뒤엔 되감기 안 됨
 *   (11/20 2차 변경, 사용자 의견) ~~문턱 너머 커서 → 문이 사라짐 → 타자~~ → 문 너머엔 허공에 뜬 검은 통로, 문턱을 넘으면 바닥이 없어 떨어지고,
 *   화면이 온통 하얀 그 순간부터 타자(영화와 같은 빠르기·머무는 시간). 크레딧 윗부분은 A GAME BY … + BASED ON THE SHORT FILM …
 *
 * 진행 상태는 플래그·개수로만(12-5): 층 stair.floor(1~4, 5 = 마지막 바퀴), 계단참에 올라섬 stair.m, 테이프에서 봄 stair.taped,
 * 먹먹해짐 들음 stair.muffled, 실패 문구 봄 stair.told. 같은 방 안 순간이동이라 테이프엔 앞 바퀴도 남아요(층 조건으로 구분 — 테이프 대상도 그 시각 층으로 거름).
 */

const FLOOR = 'stair.floor';
/** 지금 n번째 바퀴(0-n)인가 */
const at = (n: number): Cond => ({ all: [{ count: FLOOR, gte: n }, { not: { count: FLOOR, gte: n + 1 } }] });
const FINAL: Cond = { count: FLOOR, gte: 5 };
const LOOPING: Cond = { not: FINAL };

/** 화면 위 문구(0-1부터 루프 내내, 사용자 결정) — 규칙이라 건조한 평서문 */
const RULE = '어긋난 것이 보이면 되돌아 내려가고, 없으면 올라간다.';
/** 0-4에서 그냥 올라가 실패했을 때 한 번(설계서 2장, 사용자 결정) */
const FAIL_TEXT = '고요할수록 지나온 걸음을 되돌아 보아야 한다.';
/** 틀렸을 때 멀리서 쿵: 계단실 저 아래 깊은 곳(입체 음향 — 멀고 먹먹하게) */
const FAR: V3 = [1.3, -7, -1.6];
/** (11/20 2차) 0-4 신호: 등 뒤 아래, 시작 칸 바닥(테이프에만 찍힌 열쇠가 있는 자리)에서 들리는 열쇠 짤랑 */
const JINGLE_AT: V3 = [2.0, 0.1, 0.35];

const CLEAR: Action[] = [
  { do: 'set', flag: 'stair.m', off: true },
  { do: 'set', flag: 'stair.taped', off: true },
  { do: 'set', flag: 'stair.muffled', off: true },
];
const WARP: Action = { do: 'warp', spawn: 'start', via: 'fade' };
/** 맞음 → n번째 바퀴로(층 표시는 페이드로 캄캄한 사이에 바뀌어요) */
const toRound = (n: number): Action[] => [...CLEAR, { do: 'add', count: FLOOR, set: n }, WARP];
/** 0-4 통과 → 마지막 바퀴(문구 지움, 여기서부터 이어 하게 체크포인트) */
const PASS4: Action[] = [...CLEAR, { do: 'add', count: FLOOR, set: 5 }, { do: 'goal' }, WARP, { do: 'checkpoint', spawn: 'start', name: 'stairs' }, { do: 'timer', timer: 'knobhint' }];
/** 틀림 → 멀리서 쿵 + 노이즈 → 페이드 → 0-1(사용자 결정) */
const WRONG: Action[] = [
  { do: 'lock' },
  { do: 'stat', key: 'fails' }, // (11/20 7단계) 끝 화면 "다시 시작한 횟수"에 0-1로 돌아간 것도 셈
  { do: 'sound', sound: 'sfx.thud', at: FAR },
  { do: 'noise', level: 0.7, ms: 350 },
  { do: 'wait', ms: 700 },
  ...toRound(1),
  { do: 'lock', off: true },
];

/** 계단참에서 되돌아 내려와 시작 칸에 닿음 */
const WENT_DOWN: Action[] = [{
  do: 'if', when: at(2), then: toRound(3),
  else: [{
    do: 'if', when: at(4),
    // 0-4: 테이프에서 흔적을 봤으면 통과, 아니면 벌 없이 0-4 다시 + 되감기 안내(사용자 결정)
    then: [{ do: 'if', when: { flag: 'stair.taped' }, then: PASS4, else: [...CLEAR, WARP, TAPE_HINT] }],
    else: WRONG, // 0-1·0-3에서 내려감
  }],
}];

/** 꼭대기에서 다음 계단 A'를 밟음(계속 올라감) */
const WENT_UP: Action[] = [{
  do: 'if', when: at(1), then: toRound(2),
  else: [{
    do: 'if', when: at(3), then: toRound(4),
    else: [{
      do: 'if', when: at(4),
      // 0-4에서 그냥 올라감: 0-1로 + 실패 문구 한 번(먼저 읽게 5초) + 되감기 안내(12-6 끝)
      then: [...WRONG, { do: 'if', when: { not: { flag: 'stair.told' } }, then: [{ do: 'set', flag: 'stair.told' }, { do: 'hint', text: FAIL_TEXT }, { do: 'wait', ms: 5000 }] }, TAPE_HINT],
      else: WRONG, // 0-2에서 올라감
    }],
  }],
}];

const plates = [1, 2, 3, 4].map((n) => floorPlate(n, at(n)));
const hidden = postitCluster(at(2));
const traces = tapeTraces(at(4));
// (11/20 7단계) 엔딩 플래그
const OPEN: Cond = { flag: 'end.open' };
const door = congratsDoor(FINAL, OPEN);

/** 문 손잡이를 한참 안 누르면 조작 안내(개조식) */
const KNOB_HINT: Action = { do: 'if', when: { not: OPEN }, then: [{ do: 'hint', text: '손잡이 조준 · 길게 누르기', touch: '손잡이 길게 누르기' }] };

/** 손잡이를 끝까지 누르고 있음 → 문이 열림(영상 01:37~) */
const OPEN_DOOR: Action[] = [
  { do: 'timer', timer: 'knobhint', stop: true },
  // (11/20 폰 점검 뒤 변경, 사용자 의견: 문 여는 소리만 남기고 "띠링" 같은 완료음은 빼기) ~~sfx.unlock(1kHz 짧은 음) + 0.25초~~
  { do: 'sound', sound: 'sfx.creak' },
  { do: 'noise', level: 0.35 }, // 홀로그램이 꺼지는 순간 살짝 지지직
  { do: 'set', flag: 'end.open' },
  { do: 'stop', sound: 'hum', fadeMs: 1500 },
  { do: 'amb' }, // 형광등 험이 멎고
  { do: 'sound', sound: 'end.gates' }, // 하얀 빛과 함께 드론이 차올라요
];

/**
 * 크레딧 — 영화 엔딩 크레딧에서 (11/20 2차 변경, 사용자 의견) 윗부분을 게임에 맞게:
 * ~~A FILM BY SONG KAYEONG~~ → A GAME BY SONG KAYEONG + BASED ON THE SHORT FILM "CONGRATULATIONS!"(한 줄 더). 음악·소리 출처(CC BY)는 그대로.
 * 글씨 크기는 영화(1440×1080의 56·38·30px)를 640×480에 맞춘 값. '' = 빈 줄(사이 띄움)
 */
const CREDITS: [string, number][] = [
  ['CONGRATULATIONS!', 25], ['A GAME BY SONG KAYEONG', 17], ['BASED ON THE SHORT FILM "CONGRATULATIONS!"', 13], ['', 9],
  ['MUSIC "BIT SHIFT", "DREAMY FLASHBACK"', 13], ['KEVIN MACLEOD (CC BY 4.0)', 13],
  ['SOUND "THE GATES OF HEAVEN" JOVICA (CC BY 4.0)', 13], ['AI VIDEO SEEDANCE  AI IMAGE NANO BANANA PRO', 13],
];

/** 영화 엔딩의 프레임(30fps) → ms */
const f = (n: number) => Math.round((n * 1000) / 30);
/** (11/20 2차) 크레딧 뒤 테이프가 멈추는 길이: 화면 지지직 = 소리가 늘어지며 멈추는 시간 */
const STOP_MS = 1300;

/**
 * (11/20 2차 변경, 사용자 의견) 문 안으로 들어서면 바닥이 없는 무의 공간 → 떨어짐 → 화면이 온통 하얀 그 순간부터 타자 글씨.
 * 빠르기·머무는 시간은 영화 엔딩(build_ending_e3_v2.py)과 같게: 카피 두 줄 사이 5프레임, 다 치고 24프레임 뒤 지움, 6프레임 뒤 WELCOME TO LEVEL 1,
 * 22프레임 뒤 지움, 6프레임 뒤 크레딧(줄 사이 3프레임). 영화는 크레딧이 다 나오기 전에 테이프가 끊기지만, 게임은 다 친 뒤 1초 머물러요.
 * → 테이프 멈춤 → 끝 화면
 */
const FALL: Action[] = [
  { do: 'set', flag: 'end.in' },
  { do: 'fall', ms: 2100, depth: 28 }, // 검은 통로(44m 멀리)가 시야 위로 완전히 벗어날 만큼
  { do: 'type', clear: true },
  { do: 'type', text: 'YOU NEVER ESCAPE THE MAZE.' },
  { do: 'wait', ms: f(5) },
  { do: 'type', text: 'YOU ONLY OUTGROW IT.' },
  { do: 'wait', ms: f(24) },
  { do: 'type', clear: true },
  { do: 'wait', ms: f(6) },
  { do: 'type', text: 'WELCOME TO LEVEL 1' },
  { do: 'wait', ms: f(22) },
  { do: 'type', clear: true },
  { do: 'wait', ms: f(6) },
  ...CREDITS.flatMap(([text, size]): Action[] => [{ do: 'type', text, size, fast: true }, { do: 'wait', ms: f(3) }]),
  { do: 'wait', ms: 1000 },
  // 테이프가 끝나요: 화면이 찢어지며 멈춤 → 끝 화면
  // (11/20 2차 변경, 사용자 의견: 치지직 소리 말고, 크레딧이 지지직거리는 동안 소리가 피치다운되며 넘어가게) ~~sfx.chew + 드론 2.5초 페이드~~
  //   → 지지직(1.3초) 동안 드론이 테이프가 늘어지듯 낮아지며 느려지다 멈춤(따뜻한 방 정답 때와 같은 stop의 slow). 영화 인트로 끝의 테이프 멈춤처럼
  // (11/20 4차 변경, 사용자 의견: 지지직이 걷히며 크레딧이 잠깐 원래대로 돌아왔다가 파란 화면으로 넘어감 → 지지직 트랜지션으로 바로)
  //   화면 지지직은 "앞 60%는 세게, 뒤 40%에 걷힘"이라 ~~길이 STOP_MS~~ 그대로면 끝무렵에 크레딧이 또렷해졌어요 → 길이를 늘려(STOP_MS + 1초)
  //   파란 끝 화면이 뜨는 순간까지 세게 찢어진 채로, 걷히는 부분은 끝 화면이 나타나는(0.9초) 그 뒤에서 — 찢어진 화면이 그대로 파랗게 덮여요
  { do: 'lock' },
  { do: 'noise', level: 1, ms: STOP_MS + 1000 },
  { do: 'stop', sound: 'end.gates', fadeMs: STOP_MS, slow: true },
  { do: 'wait', ms: STOP_MS },
  { do: 'type', off: true },
  // (11/20 2차 추가, 사용자 의견) 파란 끝 화면에 머무는 동안은 인트로의 그 노래(Bit Shift, 반복) — 끝 화면이 나타나는 동안 서서히
  { do: 'sound', sound: 'end.music', fade: 1500 },
  { do: 'end' },
];

/**
 * 0-4 테이프에서만 잡히는 것: 흔적이 화면 안쪽에 보이면 "테이프에서 봤음"(테이프 그 시각 층이 0-4일 때만).
 * (11/20 2차 추가, 사용자: 되감아 봤는데 안 넘어가서 오류인 줄) 처음 찾은 순간 기억이 차오르는 소리 한 번(따뜻한 방의 그 소리 — 앞 방들의 흔적이라서)
 * 빨리 감아도 본 걸로 쳐요(logic.tapeSpeed — 지나간 테이프 시간으로 세요)
 */
const SEEN: Action[] = [{ do: 'if', when: { not: { flag: 'stair.taped' } }, then: [{ do: 'set', flag: 'stair.taped' }, { do: 'sound', sound: 'sfx.memory' }] }];
const traceSpots: Pick<Target, 'id' | 'label' | 'at' | 'size' | 'maxDist'>[] = [
  { id: 'trace-a', label: '0-4 테이프 흔적: 계단 A 동쪽 벽', at: [XE1 - 0.05, 1.3, -1.65], size: [0.1, 1.4, 2.0], maxDist: 6 },
  { id: 'trace-s', label: '0-4 테이프 흔적: 시작 칸 동쪽 벽', at: [XE1 - 0.05, 1.1, 0.2], size: [0.1, 1.2, 1.5], maxDist: 6 },
  { id: 'trace-w', label: '0-4 테이프 흔적: 시작 칸 서쪽 벽 손자국', at: [XE0 + 0.05, 1.3, 0.15], size: [0.1, 1.0, 1.1], maxDist: 6 },
  { id: 'trace-f', label: '0-4 테이프 흔적: 바닥 열쇠', at: [2.0, 0.05, 0.2], size: [1.0, 0.1, 1.0], maxDist: 5 },
  { id: 'trace-d', label: '0-4 테이프 흔적: 문 옆', at: [1.6, 1.6, ZS - 0.05], size: [0.5, 1.0, 0.1], maxDist: 6 },
  { id: 'trace-m', label: '0-4 테이프 흔적: 계단참 벽(표지판 둘레)', at: [1.3, 2.7, ZN + 0.05], size: [2.4, 2.0, 0.1], maxDist: 7 }, // (11/20 2차)
];
const traceTargets: Target[] = traceSpots.map((t) => ({ ...t, on: 'seen', tape: true, when: at(4), dwellMs: 400, do: SEEN }));

export const stairs: Room = {
  id: 'stairs',
  title: '계단참',
  amb: 'hum', // (11/20) 계단실 형광등 험 — 0-4의 "먹먹해짐"이 들려야 해서
  vhs: 0.25,
  exposure: STAIR_EXPOSURE,
  // (11/20 3차 변경, 사용자 의견: 문이 열리면 건물 구조물이 부자연스러움) ~~bright: 화면 전체 노출 3.2배~~ — 계단실이 명암 없이 고르게 회색으로 떠 버렸어요.
  //   → 노출은 그대로, 문 너머 하얀 면만 흰색보다 밝게(stairwell.ts VOID_POWER) + 문에서 쏟아지는 빛(아래 live — 문 앞 바닥·벽이 가까울수록 밝게)
  live: {
    lamps: [
      // 문 구멍 한가운데 높이에서 계단실 쪽으로: 형광등처럼 깜빡이지 않고 문이 열리는 동안 서서히(fade), 보이는 등 판 없이
      { id: 'door-light', at: [CONGRATS_X, LT + 1.75, ZS + 0.1], size: [0.1, 0.1], power: 2.2, color: '#eef3ff', when: OPEN, hidden: true, fade: 2.4, shadow: true },
      { id: 'door-low', at: [CONGRATS_X, LT + 0.9, ZS + 0.1], size: [0.1, 0.1], power: 0.8, color: '#eef3ff', when: OPEN, hidden: true, fade: 2.4 },
    ],
    // 꼭대기(시작 칸 위층)와 계단 B 위쪽까지만 — 아래층(시작 칸)엔 안 닿게
    box: [[-0.1, LT - 0.25, ZM], [XE1 + 0.1, LT + 3.2, ZS + 0.25]],
  },
  tape: { offWhen: OPEN }, // (11/20 7단계) 엔딩 중엔 되감기 안 됨
  space: { boxes: STAIR_BOXES, lamps: STAIR_LAMPS, reach: STAIR_REACH, amb: STAIR_AMB },
  spawns: STAIR_SPAWNS,
  parts: [SLAM_DOOR, door.part, door.leaf, doorPlug(LOOPING), topWall(FINAL)],
  props: [...plates, ENGLISH_SIGN, ...door.props, ...traces.props, ...voidProps(FINAL)],
  scatter: [...hidden, traces.scatter],
  rails: STAIR_RAILS,
  targets: [
    {
      id: 'door', label: '쾅 닫힌 문 — 안 열림', at: [1.69, 1.0, 0.93], size: [0.14, 0.16, 0.12], on: 'click', maxDist: 1.7,
      do: [{ do: 'note', note: 'warm-door' }],
    },
    ...traceTargets,
    {
      // (11/20 7단계) congratulations! 문 손잡이: 누르고 있기 → 문이 열림
      id: 'knob', label: 'congratulations! 문 손잡이(누르고 있기)', at: [CONGRATS_X - 0.34, LT + 1.0, ZS - 0.09], size: [0.24, 0.24, 0.16],
      on: 'hold', holdMs: 1200, maxDist: 1.8, once: true, block: true, when: { all: [FINAL, { not: OPEN }] }, do: OPEN_DOOR,
    },
  ],
  zones: [
    // 계단참에 올라섬(판정은 이 뒤에만)
    { id: 'm', ...ZONE_AT.m, when: { all: [LOOPING, { not: { flag: 'stair.m' } }] }, enter: [{ do: 'set', flag: 'stair.m' }] },
    // 되돌아 내려와 시작 칸에 닿음 / 꼭대기에서 다음 계단을 밟음
    { id: 'down', ...ZONE_AT.down, when: { all: [LOOPING, { flag: 'stair.m' }] }, enter: WENT_DOWN },
    { id: 'up', ...ZONE_AT.up, when: { all: [LOOPING, { flag: 'stair.m' }] }, enter: WENT_UP },
    // (11/20 7단계 · 2차 변경) 엔딩: 문턱을 넘어 무의 공간으로 한 걸음 → 바닥이 없어 떨어짐 → 타자 글씨
    { id: 'void', at: [(VOID.x0 + VOID.x1) / 2, LT + 0.2, ZS + 0.55], size: [VOID.x1 - VOID.x0, 0.8, 0.5], into: 'z+', once: true, when: OPEN, enter: FALL },
    // 0-4: 계단 A 중간에서 험이 물속처럼 먹먹 + 트래킹 노이즈 한 번(바퀴마다 한 번)
    {
      id: 'mid', ...ZONE_AT.mid, when: { all: [at(4), { not: { flag: 'stair.muffled' } }] },
      // (11/20 2차 추가, 사용자 의견: 오류처럼 보일 수 있음 → 이상현상이라는 게 확실한 소리) 등 뒤 아래(시작 칸 바닥 — 테이프 속 열쇠 자리)에서 열쇠 꾸러미가 짤랑
      enter: [{ do: 'set', flag: 'stair.muffled' }, { do: 'noise', level: 0.55 }, { do: 'sound', sound: 'sfx.jingle', at: JINGLE_AT }, { do: 'muffle', ms: 1600 }],
    },
  ],
  enter: [
    { do: 'set', flag: 'tape' },
    // 처음 들어오면 0-1(저장에서 이어 할 땐 그 층 그대로 — 마지막 바퀴만 체크포인트가 있어요)
    { do: 'if', when: { count: FLOOR, gte: 1 }, then: [], else: [{ do: 'add', count: FLOOR, set: 1 }] },
    ...CLEAR,
    { do: 'if', when: FINAL, then: [{ do: 'timer', timer: 'knobhint' }], else: [{ do: 'goal', text: RULE }] },
  ],
  timers: {
    knobhint: { length: { ms: 25_000 }, end: [KNOB_HINT] }, // (11/20 7단계)
  },
};

