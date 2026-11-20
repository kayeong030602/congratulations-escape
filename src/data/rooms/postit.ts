import type { Hotspot, Room } from '../schema.ts';

/**
 * 포스트잇의 방 — 초안 (최종 23.5~41.5초)
 *
 * 흐름: 제한 시간 안에 흰 종이 5장 찾기 → "The exit is behind you." → 돌아보면 맨벽
 *       → "Please follow the instructions." → 되돌아보면 다 사라지고 and you? 한 장 → 떼어 뒤집으면 빨간 점.
 * 되감기: 테이프에는 처음부터 흰 종이 몇 장뿐인 원래 벽(AI 미적용 편집본).
 * 좌표는 어림값이라 방을 다듬을 때 다시 재요. (11/16: 종소리·Thank you 없음, 배경은 정지 이미지)
 */

/** 흰 종이 한 장: 누르면 메모에 적히고 개수가 올라가요. */
const white = (id: string, rect: [number, number, number, number]): Hotspot => ({
  id,
  label: `흰 종이 ${id}`,
  shape: { rect },
  once: true,
  cursor: 'focus',
  do: [
    { do: 'note', note: `white-${id}` },
    { do: 'add', count: 'whites' },
  ],
});

export const postit: Room = {
  id: 'postit',
  title: '포스트잇의 방',
  amb: 'hum',
  vhs: 0.35,

  start: { view: 'corner', do: [{ do: 'timer', timer: 'search' }] },

  timers: {
    // 기획: 약 40초. 안내음성은 두 문장 합쳐 4초라 타이머 길이로 쓸 수 없어서 시간으로 정해 둠
    search: { length: { ms: 40_000 }, tension: true, end: [{ do: 'fail' }] },
  },

  rules: [
    {
      // 흰 종이 5장을 다 찾는 순간
      when: { count: 'whites', gte: 5 },
      do: [
        { do: 'timer', timer: 'search', stop: true },
        { do: 'voice', sound: 'voice.behind', wait: true }, // "The exit is behind you."
        { do: 'set', flag: 'told' },
      ],
    },
  ],

  views: {
    // 방 모서리
    corner: {
      label: '포스트잇으로 뒤덮인 모서리',
      backdrop: [{ media: { still: 'postit/corner.webp' } }],
      look: {
        up: { to: 'ceiling', via: 'postit/m-corner-ceiling.mp4' },
        right: { to: 'wall' }, // 영상에 없는 이동 → 휩팬
        back: { to: 'behind', when: { flag: 'told' } },
      },
    },

    // 천장까지 뒤덮임
    ceiling: {
      label: '천장',
      backdrop: [{ media: { still: 'postit/ceiling.webp' } }],
      look: {
        down: { to: 'wall', via: 'postit/m-ceiling-wall.mp4' },
        left: { to: 'corner' },
        back: { to: 'behind', when: { flag: 'told' } },
      },
    },

    // 흰 종이가 섞여 있는 벽. 다 사라진 뒤엔 and you? 한 장만
    wall: {
      label: '흰 종이가 섞인 벽',
      backdrop: [
        { when: { flag: 'gone' }, media: { still: 'postit/wall-gone.webp' } },
        { media: { still: 'postit/wall.webp' } },
      ],
      zoomMax: 3,
      look: {
        left: { to: 'corner', when: { not: { flag: 'gone' } } },
        up: { to: 'ceiling', when: { not: { flag: 'gone' } } },
        back: { to: 'behind', when: { all: [{ flag: 'told' }, { not: { flag: 'gone' } }] } },
      },
      hotspots: [
        {
          id: 'whites',
          label: '흰 종이 쪽으로 줌',
          shape: { rect: [0.38, 0.3, 0.3, 0.42] },
          on: 'zoom',
          minZoom: 1.8,
          when: { not: { flag: 'gone' } },
          do: [
            { do: 'set', flag: 'sawWhites' },
            { do: 'go', view: 'whites', via: 'postit/m-wall-whites.mp4' },
          ],
        },
        {
          id: 'andyou',
          label: 'and you? 포스트잇',
          shape: { rect: [0.36, 0.38, 0.28, 0.3] },
          when: { flag: 'gone' },
          cursor: 'focus',
          do: [{ do: 'go', view: 'andyou', via: 'postit/m-andyou-in.mp4' }],
        },
      ],
    },

    // 흰 종이 5장 클로즈업
    whites: {
      label: '흰 종이 5장',
      backdrop: [{ media: { still: 'postit/whites.webp' } }],
      look: {
        down: { to: 'wall' },
        back: [
          { to: 'behind', when: { flag: 'told' } },
          { to: 'wall' },
        ],
      },
      hotspots: [
        white('hurry', [0.29, 0.08, 0.19, 0.23]),
        white('this-way', [0.62, 0.11, 0.18, 0.25]),
        white('no-that-way', [0.37, 0.47, 0.18, 0.25]),
        white('just-follow', [0.11, 0.55, 0.2, 0.28]),
        white('too-late', [0.57, 0.66, 0.22, 0.28]),
      ],
    },

    // 시키는 대로 돌아본 곳: 아무것도 없는 맨벽
    behind: {
      label: '뒤쪽 맨벽',
      backdrop: [{ media: { still: 'postit/behind.webp' } }],
      enter: [
        {
          do: 'if',
          when: { not: { flag: 'gone' } },
          then: [
            { do: 'stat', key: 'obeyed' }, // 안내음성을 따른 횟수
            { do: 'set', flag: 'obeyed' },
            { do: 'wait', ms: 1200 },
            { do: 'voice', sound: 'voice.follow', wait: true }, // "Please follow the instructions."
            { do: 'set', flag: 'gone' },
          ],
        },
      ],
      look: {
        back: { to: 'wall', via: 'postit/m-behind-wall.mp4', when: { flag: 'gone' } },
      },
    },

    // and you? 한 장 → 떼어서 뒤집으면 빨간 점
    andyou: {
      label: 'and you?',
      backdrop: [{ media: { still: 'postit/andyou.webp' } }],
      hotspots: [
        {
          id: 'peel',
          label: '포스트잇 떼기(누르고 있기)',
          shape: { rect: [0.1, 0.1, 0.8, 0.75] },
          on: 'hold',
          holdMs: 800,
          cursor: 'hand',
          do: [
            { do: 'sound', sound: 'sfx.peel' },
            { do: 'clip', clip: 'postit/peel.mp4' },
            { do: 'sound', sound: 'sfx.flip' },
            { do: 'give', item: 'postit-andyou' },
            { do: 'go', view: 'reddot' },
          ],
        },
      ],
    },

    // 뒤집은 포스트잇의 빨간 점. 2단계: 줌 → 따뜻한 방
    reddot: {
      label: '빨간 점',
      backdrop: [{ media: { still: 'postit/reddot.webp' } }],
      zoomMax: 3,
    },
  },

  tape: {
    segments: [
      {
        id: 'enter',
        clip: 'postit/tape-enter.mp4',
        marks: [
          {
            id: 'bare',
            from: 0.5,
            to: 3.6,
            shape: { rect: [0, 0, 1, 1] },
            needs: 'pause',
            once: true,
            do: [{ do: 'note', note: 'tape-bare-wall' }],
          },
        ],
      },
      { id: 'whites', clip: 'postit/tape-whites.mp4', when: { flag: 'sawWhites' } },
      { id: 'behind', clip: 'postit/tape-behind.mp4', when: { flag: 'obeyed' } },
    ],
  },
};
