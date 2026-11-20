import type { Action, Box, Cond, LiveLamp, Prop, Room, V3 } from '../schema.ts';

/**
 * (11/19 6단계 추가) 개발용 추격 시험 방 — http://localhost:5173/?room=chasetest&dev (개발 미리보기에서만, 배포 빌드엔 안 들어가요. 저장 안 남김)
 * 잠긴 문을 짓기 전에 위험한 새 기능 세 가지를 작게 먼저 시험해요(사용자 요청: 폰에서도 되는지 확인하고 쓰기).
 *   ① 등 뒤 빛이 바닥에 드리움: 켜고 끄는 등(Room.live) — 복도 끝부터 하나씩 켜지면 문 앞 바닥이 밝아지고, 내 그림자가 앞으로 뻗어요
 *   ② "뒤를 보는 중" 판정: 뒤쪽 복도(seen 대상)가 화면에 보이는 동안 타이머가 4배 빨리(Timer.faster). 개발용 표시에 "뒤를 봄(빨리)"
 *   ③ 등 뒤에서 들리는 쿵: 등이 켜질 때마다 그 등 자리에서 쿵(입체 음향 — 등 뒤면 먹먹하고, 돌아보면 또렷)
 * 크기는 실제 창밖 복도와 같아요(길이 6.1m, 폭 1.3m). 바닥 열쇠는 불이 2칸 넘게 켜져야 빨간 점이 보여요.
 *
 *   x=0                                                     x=6.1
 *   ┌──────────────────────────────────────────────────────┐
 *   │ ①       ②       ③(복도 등)  ④        ⑤   ◎문 위 등  ● →▮ 문
 *   │ ← 불이 복도 끝부터 하나씩 다가옴                    (열쇠) ▮
 *   └──────────────────────────────────────────────────────┘
 */

const H = 2.6;
const Z0 = -0.65, Z1 = 0.65; // 복도 안쪽 폭 1.3m
const END = 6.1; // 문이 달린 끝 벽
const DOOR_Z = 0.44; // 문 반폭

const wall = (id: string, x0: number, x1: number, z0: number, z1: number, mat: Box['mat'], y0 = 0, y1 = H): Box => ({
  id, at: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0], mat,
});

const boxes: Box[] = [
  wall('floor', -0.2, 4.6, Z0 - 0.2, Z1 + 0.2, 'carpet', -0.2, 0),
  wall('floor-door', 4.6, END + 0.2, Z0 - 0.2, Z1 + 0.2, 'gray', -0.2, 0), // 문 앞: 은색 열쇠가 또렷하게 읽히는 무늬 적은 회색(점박이는 열쇠가 묻혀서)
  wall('ceil', -0.2, END + 0.2, Z0 - 0.2, Z1 + 0.2, 'white', H, H + 0.2),
  wall('w-left', -0.2, END + 0.2, Z0 - 0.2, Z0, 'gray'),
  wall('w-right', -0.2, END + 0.2, Z1, Z1 + 0.2, 'gray'),
  wall('w-back', -0.2, 0, Z0, Z1, 'gray'),
  wall('w-end-a', END, END + 0.2, Z0, -DOOR_Z, 'gray'),
  wall('w-end-b', END, END + 0.2, DOOR_Z, Z1, 'gray'),
  wall('w-end-top', END, END + 0.2, -DOOR_Z, DOOR_Z, 'gray', 2.05, H),
  // 잠긴 문(흰 문 + 둥근 은색 손잡이 — 영상처럼)
  { id: 'door', at: [END - 0.025, 1.025, 0], size: [0.05, 2.05, 0.88], mat: 'white' },
  { id: 'knob', at: [END - 0.07, 1.0, 0.3], size: [0.07, 0.07, 0.07], mat: 'metal', solid: false },
  { id: 'knob-rose', at: [END - 0.055, 1.0, 0.3], size: [0.012, 0.1, 0.1], mat: 'metal', solid: false },
];

const CHASE: Cond = { flag: 'chase' };
const lit = (n: number): Cond => ({ count: 'lights', gte: n });
const only = (n: number): Cond => ({ all: [lit(n), { not: lit(n + 1) }] });

/** 복도 끝부터 다가오는 불 ①~⑤(그림자를 드리움) + 추격 전에만 켜진 복도 등·문 위 등 */
const CHASE_X = [0.6, 1.7, 2.8, 3.9, 5.0];
const LAMP_Y = H - 0.02;
const lamps: LiveLamp[] = [
  { id: 'hall', at: [2.9, LAMP_Y, 0], size: [1.1, 0.16], power: 1.5, color: '#e6eeff', when: { not: CHASE } },
  { id: 'door', at: [5.6, LAMP_Y, 0], size: [0.5, 0.16], power: 0.9, color: '#e6eeff', when: { not: CHASE } },
  ...CHASE_X.map((x, i): LiveLamp => ({ id: `c${i + 1}`, at: [x, LAMP_Y, 0], size: [0.9, 0.14], power: 4.5, color: '#eef3ff', when: lit(i + 1), shadow: true })),
];

/** 바닥 열쇠(시험용 — 무더기 헤치기는 실제 방에서). 빨간 점은 불이 2칸 넘게 켜져야 보여요 */
const KEYS: [number, number, number][] = [
  [5.72, -0.08, 20], [5.8, 0.06, -35], [5.66, 0.14, 70], [5.86, -0.16, 120], [5.6, -0.02, -80], [5.78, 0.22, 10],
  [5.92, 0.02, 160], [5.7, -0.24, 45], [5.55, 0.2, -10], [5.95, -0.08, 95],
];
const key = (id: string, x: number, z: number, deg: number, gen: 'key' | 'key-red' | 'key-dull', when?: Cond, y = 0.004): Prop => ({
  id, plane: [0.1, 0.044], at: [x, y, z], face: 'y+', tilt: deg, skin: { gen }, blend: 'alpha', when,
});
const props: Prop[] = [
  ...KEYS.map(([x, z, d], i) => ({ ...key(`k${i}`, x, z, d, 'key'), group: 'keys' })),
  key('red', 5.76, -0.03, -55, 'key-red', lit(2), 0.006),
  key('red-dark', 5.76, -0.03, -55, 'key-dull', { not: lit(2) }, 0.006),
];

/** 등이 켜질 때: 그 등 자리에서 쿵 + 형광등 켜지는 소리 */
const onLight = (n: number): Action => ({
  do: 'if', when: only(n), then: [{ do: 'sound', sound: 'sfx.thud', at: [CHASE_X[n - 1], 1.2, 0] as V3 }],
});

export const chasetest: Room = {
  id: 'chasetest',
  title: '추격 시험 방(개발용)',
  vhs: 0.25,
  dev: true,
  tape: { offWhen: CHASE },
  space: { boxes, lamps: [] }, // 구운 빛은 은은한 바탕만 — 빛은 전부 켜고 끄는 등으로
  live: { lamps, box: [[-0.05, -0.05, Z0 - 0.05], [END + 0.05, H + 0.05, Z1 + 0.05]], dim: { when: CHASE, level: 0.12 } },
  spawns: { start: { at: [5.45, 0, 0], yaw: -90 } }, // 문을 바라봄(+x)
  props,
  targets: [
    {
      id: 'knob',
      label: '손잡이 — 누르면 추격 시작(시험)',
      at: [END - 0.07, 1.0, 0.3],
      size: [0.14, 0.16, 0.16],
      on: 'click',
      maxDist: 1.7,
      once: true,
      block: true,
      do: [
        { do: 'sound', sound: 'sfx.try2' },
        { do: 'set', flag: 'chase' },
        { do: 'sound', sound: 'sfx.lightsout' },
        { do: 'goal', text: '시험 · 뒤를 보면 불이 빨리 다가옴 · 불 2칸부터 빨간 점' },
        { do: 'wait', ms: 700 },
        { do: 'sound', sound: 'sfx.thud', at: [0.2, 1.2, 0] },
        { do: 'sound', sound: 'sfx.alarm' },
        { do: 'timer', timer: 'chase' },
      ],
    },
    {
      // "뒤를 보는 중": 뒤쪽 복도가 화면 안쪽에 가리지 않고 보이는 동안(반응은 안 함 — 타이머가 이걸 봐요)
      id: 'back', label: '뒤쪽 복도(뒤를 보는 중 판정)', on: 'seen', when: CHASE,
      at: [2.4, 1.3, 0], size: [4.0, 1.6, 1.0], maxDist: 12, dwellMs: 1e9, do: [],
    },
    {
      id: 'red-key', label: '빨간 점 열쇠(시험: 줌 1.5배 이상 + 누르기)', at: [5.76, 0.02, -0.03], size: [0.12, 0.06, 0.08],
      on: 'zoom', minZoom: 1.5, dwellMs: 400, maxDist: 2, when: lit(2), once: true,
      do: [{ do: 'timer', timer: 'chase', stop: true }, { do: 'sound', sound: 'sfx.redkey' }, { do: 'stop', sound: 'sfx.alarm', fadeMs: 600 }, { do: 'osd', text: 'FOUND', ms: 2500 }, { do: 'goal', text: '시험 · 찾음' }],
    },
  ],
  // 불빛이 지나간 자리에 서 있으면 잡힘 → 테이프 씹힘 → 처음부터(⑤가 켜지면 문 앞까지)
  zones: CHASE_X.map((x, i) => ({
    id: `caught${i + 1}`,
    at: [i < 4 ? (x - 0.5 + CHASE_X[i + 1] - 0.5) / 2 : (x - 0.5 + END) / 2, 1, 0] as V3,
    size: [i < 4 ? CHASE_X[i + 1] - x : END - (x - 0.5), 2, Z1 - Z0] as V3,
    when: lit(i + 1),
    enter: [{ do: 'fail' }],
  })),
  timers: {
    // 앞(문)을 보는 동안 5.5초에 한 칸, 뒤를 보는 동안 4배(약 1.4초에 한 칸)
    chase: {
      length: { ms: 5500 },
      faster: { seen: 'back', x: 4 },
      end: [{ do: 'add', count: 'lights' }, { do: 'sound', sound: 'sfx.lightson' }, ...[1, 2, 3, 4, 5].map(onLight), { do: 'timer', timer: 'chase' }],
    },
  },
  enter: [
    { do: 'add', count: 'lights', set: 0 },
    { do: 'hint', text: '추격 시험 방 · 손잡이 누르기', touch: '추격 시험 방 · 손잡이 톡' },
  ],
};
