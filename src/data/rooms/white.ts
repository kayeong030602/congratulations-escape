import type { Room } from '../schema.ts';

/**
 * 하얀 방(튜토리얼) — 초안 (최종 11~14초)
 * 영상에 시점이 2개뿐이에요(벽 정면, 위쪽 모서리). 나가는 길 = 뒤를 돌아보기.
 * 왼쪽·오른쪽 시점을 편집 합성으로 더할지는 사용자와 정할 것.
 */
export const white: Room = {
  id: 'white',
  title: '하얀 방',
  vhs: 0.25,
  start: { view: 'a' },
  views: {
    a: {
      label: '벽 정면',
      backdrop: [{ media: { still: 'white/a.webp' } }],
      look: {
        up: { to: 'b', via: 'white/m-a-b.mp4' },
        back: { do: [{ do: 'room', room: 'corridor', via: 'white/m-out.mp4' }] },
      },
    },
    b: {
      label: '위쪽 모서리',
      backdrop: [{ media: { still: 'white/b.webp' } }],
      look: {
        down: { to: 'a' },
        back: { do: [{ do: 'room', room: 'corridor', via: 'white/m-out.mp4' }] },
      },
    },
  },
};
