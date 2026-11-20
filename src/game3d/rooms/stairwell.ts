import type { Box, Cond, Lamp, Part, Prop, Rail, Scatter, Spawn, V3, Zone } from '../schema.ts';

/**
 * (11/20 6단계 계단참) 계단실 모양 — 시험 방(stairtest.ts)과 계단참 루프(stairs.ts)가 같이 써요.
 *
 * 영상(01:31~)처럼 올라갈 때 왼쪽에 난간(살대 사이로 반대쪽 계단이 보임), 테라초 계단. 꺾여 올라가는 계단실.
 * (11/20 2차 변경, 사용자 의견: 더 기괴하고 섬뜩하게·더 어둡게, 초록 말고) ~~올리브색 벽·초록빛 형광등~~ → 차가운 흰색 페인트 시멘트 블록 벽 +
 * 푸르스름한 흰 형광등을 어둑하게, 다음 계단 위쪽은 어둠 속으로(맨 위 등은 아주 약하게) — 방의 노출도 낮춰요(Room.exposure)
 *
 *   위에서 본 모양(x →, z ↓)                          옆에서 본 높이
 *   z=-4.1 ┌─────────────────────────┐
 *          │      계단참 M (1.4m)       │ ← 층 표시·영어 안내판(북쪽 벽)
 *   z=-2.7 ├──────────┬─┬────────────┤          꼭대기 2.8 ── 다음 계단 A'(→ 4.2, 밟으면 다음 바퀴)
 *          │ 계단 B ↓  │틈│ 계단 A ↑    │                  ╱
 *          │(1.4→2.8) │ │ (0→1.4)    │       계단참 1.4 ── 계단 B
 *   z=-0.6 ├──────────┴─┼────────────┤               ╱
 *          │ 꼭대기 2.8m  │ 시작 칸 0m   │   시작 칸 0 ── 계단 A
 *   z=1.0  └────────────┴───▮────────┘  ▮ 쾅 닫힌 문
 *        x=0        1.2 1.4          2.6
 *
 * - 꼭대기(2.8m)는 시작 칸 바로 위층이에요(진짜 건물 계단처럼). 계단 A 위로는 다음 계단 A'의 밑면이 보여요.
 * - 계단 한 칸 = 높이 17.5cm, 디딤 30cm, 한 줄에 7칸 + 계단참(8번 올라감 = 1.4m).
 * - 가운데 틈(x 1.2~1.4)은 보이지 않는 벽(Box.ghost)이라 못 들어가요. 난간은 보이기만(fixtures.ts).
 * - 계단 한 칸은 "그 칸 높이만큼의 판 + 아래 채움" 두 상자: 한 상자로 바닥까지 채우면 앞면(챌판)의 가운데가 앞 칸 속에 묻혀
 *   면이 안 생겨요(굽기의 면 만들기 규칙).
 * - 벽도 공간마다 따로(한 상자가 두 공간에 걸치면 한쪽 면이 안 생겨요 — 13-5).
 */

export const R = 0.175, T = 0.3, NT = 7; // 챌판 높이, 디딤 깊이, 한 줄 디딤 수
export const LM = 1.4, LT = 2.8, LM2 = 4.2; // 계단참·꼭대기·다음 계단참 높이
export const XW0 = 0, XW1 = 1.2, XE0 = 1.4, XE1 = 2.6; // 서쪽 줄(계단 B·꼭대기), 가운데 틈, 동쪽 줄(시작 칸·계단 A)
export const ZS = 1.0, ZF = -0.6, ZM = -2.7, ZN = -4.1; // 남쪽 벽(문), 계단 시작, 계단참 가장자리, 북쪽 벽
const TOP = 7.0; // 맨 위 천장 윗면
/**
 * (11/20 7단계 추가) congratulations! 문 자리(꼭대기 남쪽 벽): 문 반폭·높이·문틈. 벽에는 이 크기의 구멍이 늘 뚫려 있고,
 * 루프 동안은 마개(doorPlug)로 막아 둬요. 문 너머(z 1.2~)는 하얀 공간(VOID).
 */
export const CONGRATS_X = 0.6;
const DHW = 0.44, DH = 2.05, DG = 0.012;
const HOLE = { x0: CONGRATS_X - DHW - DG, x1: CONGRATS_X + DHW + DG, y1: LT + DH + DG } as const;
/**
 * 하얀 공간: 문 너머(벽 바깥 z 1.2부터). (11/20 2차 변경, 사용자 의견) ~~바닥 높이 = 꼭대기~~ → 바닥이 없는 무의 공간(아래로 deep미터까지 하얀 면),
 * 문턱을 넘으면 떨어져요. 정면 멀리 허공에 떠 있는 검은 통로(영화에서 문 너머로 보이는 것)
 */
export const VOID = { x0: -2.2, x1: 3.4, z0: ZS + 0.2, z1: 50, h: 3.2, deep: 34 } as const;
/** (11/20 2차 추가) 검은 통로: 입구 가운데 z, 폭·높이·깊이 */
const HALL = { z: 45, w: 1.1, h: 2.1, d: 3 } as const; // (11/20 2차·3차, 사용자 의견: 너무 큼 → 더 멀리) 영화처럼 아주 멀리 작게(문에서 약 44m)

const box = (id: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: Box['mat'], extra: Partial<Box> = {}): Box => ({
  id, at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], mat, ...extra,
});
const W = { walk: true } as const;

/** 한 줄 계단: 칸마다 판(그 칸 높이) + 아래 채움(바닥 또는 밑면까지). dir = 올라가는 쪽(-1: -z, +1: +z), base = 첫 칸 아래 높이 */
function flight(id: string, x0: number, x1: number, zStart: number, dir: -1 | 1, base: number, under: number | 'soffit'): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < NT; i++) {
    const za = zStart + dir * T * i, zb = zStart + dir * T * (i + 1);
    const [z0, z1] = za < zb ? [za, zb] : [zb, za];
    const y0 = base + R * i, y1 = base + R * (i + 1);
    out.push(box(`${id}${i}`, x0, x1, y0, y1, z0, z1, 'terrazzo', W));
    // 아래 채움: 땅에 놓인 줄은 바닥까지, 위층 줄(A')은 비스듬한 밑면까지(챌판 가운데가 앞 칸에 안 묻히게 판과 채움을 나눠요)
    const lo = under === 'soffit' ? y1 - 0.42 : under;
    if (lo < y0 - 0.01) out.push(box(`${id}${i}u`, x0, x1, lo, y0, z0, z1, 'white')); // 옆면·밑면은 칠한 콘크리트(디딤 판 가장자리만 테라초)
  }
  return out;
}

export const STAIR_BOXES: Box[] = [
  // 바닥들(밟는 상자)
  box('f-start', XE0, XE1, -0.2, 0, ZF, ZS, 'terrazzo', W), // 시작 칸
  ...flight('a', XE0, XE1, ZF, -1, 0, -0.2), // 계단 A(시작 칸 → 계단참)
  box('m', XW0, XE1, -0.2, LM, ZN, ZM, 'terrazzo', W), // 계단참 M
  ...flight('b', XW0, XW1, ZM, 1, LM, -0.2), // 계단 B(계단참 → 꼭대기)
  box('top-w', XW0, XE0, 2.6, LT, ZF, ZS, 'terrazzo', W), // 꼭대기(시작 칸 위층) — 서쪽·틈 위
  box('top-e', XE0, XE1, 2.6, LT, ZF, ZS, 'terrazzo', W), //   동쪽(이 아랫면이 시작 칸 천장)
  ...flight('a2', XE0, XE1, ZF, -1, LT, 'soffit'), // 다음 계단 A'(꼭대기 → 다음 계단참) — 밑면이 계단 A 위로 보여요
  box('m2', XW0, XE1, LM2 - 0.2, LM2, ZN, ZM, 'terrazzo', W), // 다음 계단참 M'(닿을 일은 없어요)
  box('well', XW1, XE0, -0.2, 0, ZM, ZF, 'terrazzo'), // 가운데 틈 바닥
  // 꼭대기 아래 채움(시작 칸 서쪽 벽) — 틈 위 칸은 따로(그 북쪽 면이 틈에서 보여서)
  box('under-w', XW0, XW1, -0.2, 2.6, ZF, ZS, 'block'),
  box('under-gap', XW1, XE0, -0.2, 2.6, ZF, ZS, 'block'),
  // 천장: 꼭대기 위, 맨 위
  box('ceil-top', XW0, XE1, 5.4, 5.6, ZF, ZS, 'white'),
  box('ceil', XW0, XE1, TOP - 0.2, TOP, ZN, ZS, 'white'),
  // 벽 — 서쪽(x 0), 공간마다
  box('w-w1', -0.2, 0, 2.6, 5.6, ZF, ZS + 0.2, 'block'),
  box('w-w1b', -0.2, 0, 5.6, TOP, ZF, ZS + 0.2, 'block'),
  box('w-w2', -0.2, 0, -0.2, TOP, ZM, ZF, 'block'),
  box('w-w3', -0.2, 0, -0.2, LM2 - 0.2, ZN - 0.2, ZM, 'block'),
  box('w-w3b', -0.2, 0, LM2 - 0.2, TOP, ZN - 0.2, ZM, 'block'),
  // 동쪽(x 2.6)
  box('w-e1', XE1, XE1 + 0.2, -0.2, 2.6, ZF, ZS + 0.2, 'block'),
  box('w-e1b', XE1, XE1 + 0.2, 2.6, 5.6, ZF, ZS + 0.2, 'block'),
  box('w-e1c', XE1, XE1 + 0.2, 5.6, TOP, ZF, ZS + 0.2, 'block'),
  box('w-e2', XE1, XE1 + 0.2, -0.2, 2.75, ZM, ZF, 'block'),
  box('w-e2b', XE1, XE1 + 0.2, 2.75, TOP, ZM, ZF, 'block'),
  box('w-e3', XE1, XE1 + 0.2, -0.2, LM2 - 0.2, ZN - 0.2, ZM, 'block'),
  box('w-e3b', XE1, XE1 + 0.2, LM2 - 0.2, TOP, ZN - 0.2, ZM, 'block'),
  // 북쪽(z -4.1)
  box('w-n', -0.2, XE1 + 0.2, -0.2, LM2 - 0.2, ZN - 0.2, ZN, 'block'),
  box('w-nb', -0.2, XE1 + 0.2, LM2 - 0.2, TOP, ZN - 0.2, ZN, 'block'),
  // 남쪽(z 1.0): 시작 칸(쾅 닫힌 문 구멍 x 1.56~2.44, 높이 2.05) · 꼭대기 · 그 위
  box('w-s1', XE0, 1.56, -0.2, 2.6, ZS, ZS + 0.2, 'block'),
  box('w-s2', 2.44, XE1, -0.2, 2.6, ZS, ZS + 0.2, 'block'),
  box('w-s3', 1.56, 2.44, 2.05, 2.6, ZS, ZS + 0.2, 'block'),
  // (11/20 7단계 변경) ~~w-s4 한 장~~ → congratulations! 문 구멍을 둘러 네 조각(구멍 아래 조각은 밟는 상자 — 문턱을 걸어 지나가요)
  // (11/20 폰 점검 뒤 고침, 사용자 의견: 꼭대기 오른쪽 모퉁이에 검은 띠 / 마지막 바퀴엔 문 오른편에 흰 공간) ~~x -0.2부터~~ → 0부터:
  //   -0.2부터면 이 조각(폭 35cm)의 한가운데가 서쪽 벽 속(x < 0)이라 방 쪽 면이 안 만들어져(13-5 규칙) 그 너머가 비쳤어요. 모퉁이는 서쪽 벽 w-w1이 메워요
  box('w-s4a', 0, HOLE.x0, 2.6, 5.6, ZS, ZS + 0.2, 'block'),
  box('w-s4b', HOLE.x1, XE1 + 0.2, 2.6, 5.6, ZS, ZS + 0.2, 'block'),
  box('w-s4c', HOLE.x0, HOLE.x1, HOLE.y1, 5.6, ZS, ZS + 0.2, 'block'),
  box('w-s4d', HOLE.x0, HOLE.x1, 2.6, LT, ZS, ZS + 0.2, 'block', W),
  box('w-s5', -0.2, XE1 + 0.2, 5.6, TOP, ZS, ZS + 0.2, 'block'),
  // 가운데 틈: 보이지 않는 벽(난간 자리)
  box('gap-ghost', XW1, XE0, -1, 8, ZM, ZF, 'block', { ghost: true }),
  // (11/20 7단계 추가 · 2차 변경) 문 너머 하얀 공간: ~~바닥(밟는 상자)~~ 바닥 없음(문턱을 넘으면 떨어지는 연출 — stairs.ts FALL) + 보이지 않는 벽.
  //   등이 없어서 빛을 굽지 않아요(계단실로 빛이 새지 않음). 끝없이 하얀 곳처럼 보이게 면들은 모두 스스로 빛나는 같은 흰색 판(voidProps)
  box('void-gw', VOID.x0 - 0.2, VOID.x0, LT, LT + VOID.h, VOID.z0, VOID.z1, 'block', { ghost: true }),
  box('void-ge', VOID.x1, VOID.x1 + 0.2, LT, LT + VOID.h, VOID.z0, VOID.z1, 'block', { ghost: true }),
  box('void-gn', VOID.x0, VOID.x1, LT, LT + VOID.h, VOID.z1, VOID.z1 + 0.2, 'block', { ghost: true }),
];

/**
 * 등(구운 빛): 시작 칸·계단참·꼭대기·다음 계단참 천장에 하나씩. 계단 줄은 계단참 등의 빛으로 어둑하게.
 * (11/20 2차 변경, 사용자 의견) ~~어둑한 초록빛 형광등~~ → 푸르스름한 흰 형광등을 더 어둡게. 다음 계단참(맨 위) 등은 아주 약하게 —
 * 계속 올라가는 계단이 어둠 속으로 사라져요. 화면 노출도 낮춰요(STAIR_EXPOSURE)
 */
const TUBE = '#dbe4ef';
export const STAIR_LAMPS: Lamp[] = [
  { at: [2.0, 2.58, 0.15], size: [0.16, 0.7], power: 0.75, color: TUBE },
  { at: [1.3, LM2 - 0.22, -3.4], size: [0.7, 0.16], power: 0.95, color: TUBE },
  { at: [1.3, 5.38, 0.2], size: [0.7, 0.16], power: 0.7, color: TUBE },
  { at: [1.3, TOP - 0.22, -3.4], size: [0.5, 0.12], power: 0.15, color: TUBE },
];

/** (11/20 2차 추가) 계단실 화면 노출 배율 — 자동 노출이 어두운 곳을 밝게 끌어올리는 만큼 눌러서 어둡고 섬뜩하게(Room.exposure) */
export const STAIR_EXPOSURE = 0.6;

/** 면을 만들 때 위아래를 찾는 거리 — 7m 높이라 늘려요(build.ts reach) */
export const STAIR_REACH = 12;
/** (11/20 2차 추가) 여러 번 튕긴 빛 어림값 배율 — 줄여서 등 빛이 닿지 않는 계단 줄·구석이 어둡게(bake.ts amb) */
export const STAIR_AMB = 0.3;

export const STAIR_SPAWNS: Record<string, Spawn> & { start: Spawn } = {
  start: { at: [2.0, 0, 0.35], yaw: 0 }, // 계단 A를 바라봄(쾅 닫힌 문은 등 뒤)
  // 개발용 바로가기(?spawn=)
  landing: { at: [2.0, LM, -3.2], yaw: 0 },
  top: { at: [0.6, LT, -0.3], yaw: 180 }, // 꼭대기에서 남쪽(문 자리)을 바라봄
};

/** 난간: 계단 A·B·A' 안쪽(틈 쪽) + 계단참·꼭대기의 틈 끝 짧은 막대. 손잡이 높이 0.9m(디딤 앞 끝에서) */
export const STAIR_RAILS: Rail[] = [
  { from: [1.43, R + 0.9, ZF], to: [1.43, LM + 0.9, ZM] },
  { from: [1.17, LM + R + 0.9, ZM], to: [1.17, LT + 0.9, ZF] },
  { from: [1.43, LT + R + 0.9, ZF], to: [1.43, LM2 + 0.9, ZM] },
  { from: [1.17, LM + 0.9, ZM - 0.03], to: [1.43, LM + 0.9, ZM - 0.03], posts: false },
  { from: [1.17, LT + 0.9, ZF + 0.03], to: [1.43, LT + 0.9, ZF + 0.03], posts: false },
];

/** 쾅 닫힌 문(다시 안 열림) — 잠긴 문 너머 계단실 입구와 같은 흰 문 + 둥근 손잡이 */
export const SLAM_DOOR: Part = {
  id: 'door',
  boxes: [{ id: 'd', at: [2.0, 1.025, 0.975], size: [0.88, 2.05, 0.05], mat: 'white' }],
  knob: [{ at: [1.69, 1.0, 0.95], face: 'z-' }],
};

/**
 * 꼭대기 congratulations! 문(남쪽 벽 서쪽, 계단 B를 다 올라오면 정면 — 영상처럼 왼쪽에 난간 기둥, 오른쪽에 벽). when = 나타나는 조건.
 * (11/20 2차 변경, 사용자 의견: 갈색 말고 깔끔한 흰색 칠 철문, 신비로운 느낌) ~~갈색 나무 문 + 검은 문틀~~ → 흰 철문 + 흰 문틀 + 은색 손잡이.
 * 문틈(양옆·위·바닥 1.2cm)으로 차가운 흰빛이 가늘게 새어 나와요 — 문 너머 하얀 공간(영상 01:42~)의 복선
 */
const DOOR_LIGHT = '#dfe9ff';
/** (11/20 7단계) 하얀 공간의 색 — 스스로 빛나는 판이라 모서리가 안 보여 끝없이 하얘 보여요 */
const VOID_WHITE = '#f6f8ff';
/** (11/20 3차) 하얀 공간·문틈 빛의 밝기 배율(흰색보다 몇 배) */
const VOID_POWER = 10;

/**
 * (11/20 7단계 변경) 문을 세 덩어리로: part = 흰 문틀(when에 나타남), leaf = 흰 철문 + 은색 손잡이(경첩을 축으로 하얀 공간 쪽으로 열려요),
 * props = 홀로그램 글씨 + 벽 구멍 속 빛(문틈으로 새어 나오는 빛 — 전엔 문틈마다 가는 판이었는데 이제 진짜 구멍 너머의 빛).
 *   open = 문이 열리는 조건(그때 글씨와 구멍 속 빛은 꺼지고 그 너머 하얀 공간과 검은 통로가 보여요). (11/20 2차) ~~gone~~ 떨어지는 연출로 바뀌어 뺌
 */
export function congratsDoor(when?: Cond, open?: Cond): { part: Part; leaf: Part; props: Prop[] } {
  const y0 = LT, x = CONGRATS_X, HW = DHW, H = DH, G = DG; // 문 반폭, 높이, 문틈
  const zf = ZS - 0.055; // 문 앞면
  const and = (...c: (Cond | undefined)[]): Cond | undefined => { const l = c.filter(Boolean) as Cond[]; return l.length ? { all: l } : undefined; };
  const closed = and(when, open && { not: open });
  return {
    part: {
      id: 'congrats-door', when, swap: 'unseen',
      boxes: [
        // (11/20 7단계) ~~문틈 뒤 금속 판 cd-back~~ → 벽에 진짜 구멍(그 속에 빛 판)
        box('cd-l', x - HW - G - 0.06, x - HW - G, y0, y0 + H + G + 0.06, ZS - 0.07, ZS, 'white'), // 흰 문틀
        box('cd-r', x + HW + G, x + HW + G + 0.06, y0, y0 + H + G + 0.06, ZS - 0.07, ZS, 'white'),
        box('cd-t', x - HW - G, x + HW + G, y0 + H + G, y0 + H + G + 0.06, ZS - 0.07, ZS, 'white'),
        // (11/20 4차, 사용자 의견: 문 위의 정체불명 검은 박스 삭제) ~~도어 클로저(영상의 작은 상자) cd-c~~
      ],
    },
    leaf: {
      // 흰 철문(바닥에서 1.2cm 떠 있어 아래로도 빛이 새요). 경첩은 손잡이 반대쪽(문을 바라볼 때 왼쪽, x+), 하얀 공간 쪽(+z)으로 밀려 열려요
      id: 'congrats-leaf', when: open ? { not: open } : undefined, show: when,
      swap: 'swing', ms: 2600, swing: { hinge: [x + HW, ZS - 0.02], deg: 100 },
      boxes: [box('cd', x - HW, x + HW, y0 + G, y0 + H, zf, ZS - 0.02, 'white')],
      knob: [{ at: [x - 0.34, y0 + 1.0, zf], face: 'z-' }], // 은색 손잡이(문을 바라볼 때 오른쪽)
    },
    props: [
      {
        // 홀로그램 글씨 — 문이 열리기 시작하면 꺼져요(문과 같이 돌지 않아서)
        id: 'congrats', plane: [0.84, 0.84 * (281 / 1024)], at: [x, y0 + 1.55, zf - 0.002], face: 'z-',
        skin: { holo: 'media/stairs/congrats.webp', glow: 'media/stairs/congrats-glow.webp' }, when: closed, swap: open ? undefined : 'unseen',
      },
      // 벽 구멍 속 빛: 닫힌 문의 틈(양옆·위·바닥)으로 가늘게 보여요. 문이 열리면 꺼지고 그 너머의 하얀 공간이 같은 빛으로 이어져요
      // (11/20 폰 점검 뒤 고침, 사용자 의견: 문틈 빛이 사라짐) ~~구멍 한가운데(벽 속 10cm)~~ → 문짝 바로 뒤(3mm)에, 구멍보다 사방 4cm 크게:
      //   깊이 있으면 비스듬히 볼 때 1.2cm 틈 너머로 빛 판이 아니라 구멍의 어두운 옆벽이 보였어요. 넓힌 가장자리는 문틀(6cm)·바닥 속에 숨어요
      { id: 'cd-glow', plane: [HOLE.x1 - HOLE.x0 + 0.08, HOLE.y1 - LT + 0.08], at: [x, (LT + HOLE.y1) / 2, ZS - 0.017], face: 'z-', skin: { color: DOOR_LIGHT }, lit: false, when: closed, power: VOID_POWER },
      // (11/20 폰 점검 뒤 추가) 문틈마다 가는 빛 선(6단계 14-11처럼, 문짝 앞면 바로 앞): 문짝 두께(3.5cm) 때문에 비스듬히 보면 1.2cm 틈이
      //   거의 가려져 구멍 속 빛이 점으로만 보였어요. 양옆·위·바닥
      ...([
        ['cd-gl', [G, H + G], [x - HW - G / 2, y0 + (H + G) / 2]],
        ['cd-gr', [G, H + G], [x + HW + G / 2, y0 + (H + G) / 2]],
        ['cd-gt', [2 * HW + 2 * G, G], [x, y0 + H + G / 2]],
        ['cd-gb', [2 * HW, G], [x, y0 + G / 2]],
      ] as const).map(([id, plane, [px, py]]): Prop => ({ id, plane: [plane[0], plane[1]], at: [px, py, zf - 0.001], face: 'z-', skin: { color: DOOR_LIGHT }, lit: false, when: closed })),
    ],
  };
}

/** (11/20 7단계 추가) 루프 동안 문 구멍을 막는 마개(벽과 같은 블록) */
export function doorPlug(when?: Cond): Part {
  return { id: 'door-plug', when, swap: 'unseen', boxes: [box('plug', HOLE.x0, HOLE.x1, LT, HOLE.y1, ZS, ZS + 0.2, 'block')] };
}

/**
 * (11/20 7단계 추가) 하얀 공간의 면: 바닥·천장·세 벽·문 쪽 벽 바깥(문 구멍만 비움) — 모두 스스로 빛나는 같은 흰색이라 모서리가 안 보여요.
 * gone = 들어선 뒤 돌아보면 문 구멍까지 하얗게 메워짐(안 보는 사이에) — 돌아갈 곳이 없어요
 */
export function voidProps(when?: Cond): Prop[] {
  const cx = (VOID.x0 + VOID.x1) / 2, cz = (VOID.z0 + VOID.z1) / 2, w = VOID.x1 - VOID.x0, d = VOID.z1 - VOID.z0;
  const z = VOID.z0 + 0.003, top = LT + VOID.h, bot = LT - VOID.deep, h = top - bot, my = (top + bot) / 2;
  // (11/20 3차) 흰 면은 흰색보다 10배 밝게(power) — 화면 노출을 올리지 않아도 하얗게 날아가요. 검은 통로는 그대로 검게
  const p = (id: string, plane: [number, number], at: V3, face: Prop['face'], color = VOID_WHITE): Prop => ({ id, plane, at, face, skin: { color }, lit: false, when, power: color === VOID_WHITE ? VOID_POWER : undefined });
  // 검은 통로(허공에 떠 있음): 안쪽 네 면 + 막다른 끝. 아주 어두운 색을 조금씩 달리해 깊이가 느껴지게(하얗게 날아가는 노출에도 검게)
  const hx = CONGRATS_X, hz = HALL.z + HALL.d / 2;
  return [
    p('v-bottom', [w, d], [cx, bot, cz], 'y+'), // 떨어져도 닿지 않는 저 아래
    p('v-ceil', [w, d], [cx, top, cz], 'y-'),
    p('v-far', [w, h], [cx, my, VOID.z1], 'z-'),
    p('v-w', [d, h], [VOID.x0, my, cz], 'x+'),
    p('v-e', [d, h], [VOID.x1, my, cz], 'x-'),
    // 문 쪽 벽 바깥(돌아보면·떨어지며 보이는 면): 문 구멍 둘레 + 문턱 아래
    p('v-back-l', [HOLE.x0 - VOID.x0, h], [(VOID.x0 + HOLE.x0) / 2, my, z], 'z+'),
    p('v-back-r', [VOID.x1 - HOLE.x1, h], [(HOLE.x1 + VOID.x1) / 2, my, z], 'z+'),
    p('v-back-t', [HOLE.x1 - HOLE.x0, top - HOLE.y1], [CONGRATS_X, (HOLE.y1 + top) / 2, z], 'z+'),
    p('v-back-b', [HOLE.x1 - HOLE.x0, LT - 0.2 - bot], [CONGRATS_X, (LT - 0.2 + bot) / 2, z], 'z+'),
    p('hall-end', [HALL.w, HALL.h], [hx, LT + HALL.h / 2, HALL.z + HALL.d], 'z-', '#000000'),
    p('hall-l', [HALL.d, HALL.h], [hx - HALL.w / 2, LT + HALL.h / 2, hz], 'x+', '#141418'),
    p('hall-r', [HALL.d, HALL.h], [hx + HALL.w / 2, LT + HALL.h / 2, hz], 'x-', '#141418'),
    p('hall-f', [HALL.w, HALL.d], [hx, LT, hz], 'y+', '#101013'),
    p('hall-c', [HALL.w, HALL.d], [hx, LT + HALL.h, hz], 'y-', '#060608'),
  ];
}

/** (11/20 2차 추가) 마지막 바퀴(0-4를 지난 뒤): 다음 계단 A' 자리를 벽으로 막아요 — 루프가 끝나 꼭대기에서 갈 곳은 문뿐(14-1 "이 자리가 막히고") */
export function topWall(when?: Cond): Part {
  return { id: 'top-wall', when, swap: 'unseen', boxes: [box('tw', XE0, XE1, LT, 5.4, ZF - 0.05, ZF, 'block')] };
}

/** 계단참 북쪽 벽: 층 표시판(0-n)과 영어 안내판 — 짙은 초록 판에 흰 글씨(건물 표지판, 사용자 결정) */
const PLATE = { bg: '#1d4a35', fg: '#f1f2ea' };
export const FLOOR_PLATE_AT: V3 = [2.05, 3.0, ZN + 0.006];
export function floorPlate(n: number, when?: Cond): Prop {
  return { id: `plate-${n}`, plane: [0.34, 0.2], at: FLOOR_PLATE_AT, face: 'z+', skin: { sign: [`0-${n}`], ...PLATE }, when, swap: 'unseen' };
}
export const ENGLISH_SIGN: Prop = {
  id: 'rule-sign', plane: [0.94, 0.33], at: [1.0, 2.97, ZN + 0.006], face: 'z+',
  skin: { sign: ['IF SOMETHING IS OUT OF PLACE,', 'GO BACK DOWN.', 'IF NOT, KEEP CLIMBING.'], ...PLATE },
};

/** 형광 포스트잇 색(0-4 테이프 흔적) */
const NEON = [...Array<string>(5).fill('#c4f24e'), ...Array<string>(4).fill('#ff3ea5'), '#ff9b30', '#ffe23a'];

/**
 * 0-2 이상현상 — (11/20 2차 변경, 사용자 의견: 너무 대놓고 붙어 있음 → 유심히 살펴봐야 알아채게)
 * ~~안내판 둘레의 형광 포스트잇 한 무리(약 30~40장)~~ → 보호색 포스트잇 7장: 표지판 위엔 표지판과 같은 짙은 초록 종이(안내문 글자 끝을 살짝 가림),
 * 벽엔 벽과 같은 흰 종이. 멀리선 안 보이고 가까이 가야 종이 가장자리 그늘·손글씨가 보여요. 형광처럼 빛나지 않게(glow 1)
 */
const SIGN_Z = ZN + 0.009, WALL_Z = ZN + 0.001; // 표지판 앞 / 벽 바로 앞
const one = (x: number, y: number, z: number) => ({ face: 'z+' as const, at: [x, y, z] as V3, size: [0.07, 0.07] as [number, number] }); // 종이 딱 한 장 자리
export function postitCluster(when?: Cond): Scatter[] {
  return [
    {
      id: 'hide-sign', note: 0.076, colors: [PLATE.bg], seed: 202, chunk: 3, glow: 1, when, swap: 'unseen',
      areas: [one(1.13, 2.965, SIGN_Z), one(1.4, 3.085, SIGN_Z), one(0.66, 2.87, SIGN_Z), one(2.165, 2.94, SIGN_Z)], // "DOWN."의 끝 · "PLACE,"의 끝 · "IF"의 앞 · 층 표시 구석
    },
    {
      id: 'hide-wall', note: 0.076, colors: ['#d3d7d9'], seed: 203, chunk: 3, glow: 1, when, swap: 'unseen', // 벽(MATS.block)과 같은 색
      areas: [one(0.3, 3.3, WALL_Z), one(1.7, 2.78, WALL_Z), one(2.42, 3.22, WALL_Z)],
    },
  ];
}

/**
 * 0-4 이상현상(테이프에만): 방금 걸어 올라온 길에 앞 방들의 흔적 — 시작 칸·계단 A 벽의 형광 포스트잇, 손자국, 바닥에 흩어진 열쇠.
 * (11/20 2차 추가, 사용자 의견: 계단에만 있어 아쉬움) 0-4 표지판이 있는 계단참 벽·바닥에도 — 표지판 둘레를 빼곡히 덮은 포스트잇,
 * 표지판 위의 흰 손자국, 계단참 바닥의 열쇠(층 표시 0-4는 가리지 않아요).
 * 라이브 화면엔 없고 되감은 테이프에만 찍혀 있어요(layer: 'tape', 설계서의 tapeOnly). when = 그 시각의 바퀴(테이프는 그 시각 상태로 검사)
 * 손자국은 포스트잇보다 앞(벽에서 1.2cm)에 붙여 서로 깜빡이지 않게.
 */
export function tapeTraces(when?: Cond): { scatter: Scatter; props: Prop[] } {
  const N = ZN + 0.012; // 계단참 북쪽 벽 손자국 자리(포스트잇·표지판보다 앞)
  const hands: [V3, Prop['face'], number, string][] = [
    // 시작 칸·계단 A
    [[XE0 + 0.004, 1.35, 0.55], 'x+', 14, '#1e6bff'], [[XE0 + 0.004, 1.05, 0.05], 'x+', -18, '#14e07e'],
    [[XE0 + 0.004, 1.6, -0.25], 'x+', 6, '#ff2e96'], [[XE1 - 0.012, 1.5, 0.45], 'x-', -10, '#f2ac00'],
    [[XE1 - 0.012, 1.15, -0.1], 'x-', 22, '#a64dff'], [[2.3, 1.45, ZS - 0.012], 'z-', -8, '#262423'],
    [[XE1 - 0.012, 2.05, -1.6], 'x-', 12, '#1e6bff'], [[XE1 - 0.012, 2.3, -2.3], 'x-', -16, '#ececec'],
    // (2차) 계단참: 북쪽 벽(표지판 둘레·영어 안내판 위), 동쪽·서쪽 벽
    [[0.3, 2.35, N], 'z+', 10, '#14e07e'], [[1.66, 3.42, N], 'z+', -14, '#ff2e96'], [[2.42, 2.5, N], 'z+', 18, '#1e6bff'],
    [[1.28, 3.0, N], 'z+', -6, '#ececec'], [[XE1 - 0.012, 2.6, -3.3], 'x-', 8, '#f2ac00'], [[0.012, 2.75, -3.55], 'x+', -12, '#a64dff'],
  ];
  const props: Prop[] = hands.map(([at, face, tilt, tint], i) => ({
    id: `trace-hand${i}`, plane: [0.25, 0.3], at, face, tilt, mirror: i % 2 ? true : undefined,
    skin: { img: 'media/warm/hand.webp' }, blend: 'alpha', tint, lit: false, edge: 0.45, when, layer: 'tape', group: 'trace-hands',
  }));
  // 바닥에 흩어진 열쇠(시작 칸·첫 디딤, (2차) 계단참)
  const keys: [number, number, number, number][] = [
    [1.75, 0.003, 0.15, 30], [2.25, 0.003, 0.5, -60], [1.95, 0.003, -0.25, 100], [2.35, R + 0.003, -0.75, 15], [1.6, 0.003, 0.7, -20], [2.1, 2 * R + 0.003, -1.05, 70],
    [1.9, LM + 0.003, -2.95, 40], [2.3, LM + 0.003, -3.35, -30], [1.45, LM + 0.003, -3.65, 120], [0.7, LM + 0.003, -3.2, -75],
  ];
  keys.forEach(([x, y, z, tilt], i) => props.push({
    id: `trace-key${i}`, plane: [0.16, 0.07], at: [x, y, z], face: 'y+', tilt, skin: { gen: i === 2 ? 'key-red' : 'key' }, blend: 'alpha', when, layer: 'tape',
  }));
  const W0 = ZN + 0.003; // 계단참 북쪽 벽 포스트잇 자리
  return {
    scatter: {
      id: 'trace-postits',
      areas: [
        { face: 'x-', at: [XE1 - 0.004, 1.05, 0.2], size: [1.6, 1.3] }, // 시작 칸 동쪽 벽
        { face: 'x-', at: [XE1 - 0.004, 1.15, -1.65], size: [2.1, 1.2] }, // 계단 A 동쪽 벽(아래쪽은 디딤 속에 묻혀 안 보여요)
        { face: 'z-', at: [1.6, 1.6, ZS - 0.004], size: [0.4, 1.0] }, // 문 옆
        // (2차) 계단참 북쪽 벽: 표지판(안내판 x 0.53~1.47, 층 표시 1.88~2.22, 높이 2.8~3.14) 둘레를 빼곡히
        { face: 'z+', at: [1.3, 2.17, W0], size: [2.5, 1.1] }, // 표지판 아래
        { face: 'z+', at: [1.3, 3.6, W0], size: [2.5, 0.56] }, // 표지판 위
        { face: 'z+', at: [0.27, 2.98, W0], size: [0.46, 0.5] }, // 안내판 왼쪽
        { face: 'z+', at: [1.67, 2.98, W0], size: [0.34, 0.5] }, // 안내판과 층 표시 사이
        { face: 'z+', at: [2.41, 2.98, W0], size: [0.3, 0.5] }, // 층 표시 오른쪽
      ],
      note: 0.076, colors: NEON, seed: 404, chunk: 1.2, when, layer: 'tape',
    },
    props,
  };
}

/** 판정에 쓰는 바닥 영역(높이도 봐요): 계단참에 올라섬 / 시작 칸으로 되돌아 내려옴 / 다음 계단 A'를 밟음 / 0-4 계단 A 중간 */
export const ZONE_AT: Record<'m' | 'down' | 'up' | 'mid', Pick<Zone, 'at' | 'size' | 'into'>> = {
  // (11/20 폰 점검 뒤 고침, 사용자 의견: 0-4에서 계단참을 살짝만 밟고 내려가면 안 넘어감) ~~z -4.1~-2.8~~ → 계단참 가장자리(-2.7)를 조금 넘어
  //   마지막 디딤 끝(-2.62)부터: 몸 가운데가 계단참에 막 올라선 순간부터 "올라섬"
  m: { at: [1.3, LM, (ZN + ZM + 0.08) / 2], size: [2.6, 0.6, ZM + 0.08 - ZN] },
  down: { at: [2.0, 0, 0.2], size: [1.2, 0.6, 1.4], into: 'z+' },
  up: { at: [2.0, LT + 0.2, -0.85], size: [1.2, 0.7, 0.5], into: 'z-' },
  mid: { at: [2.0, 0.7, -1.65], size: [1.2, 1.0, 0.6], into: 'z-' },
};
