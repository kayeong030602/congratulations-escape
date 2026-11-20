import type { Room } from '../schema.ts';

/**
 * 인트로 — 초안 (최종 0~11초)
 * 8비트 9분할 + WELCOME TO LEVEL 0 이 반복되다가, 화면을 누르면(PLAY ▶ = 테이프 넣기, 소리 켜짐)
 * LOADING... → 에러 → 하얀 방.
 */
export const intro: Room = {
  id: 'intro',
  title: '인트로',
  vhs: 0.1,
  start: { view: 'title' },
  views: {
    title: {
      label: '타이틀',
      backdrop: [{ media: { loop: 'intro/title.mp4' } }],
      hotspots: [
        {
          id: 'play',
          label: 'PLAY ▶ (테이프 넣기)',
          shape: { rect: [0, 0, 1, 1] },
          do: [
            { do: 'sound', sound: 'cut.intro' }, // LOADING + 에러 구간의 소리(영상과 똑같이)
            { do: 'clip', clip: 'intro/loading.mp4' },
            { do: 'clip', clip: 'intro/error.mp4' },
            { do: 'room', room: 'white' },
          ],
        },
      ],
    },
  },
};
