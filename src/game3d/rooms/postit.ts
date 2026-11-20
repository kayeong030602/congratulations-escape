import type { Box, Cond, Face, Prop, Room, Scatter, Target, V3 } from '../schema.ts';

const H = 2.6;
const Y = H / 2;
const WARM = '#fff3dc';

/**
 * 포스트잇의 방 (최종 영상 23~41초) — 평면도와 흐름은 TECH_DESIGN 11-8·11-9.
 *
 * (11/17 2차 변경, 사용자와 정함 — 원작을 게임으로 각색)
 *   들어오면 화면 위에 "누군가의 색을 좇다 보면, 자신의 색을 잃는다." + 빈 네모 5칸.
 *   흰 종이는 형광 포스트잇에 반쯤 가려져 잘 안 보여요. 방 뒤쪽 왼편 구석의 한 자리(VIEW)에 서서 멀리 보면,
 *   같은 색 포스트잇들이 이어져 착시 화살표가 되고 그 끝에 흰 종이가 있어요(다른 자리에선 흩어진 색 조각이라 안 보임).
 *   (11/17 3차 변경) 맞춰지는 자리를 ~~들어온 자리~~ → 뒤쪽 왼편 구석으로(사용자 의견: 들어가자마자 대놓고 보임)
 *   하나를 찾아야 다음 흰 종이와 다른 색 화살표가 생겨요(안 보는 사이에). 1분이 지나면 두 번째 문구 "무질서한 색들이 한곳을 가리키는 시점이 있다."
 *   ~~들어온 벽의 지지직 문으로 통로에 돌아갈 수 있어요. 정전 뒤에는 문이 없어져요.(11/17 3차 변경)~~
 *   (11/17 5차 변경, 사용자 의견) 들어선 순간부터 지지직 문은 없어요 — 통로로 돌아갈 수 없는 한 방향(순간이동해 온 곳).
 *   5장을 다 찾으면 불이 깜빡이다 전등이 나가는 소리와 함께 암흑 → 3초 뒤 불이 팍 켜지면 포스트잇은 하나도 없고 앞벽에 파란 "and you?" 한 장.
 *   → 누르고 있으면(손 없이) 종이가 떨어져 캠코더 앞으로 와서 뒤집히고 빨간 점 → 가방에.
 *   ~~(11/18 추가) 불이 켜지고 조금 뒤 되감기가 열려요(플래그 tape) + 안내 "R 테이프 되감기"(폰 "◀◀ 눌러 테이프 되감기").~~ (11/21 변경) 여기선 안 열림 → 따뜻한 방에서
 *   되감은 테이프(C안, 사용자 결정): 포스트잇·흰 종이·착시 화살표는 하나도 없는 맨벽(점박이 앞벽)이고,
 *   파란 and you? 한 장만 녹화 첫 장면부터(정전 전에도) 제자리에 붙어 있어요. 정전은 캄캄하게, 뗀 뒤엔 캠코더 앞에 든 채로 찍혀 있어요.
 *   뜻: 남의 색을 좇는 동안 내 질문(파랑 = 나)은 처음부터 거기 있었다 → 따뜻한 방의 "파랑 = 나"로 이어져요.
 *   ~~40초 타이머~~·~~"The exit is behind you."와 뒤돌아보기~~·~~"Please follow the instructions."~~는 뺐어요(사용자 의견: 더 어려워져서 시간 제한이 필요 없고,
 *   뒤를 돌아보라고 하면 진짜 뒤로 가는 문을 찾느라 헤맴 → 대신 정전으로 공포).
 *
 *          z=-2.5 ┌──────── 앞벽(점박이 판) ────────┐
 *                 │ ▒▒▒▒ 포스트잇(앞벽·옆벽·천장) ▒▒▒ │   ○ 둥근 천장등
 *                 │ ▒ ①hurry ②this way ④too late   ▒ │   ③no, that way = 왼쪽 벽, ⑤just follow = 오른쪽 벽
 *           z=0.3 │- - - - - - - - - - - - - - - - -│ ← 여기까지 포스트잇
 *                 │            맨벽                 │   ○ 둥근 천장등
 *                 │  ◎ VIEW(-1.4, 2.0)  ● 시작(z=1.9)  │   ◎ = 착시 화살표가 맞춰지는 자리
 *           z=2.5 └──────── 뒤쪽 맨벽(들어온 벽, 문 없음) ─┘
 *               x=-2                              x=2
 */

/**
 * 착시 화살표가 맞춰지는 자리의 눈 — 방 뒤쪽 왼편 구석(들어온 자리에서 1.5m 옆).
 * 이 자리 ±30cm쯤에서만 천장·옆벽·앞벽의 조각이 이어져 화살표가 되고, 들어온 자리에서는 어긋난 색 조각으로 보여요.
 * (11/17 3차 변경) ~~들어온 자리 [0, 1.5, 1.9]~~ → 구석으로. 화살표 꼬리 각도도 이 자리 기준으로 다시 잡았어요.
 */
const VIEW: V3 = [-1.4, 1.5, 2.0];
const F = -2.5 + 0.011; // 앞벽 표면에서 1cm(포스트잇 위)
const L = -2.0 + 0.011; // 왼쪽 벽
const R = 2.0 - 0.011; // 오른쪽 벽

/** 찾은 흰 종이 수가 n장일 때(정확히). */
const stage = (n: number): Cond => (n === 0
  ? { not: { count: 'whites', gte: 1 } }
  : { all: [{ count: 'whites', gte: n }, { not: { count: 'whites', gte: n + 1 } }] });

/**
 * 흰 종이 다섯 장(찾는 순서대로)과 그것을 가리키는 착시 화살표.
 * from = 화살표 꼬리(들어온 자리에서 본 각도 [좌우, 위아래] 도). 천장·옆벽에서 시작해 벽을 넘어오게 해서 그 자리에서만 이어져 보여요.
 * 색은 화살표마다 달라요(벽 전체에도 조금씩 섞여 있어서 가까이선 티가 안 나요).
 */
const WHITES: { id: string; face: Face; at: V3; tilt: number; plane?: [number, number]; color: string; from: [number, number]; gap?: number }[] = [
  { id: 'hurry', face: 'z+', at: [-1.2, 1.85, F], tilt: -6, color: '#3b8cff', from: [14, 24] }, // 파랑: 천장에서 내려와 앞벽 왼쪽 위
  { id: 'this-way', face: 'z+', at: [1.25, 1.95, F], tilt: 7, color: '#9a5cff', from: [52, -6] }, // 보라: 오른쪽 벽에서 넘어와 앞벽 오른쪽 위
  // 청록: 앞벽에서 왼쪽 벽으로(정말 반대편). (11/17 5차 변경) 구석 자리에서 왼쪽 벽은 비스듬히 스치듯 보여서 화면의 작은 틈이 벽 위에선
  // 50cm 넘게 벌어졌어요(사용자: 화살표 끝과 종이가 너무 멀다) → 종이를 z -1.6 → -0.8(덜 비스듬한 쪽)으로, 화살표 끝이 종이에 살짝 닿게(틈 1.4° → -0.4°)
  { id: 'no-that-way', face: 'x+', at: [L, 1.2, -0.8], tilt: 4, color: '#2fe3d2', from: [12, -8], gap: -0.4 },
  { id: 'too-late', face: 'z+', at: [0.45, 0.55, F], tilt: 2, plane: [0.095, 0.073], color: '#ffe23a', from: [18, 24] }, // 노랑: 천장에서 길게 내려와 앞벽 아래
  { id: 'just-follow', face: 'x-', at: [R, 1.7, -0.9], tilt: -13, color: '#ff9b30', from: [25, 10] }, // 주황: 앞벽에서 오른쪽 벽으로
];

/** 흰 종이 한 장: 소품(그림) + 조준 대상(누르면 메모, 개수 +1). k번째는 앞의 k-1장을 찾아야 생겨요. */
function white(k: number): { prop: Prop; target: Target } {
  const w = WHITES[k];
  const shown: Cond = { all: [{ count: 'whites', gte: k }, { not: { flag: 'gone' } }] };
  return {
    prop: { id: `white-${w.id}`, plane: w.plane ?? [0.085, 0.085], at: w.at, face: w.face, tilt: w.tilt, skin: { img: `media/postit/n-${w.id}.webp` }, when: shown, swap: 'unseen', layer: 'live' },
    target: {
      id: `white-${w.id}`,
      label: `흰 종이 ${k + 1} ${w.id}`,
      at: w.at,
      size: w.face === 'z+' ? [0.22, 0.22, 0.08] : [0.08, 0.22, 0.22], // 누르기 쉽게 종이보다 넉넉히
      on: 'click',
      maxDist: 2.4,
      once: true,
      when: shown,
      do: [
        { do: 'note', note: `white-${w.id}` },
        { do: 'add', count: 'whites' },
      ],
    },
  };
}
const whites = WHITES.map((_, k) => white(k));

const ANDYOU: V3 = [0.1, 1.42, -2.5 + 0.012];

const boxes: Box[] = [
  { id: 'floor', at: [0, -0.1, 0], size: [4.4, 0.2, 5.4], mat: 'carpet' },
  { id: 'ceil', at: [0, H + 0.1, 0], size: [4.4, 0.2, 5.4], mat: 'white' },
  { id: 'wall-front', at: [0, Y, -2.6], size: [4.4, H, 0.2], mat: 'speckle' }, // 포스트잇이 사라진 뒤 드러나는 점박이 판
  { id: 'wall-back', at: [0, Y, 2.6], size: [4.4, H, 0.2], mat: 'white' },
  { id: 'wall-left', at: [-2.1, Y, 0], size: [0.2, H, 5.0], mat: 'white' },
  { id: 'wall-right', at: [2.1, Y, 0], size: [0.2, H, 5.0], mat: 'white' },
];

const postits: Scatter = {
  id: 'postits',
  areas: [
    // 모서리까지 빈틈없이 덮이게 면보다 조금 넓게(벽 속으로 들어간 부분은 안 보여요)
    { face: 'z+', at: [0, Y, -2.5], size: [4.1, H + 0.1] }, // 앞벽 전체
    { face: 'x+', at: [-2.0, Y, -1.12], size: [2.86, H + 0.1] }, // 왼쪽 벽 앞쪽 2.8m
    { face: 'x-', at: [2.0, Y, -1.12], size: [2.86, H + 0.1] }, // 오른쪽 벽 앞쪽 2.8m
    { face: 'y-', at: [0, H, -1.12], size: [4.1, 2.86] }, // 천장 앞쪽 2.8m
  ],
  note: 0.076, // 3인치 포스트잇
  // 영상의 형광 초록·분홍이 대부분, 화살표 색(파랑·보라·청록·노랑·주황)은 조금씩만 섞어 가까이선 티가 안 나게
  colors: [
    ...Array<string>(10).fill('#c4f24e'), // 형광 초록
    ...Array<string>(8).fill('#ff3ea5'), // 분홍
    ...Array<string>(2).fill('#ff9b30'), // 주황(화살표 색이기도 해서 조금만)
    '#ffe23a', '#3b8cff', '#9a5cff', '#2fe3d2', // 노랑·파랑·보라·청록(한 장씩 드문드문)
  ],
  seed: 11,
  chunk: 1.35,
  when: { not: { flag: 'gone' } },
  swap: 'unseen',
  layer: 'live', // (11/18) 지금 눈에만 — 되감은 테이프엔 포스트잇이 하나도 없어요(C안)
  figures: WHITES.map((w, k) => ({ id: `arrow-${w.id}`, when: stage(k), color: w.color, eye: VIEW, from: w.from, at: w.at, gap: w.gap })),
  covers: WHITES.map((w) => ({ face: w.face, at: w.at })), // 흰 종이를 반쯤 가리는 포스트잇
};

export const postit: Room = {
  id: 'postit',
  title: '포스트잇의 방',
  amb: 'hum',
  vhs: 0.3,

  space: {
    boxes,
    lamps: [
      { at: [0, H - 0.02, -1.0], size: [0.36, 0.36], power: 5.5, color: WARM, round: true },
      { at: [0, H - 0.02, 1.4], size: [0.36, 0.36], power: 5.5, color: WARM, round: true },
    ],
  },

  // 들어온 벽(등 뒤)에서 걸어 나와 앞벽을 바라봐요. 뒤에는 문이 없어요
  spawns: {
    start: { at: [0, 0, 1.9], yaw: 0 },
  },

  scatter: [postits],

  props: [
    // (11/17 5차 변경) ~~통로로 돌아가는 지지직 문(정전 뒤 없어짐)~~ → 사용자 의견으로 들어선 순간부터 문 없음
    ...whites.map((w) => w.prop),
    {
      id: 'andyou',
      plane: [0.1, 0.069],
      at: ANDYOU,
      face: 'z+',
      tilt: 15,
      skin: { img: 'media/postit/n-andyou.webp' },
      when: { flag: 'gone' },
      swap: 'unseen',
      layer: 'live', // 라이브: 정전 뒤에만. 뗀 뒤 테이프에선 이 종이가 캠코더 앞에 든 채로 찍혀요
    },
    {
      // (11/18 추가, C안) 테이프용 and you? — 녹화 첫 장면부터 제자리에(정전 전에도). 떼기 시작한 순간부터는 벽에 없어요
      id: 'andyou-tape',
      plane: [0.1, 0.069],
      at: ANDYOU,
      face: 'z+',
      tilt: 15,
      skin: { img: 'media/postit/n-andyou.webp' },
      when: { not: { flag: 'peeled' } },
      layer: 'tape',
    },
  ],

  targets: [
    ...whites.map((w) => w.target),
    {
      // and you? 떼기: 누르고 있으면 종이가 떨어져 캠코더 앞으로 와서 뒤집혀요(손 없이)
      id: 'peel',
      label: 'and you? 떼어 뒤집기(누르고 있기)',
      at: ANDYOU,
      size: [0.24, 0.2, 0.08],
      on: 'hold',
      holdMs: 1000,
      maxDist: 1.8,
      once: true,
      block: true,
      when: { all: [{ flag: 'gone' }, { not: { has: 'postit-andyou' } }] },
      do: [
        { do: 'set', flag: 'peeled' }, // (11/18 추가) 테이프용 and you?가 이 순간부터 벽에서 사라져요(가방에 드는 건 뒤집은 뒤라)
        { do: 'sound', sound: 'sfx.peel' },
        { do: 'pick', prop: 'andyou' },
        { do: 'sound', sound: 'sfx.flip' },
        { do: 'flip', prop: 'andyou' },
        { do: 'give', item: 'postit-andyou' }, // 다음 단계(빨간 점 → 갈색 문)로 이어지는 물건
        // (11/19 3차 변경, 사용자 의견: 뭘 하라는 건지 모름) ~~4초 뒤 아래쪽 안내~~ → 뒤집자마자 위쪽 안내 + 아래쪽 조작 안내(기기에 맞게)
        { do: 'goal', text: '빨간 점 줌 인' },
        { do: 'hint', text: '휠 줌 인', touch: '왼쪽 아래 막대 줌 인' },
      ],
    },
    {
      // (11/19 추가) 빨간 점에 줌(영상 41~42초): 든 종이를 줌으로 당기면 빨강이 화면을 채우고 → 갈색으로 식으며 갈색 문 앞(한 방향, 사용자 결정)
      id: 'reddot',
      label: '뒤집은 종이의 빨간 점에 줌',
      held: 'andyou',
      at: ANDYOU,
      size: [0.1, 0.1, 0.1],
      on: 'zoom',
      minZoom: 1.7,
      dwellMs: 450,
      maxDist: 1,
      once: true,
      block: true,
      when: { has: 'postit-andyou' },
      do: [
        { do: 'goal' },
        { do: 'sound', sound: 'sfx.zoom' }, // (11/19 3차 변경) 캠코더 줌 모터 소리(줌 인 1.1초 → 줌 아웃 1.2초)
        { do: 'room', room: 'warm', via: 'red' },
      ],
    },
  ],

  rules: [
    {
      // 흰 종이 5장을 다 찾는 순간: 정전 → 암흑 속에서 방이 바뀜 → 불이 팍 켜지면 and you? 한 장
      when: { count: 'whites', gte: 5 },
      do: [
        { do: 'goal' }, // 안내 문구 지움
        { do: 'timer', timer: 'hint2', stop: true },
        { do: 'wait', ms: 800 },
        { do: 'sound', sound: 'sfx.flicker' },
        { do: 'light', fx: 'flicker' },
        { do: 'sound', sound: 'sfx.lightsout' },
        { do: 'amb' }, // 전기가 나가 험도 멎어요
        { do: 'light', fx: 'off' },
        { do: 'set', flag: 'gone' }, // 암흑이라 보고 있어도 바뀌어요
        { do: 'wait', ms: 3200 },
        { do: 'sound', sound: 'sfx.lightson' },
        { do: 'light', fx: 'on' },
        { do: 'amb', sound: 'hum' },
        // ~~(11/18 추가) 텅 빈 방을 잠깐 보게 한 뒤 되감기가 열려요 — wait 1500 → set tape → TAPE_HINT~~
        // (11/21 8단계 ② 변경, 사용자 결정) 여기서 되감기를 열지 않아요(플레이 테스트: 이 방 테이프에서 뭔가 해야 하는 줄 알고 헤맴).
        //   되감기는 따뜻한 방 옛 녹화가 지나간 직후 처음 열려요(warm.ts). 테이프용 and you?(andyou-tape)는 남겨 둬요(되돌릴 때 대비)
      ],
    },
  ],

  timers: {
    // 1분이 지나도 다 못 찾았으면 두 번째 안내 문구(멀리서 봐야 보인다는 힌트)
    // (11/17 3차 변경) 문구: ~~한 걸음 물러서야 보이는 길도 있어요.~~ → 사용자가 정한 문구
    // (11/17 6차 변경) ~~색이 하나가 되는 시점이 있다.~~ → 사용자가 정한 문구
    // (11/19 2차 변경, 사용자 의견) ~~첫 문구 아래에 한 줄 더~~ → 첫 문구 자리를 바꿔요(네모 칸은 그대로)
    // (11/21 8단계 ③ 추가, 사용자 결정) 아래에 한 줄 더 — 힌트를 또렷하게
    hint2: { length: { ms: 60_000 }, end: [{ do: 'goal', text: '무질서한 색들이 한곳을 가리키는 시점이 있다.', count: 'whites', of: 5, strong: true }, { do: 'goal', text: '멀어질수록 진실은 선명해진다.', add: true }] }, // (11/19 3차) 노랗게 빛나는 글씨
  },

  enter: [
    // (11/17 3차 변경) ~~색이 없는 목소리만 따라가 봐요.~~ → 사용자가 정한 문구(평서문)
    // (11/17 6차 변경) ~~색을 좇다 보면, 색은 사라진다.~~ → 사용자가 정한 문구
    { do: 'goal', text: '누군가의 색을 좇다 보면, 자신의 색을 잃는다.', count: 'whites', of: 5 },
    { do: 'timer', timer: 'hint2' },
  ],
};
