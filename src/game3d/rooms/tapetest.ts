import type { Box, Room } from '../schema.ts';

const H = 2.6;
const Y = H / 2;

/**
 * (11/18 추가) 개발용 되감기 시험 방 — 주소 http://localhost:5173/?room=tapetest&dev (개발 미리보기에서만, 배포 빌드엔 안 들어가요).
 * 저장을 남기지 않아요(dev). 다음 단계에서 쓸 테이프 장치를 미리 시험해 보는 곳이에요.
 *   - 따뜻한 방: 영상(clip)이 테이프에 실사로 찍힘 → 되감아 멈춰 읽기
 *   - 계단 0-4: 테이프에만 찍힌 것(layer: 'tape' — 설계서의 tapeOnly), 테이프에서 "봤음"(tape: true, on: 'seen'),
 *               순간이동 루프(warp — 테이프에서 두 자리 사이를 이어 그리지 않음), 바닥에 놓인 것(face 'y+')
 *
 *          z=-4 ┌─────────────── 앞벽 ───────────────┐
 *               │ ┄┄┄┄┄┄ 루프 영역(z<-3): 시작 자리로 순간이동 ┄┄┄┄┄┄ │
 *   테이프에만   │▒                                    [영상]│ 오른쪽 벽: 누르면 실사 영상(테이프에도 찍힘)
 *   포스트잇 무리 │▒ (seen 대상)      ▢ 바닥 종이(테이프에만,       │          + 라이브에만 보이는 종이
 *               │                    멈춘 화면에서 누르기)       │
 *               │                 ● 시작(z=3, 앞을 봄)          │
 *          z=4  └────────────────────────────────────┘
 *              x=-2                                   x=2
 */
const boxes: Box[] = [
  { id: 'floor', at: [0, -0.1, 0], size: [4.4, 0.2, 8.4], mat: 'carpet' },
  { id: 'ceil', at: [0, H + 0.1, 0], size: [4.4, 0.2, 8.4], mat: 'ceiling' },
  { id: 'wall-front', at: [0, Y, -4.1], size: [4.4, H, 0.2], mat: 'speckle' },
  { id: 'wall-back', at: [0, Y, 4.1], size: [4.4, H, 0.2], mat: 'white' },
  { id: 'wall-left', at: [-2.1, Y, 0], size: [0.2, H, 8.0], mat: 'white' },
  { id: 'wall-right', at: [2.1, Y, 0], size: [0.2, H, 8.0], mat: 'orange' },
];

export const tapetest: Room = {
  id: 'tapetest',
  title: '되감기 시험 방(개발용)',
  amb: 'hum',
  vhs: 0.25,
  dev: true,
  space: {
    boxes,
    lamps: [
      { at: [0, H - 0.02, -1.5], size: [0.5, 0.5], power: 6, color: '#fff3dc' },
      { at: [0, H - 0.02, 2.0], size: [0.5, 0.5], power: 6, color: '#fff3dc' },
    ],
  },
  spawns: { start: { at: [0, 0, 3], yaw: 0 } },

  // 테이프에만 찍힌 포스트잇 무리(라이브에선 맨벽)
  scatter: [{
    id: 'ghost-notes',
    areas: [{ face: 'x+', at: [-2.0, 1.45, -1.0], size: [1.4, 1.0] }],
    note: 0.076,
    colors: ['#c4f24e', '#ff3ea5', '#ff9b30'],
    seed: 5,
    chunk: 1.5,
    layer: 'tape',
  }],

  props: [
    // 바닥에 놓인 종이(테이프에만)
    { id: 'floor-note', plane: [0.12, 0.12], at: [0.5, 0.012, -1.4], face: 'y+', tilt: 20, skin: { img: 'media/postit/n-hurry.webp' }, layer: 'tape' },
    // 라이브에만 보이는 종이(테이프엔 없음)
    { id: 'live-note', plane: [0.1, 0.1], at: [1.989, 1.75, 0.2], face: 'x-', skin: { img: 'media/postit/n-this-way.webp' }, layer: 'live' },
    // 영상 버튼(둘 다)
    { id: 'clip-btn', plane: [0.12, 0.12], at: [1.989, 1.35, -1.5], face: 'x-', skin: { img: 'media/postit/n-just-follow.webp' } },
  ],

  targets: [
    {
      id: 'ghost-seen',
      label: '테이프 속 포스트잇 무리를 봄',
      tape: true,
      on: 'seen',
      at: [-1.98, 1.45, -1.0],
      size: [0.1, 1.0, 1.4],
      maxDist: 9,
      dwellMs: 400,
      once: true,
      do: [{ do: 'set', flag: 'test.seen' }, { do: 'osd', text: 'SEEN ON TAPE', ms: 1800 }],
    },
    {
      id: 'floor-click',
      label: '멈춘 테이프에서 바닥 종이 누르기',
      tape: true,
      needs: 'pause',
      on: 'click',
      at: [0.5, 0.02, -1.4],
      size: [0.3, 0.08, 0.3],
      maxDist: 6,
      do: [{ do: 'add', count: 'test.picked' }, { do: 'osd', text: 'CAUGHT ON TAPE', ms: 1800 }],
    },
    {
      id: 'clip',
      label: '영상 틀기(테이프에 실사로 찍힘)',
      on: 'click',
      at: [1.95, 1.35, -1.5],
      size: [0.1, 0.25, 0.25],
      maxDist: 2.4,
      do: [{ do: 'clip', clip: 'intro/error.mp4' }],
    },
  ],

  zones: [
    {
      // 계단 루프처럼: 앞으로 걸어 들어가면 시작 자리로 순간이동
      id: 'loop',
      at: [0, 1, -3.4],
      size: [4.0, 2, 0.8],
      into: 'z-',
      // (11/18 변경) 뚝 끊기지 않게 ~~cut~~ → fade(0.22초 어두워짐 → 0.26초 밝아짐, 사용자 의견). 테이프에서도 같게 보여요
      enter: [{ do: 'add', count: 'test.loops' }, { do: 'warp', spawn: 'start', via: 'fade' }],
    },
  ],

  enter: [
    { do: 'set', flag: 'tape' },
    { do: 'hint', text: '되감기 시험 방 · R 되감기', touch: '되감기 시험 방 · ◀◀ 눌러 되감기' },
  ],
};
