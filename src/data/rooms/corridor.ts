import type { Room } from '../schema.ts';

/**
 * 통로·안내판 — 초안 (최종 14~23.5초). 좌표는 어림값.
 * 안내판을 읽은 뒤에만 모퉁이에 '다가가기'가 생겨요 → 포스트잇의 방으로.
 */
export const corridor: Room = {
  id: 'corridor',
  title: '통로·안내판',
  amb: 'hum',
  vhs: 0.25,
  start: { view: 'hall' },
  views: {
    hall: {
      label: '통로',
      backdrop: [{ media: { still: 'corridor/hall.webp' } }],
      zoomMax: 3,
      look: { right: { to: 'corner' } },
      hotspots: [
        {
          id: 'sign',
          label: '안내판 쪽으로 줌',
          shape: { rect: [0.05, 0.42, 0.22, 0.3] },
          on: 'zoom',
          minZoom: 1.8,
          do: [{ do: 'go', view: 'sign', via: 'corridor/m-sign.mp4' }],
        },
      ],
    },

    sign: {
      label: '안내판',
      backdrop: [{ media: { still: 'corridor/sign.webp' } }],
      zoomMax: 3,
      enter: [
        { do: 'set', flag: 'signRead' },
        { do: 'note', note: 'sign' },
      ],
      look: {
        right: { to: 'corner', via: 'corridor/m-corner.mp4' },
        back: { to: 'corner', via: 'corridor/m-corner.mp4' },
      },
    },

    corner: {
      label: '모퉁이',
      backdrop: [{ media: { still: 'corridor/corner.webp' } }],
      look: { left: { to: 'hall' } },
      hotspots: [
        {
          id: 'approach',
          label: '모퉁이로 다가가기',
          shape: { rect: [0.3, 0.1, 0.45, 0.6] },
          when: { flag: 'signRead' },
          cursor: 'walk',
          do: [{ do: 'room', room: 'postit', via: 'corridor/m-out.mp4' }],
        },
      ],
    },
  },
};
