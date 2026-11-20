import { DOTTED, SIGN, corridor as lab } from '../../lab3d/room.ts';
import type { Box, Room } from '../schema.ts';

const H = 2.6;
const Y = H / 2;
const WHITE_LIGHT = '#fbf8f2'; // 하얀 방의 빛: 통로(따뜻한 빛)보다 하얗게

/** 벽 아래 걸레받이(높이 10cm, 부딪히지 않음). */
const base = (id: string, at: [number, number], size: [number, number]): Box => ({
  id, at: [at[0], 0.05, at[1]], size: [size[0], 0.1, size[1]], mat: 'base', solid: false,
});

/**
 * 하얀 방(최종 영상 10~13초) + 통로·안내판(13~23초) — 벽 없이 이어져 보여야 해서 한 방 데이터에 같이 지어요.
 * 통로 공간(상자·천장등)은 사용자가 확인한 시험 방의 것을 그대로 써요(뒤쪽 막힌 벽만 "사라지는 벽"으로 옮김).
 *
 * (11/17 추가) 하얀 방 — 문 없는 방에서 시작해요. 5초 뒤 등 뒤 벽이 지지직거리며 흩어지듯 소리 없이 사라지고((11/17 변경) 안 보는 사이 뚝 → 지지직)
 *   험이 들려오기 시작해요. 돌아보면 통로가 이어져 있어요(영상: 흰 벽 → 위쪽 모서리 → 오른쪽 주황 벽을 지나 뒤돌면 통로).
 *   영상에는 정면 흰 벽, 오른쪽 주황 벽, 천장만 나와요. 바닥·왼쪽 벽·방 크기는 새로 정한 것(평면도는 TECH_DESIGN 11장).
 * 통로 — 안내판을 줌으로 읽으면 → 모퉁이 끝 벽에 "너머로 가는 벽"이 생기고(안 보는 사이에) → 그 벽으로 걸어 들어가면 포스트잇의 방으로.
 * (11/16 변경) 점선 문 → 가까이 가야 보이는 지지직 벽. 휩팬 → 벽을 통과하듯 그대로 걸어 들어감.
 *
 *            z=-6 ┌──────────── 주황 벽 ────────────┐
 *                 │                     너머로 가는 벽 ┊ → 포스트잇의 방
 *          z=-4.2 │        ┌■ 초록 기둥 ────────────┘
 *                 │ 안내판  │
 *                 │        │
 *             z=5 ├┄┄┄┄┄┄┄┄┤  ← 사라지는 벽
 *          주황 벽 │ ● 시작  │ 흰 벽      하얀 방 (2.4 × 2.4m)
 *           z=7.6 └────────┘
 *                  흰 벽(정면)
 */
export const corridor: Room = {
  id: 'corridor',
  title: '하얀 방·통로',
  amb: 'hum',
  vhs: 0.25,
  space: {
    boxes: [
      ...lab.boxes.filter((b) => b.id !== 'wall-back' && b.id !== 'bb-back'),
      // 하얀 방: 바닥(통로와 같은 카펫), 천장(통로의 천장재가 아니라 민 흰 천장 — 영상처럼)
      { id: 'w-floor', at: [0, -0.1, 6.5], size: [2.6, 0.2, 2.6], mat: 'carpet' },
      { id: 'w-ceil', at: [0, H + 0.1, 6.5], size: [2.6, 0.2, 2.6], mat: 'white' },
      { id: 'w-front', at: [0, Y, 7.7], size: [2.6, H, 0.2], mat: 'white' },
      { id: 'w-orange', at: [-1.3, Y, 6.45], size: [0.2, H, 2.7], mat: 'orange' }, // 정면을 볼 때 오른쪽
      { id: 'w-left', at: [1.3, Y, 6.45], size: [0.2, H, 2.7], mat: 'white' },
      // 뒤쪽 벽 중 통로 폭 밖의 양쪽 조각(가운데는 사라지는 벽)
      { id: 'w-back-a', at: [-1.15, Y, 5.1], size: [0.1, H, 0.2], mat: 'white' },
      { id: 'w-back-b', at: [1.15, Y, 5.1], size: [0.1, H, 0.2], mat: 'white' },
      base('wb-front', [0, 7.592], [2.4, 0.016]),
      base('wb-orange', [-1.192, 6.4], [0.016, 2.4]),
      base('wb-left', [1.192, 6.4], [0.016, 2.4]),
      base('wb-back-a', [-1.05, 5.208], [0.3, 0.016]),
      base('wb-back-b', [1.05, 5.208], [0.3, 0.016]),
    ],
    lamps: [
      ...lab.lamps,
      // 하얀 방: 등은 안 보이고 빛만(어디서 오는지 모르는 하얀 빛)
      { at: [0, H - 0.02, 5.85], size: [0.7, 0.5], power: 7, color: WHITE_LIGHT, hide: true },
      { at: [0, H - 0.02, 6.95], size: [0.7, 0.5], power: 7, color: WHITE_LIGHT, hide: true },
    ],
  },

  // 하얀 방과 통로 사이 벽: 처음엔 있다가, whiteOpen이 되면 안 보는 사이에 없어져요
  parts: [
    {
      id: 'white-wall',
      when: { not: { flag: 'whiteOpen' } },
      // (11/17 변경) 안 보는 사이 뚝 → 지지직거리며 흩어지듯 1.4초 동안 사라져요(사용자 의견). 보는 중이어도 사라져요
      swap: 'dissolve',
      ms: 1400,
      boxes: [
        { id: 'wall-back', at: [0, Y, 5.1], size: [1.8, H, 0.2], mat: 'white' },
        base('bb-back', [0, 4.992], [1.8, 0.016]),
        base('wb-back', [0, 5.208], [1.8, 0.016]),
      ],
    },
  ],

  spawns: {
    // 게임 시작: 하얀 방 뒤쪽, 정면 흰 벽을 봄(통로는 등 뒤). 영상처럼 양옆 끝에 왼쪽 흰 벽·오른쪽 주황 벽이 살짝 걸려요
    start: { at: [0, 0, 5.65], yaw: 180 },
    // 포스트잇의 방에서 돌아왔을 때: 그 벽에서 걸어 나와 벽을 등지고 섬
    'from-postit': { at: [4.15, 0, -5.1], yaw: 90 },
  },

  enter: [
    {
      do: 'if',
      when: { not: { flag: 'whiteOpen' } },
      then: [
        { do: 'amb' }, // 하얀 방은 먹먹한 정적
        { do: 'timer', timer: 'hint' },
        { do: 'timer', timer: 'open' },
      ],
    },
  ],

  timers: {
    // 튜토리얼: 조작 안내(한국어, 번지지 않는 글씨)
    hint: {
      length: { ms: 1200 },
      // (11/17 변경) 폰 글씨를 화면 왼쪽·오른쪽 순서로
      // (11/17 변경) 개조식으로(시작 화면 조작 안내와 같은 말투)
      end: [{ do: 'hint', text: '마우스 둘러보기 · WASD 걷기', touch: '왼쪽 밀어 걷기 · 오른쪽 밀어 둘러보기' }],
    },
    // 나가는 길 = 뒤를 돌아보기. 벽은 안 보는 사이에 사라지고, 등 뒤에서 험이 들려와요
    open: {
      length: { ms: 5000 }, // (11/17 변경) 3.5초 → 5초(사용자 의견)
      // (11/17 변경) 벽이 사라질 때 지지직 효과음은 뺐어요(사용자 의견: 소리 없이 사라지는 게 나음). 험만 들려오기 시작
      end: [{ do: 'set', flag: 'whiteOpen' }, { do: 'amb', sound: 'hum' }],
    },
    // (11/20 5차 추가) 안내판 줌 안내를 띄운 뒤 20초 지나면 다시 띄울 수 있게(그사이 또 헤매면)
    signhint: { length: { ms: 20_000 }, end: [{ do: 'set', flag: 'sign.hinted', off: true }] },
  },

  props: [
    { id: 'sign', plane: SIGN.size, at: SIGN.at, face: 'x+', skin: { img: 'lab3d/sign.webp' } },
    { id: 'dotted', plane: DOTTED.size, at: DOTTED.at, face: 'x-', skin: { gen: 'portal' }, when: { flag: 'signRead' }, swap: 'unseen' },
  ],

  targets: [
    {
      id: 'sign',
      label: '안내판을 줌으로 읽기',
      at: [-0.88, 1.5, 1.0],
      size: [0.08, 0.66, 0.92],
      on: 'zoom',
      minZoom: 1.8,
      maxDist: 5,
      // (11/16 변경) 한 번만 → 다시 줌하면 또 읽혀요(다시 읽어 보고 싶을 수 있어서). 메모는 처음 한 번만 더해져요
      do: [
        { do: 'set', flag: 'signRead' },
        { do: 'note', note: 'sign' },
      ],
      // (11/20 5차 추가, 사용자 의견) 헤맬 때만 줌 안내: 아직 안 읽었을 때, 줌 없이 누르거나(폰은 톡) 줌을 안 당긴 채 2.5초 조준하면
      //   "휠 줌 인"(폰 "왼쪽 아래 막대 줌 인" — 포스트잇의 방 빨간 점 안내와 같은 말). 한 번 띄우면 20초 동안은 다시 안 띄워요(반복 안 함)
      unzoomedMs: 2500,
      unzoomed: [{
        do: 'if', when: { all: [{ not: { flag: 'signRead' } }, { not: { flag: 'sign.hinted' } }] },
        then: [{ do: 'set', flag: 'sign.hinted' }, { do: 'hint', text: '휠 줌 인', touch: '왼쪽 아래 막대 줌 인' }, { do: 'timer', timer: 'signhint' }],
      }],
    },
  ],

  zones: [
    {
      // 벽 바로 앞(벽에서 0.55m 안쪽부터). 몸이 벽에 닿기 직전에 넘어가요
      id: 'dotted-wall',
      at: [4.725, 1, -5.1],
      size: [0.55, 2, 1.0],
      into: 'x+', // (11/17 추가) 벽 쪽(+x)으로 걸어 들어갈 때만 넘어가요(벽을 따라 옆으로 스치면 안 넘어감)
      when: { flag: 'signRead' },
      enter: [{ do: 'room', room: 'postit', via: 'through' }],
    },
  ],
};
