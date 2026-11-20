import type { Game, Room, RoomId } from './schema.ts';

/** 게임 전체 목록: 방 순서, 가방 물건, 메모, 소리. */
export const game: Game = {
  version: 1,
  start: 'intro',
  rooms: ['intro', 'white', 'corridor', 'postit'],

  items: {
    'postit-andyou': { name: 'and you?', icon: 'postit-blue', text: '파란 포스트잇. 뒷면에 빨간 점이 찍혀 있다.' },
  },

  notes: {
    sign: { text: '안내판: 0¾ 방 · PLEASE FOLLOW THE INSTRUCTIONS' },
    'white-hurry': { text: '흰 종이: hurry' },
    'white-this-way': { text: '흰 종이: this way' },
    'white-no-that-way': { text: '흰 종이: no, that way' },
    'white-just-follow': { text: '흰 종이: just follow' },
    'white-too-late': { text: '흰 종이: too late' },
    'tape-bare-wall': { text: '테이프: 벽엔 처음부터 흰 종이 몇 장뿐이었다' },
  },

  sounds: {
    hum: { src: 'sound/hum.mp3', bus: 'amb', loop: true, gain: 0.6 },
    'cut.intro': { src: 'intro/intro.mp3', bus: 'sfx' },
    'voice.behind': { src: 'sound/voice-behind.mp3', bus: 'voice' }, // "The exit is behind you."
    'voice.follow': { src: 'sound/voice-follow.mp3', bus: 'voice' }, // "Please follow the instructions."
    'sfx.pop': { src: 'sound/andyou-pop.mp3', bus: 'sfx' },
    'sfx.peel': { src: 'sound/peel.mp3', bus: 'sfx' },
    'sfx.flip': { src: 'sound/flip.mp3', bus: 'sfx' },
  },
};

/** 방 데이터는 그 방에 갈 때 불러와요(지연 로딩). */
export const rooms: Record<RoomId, () => Promise<Room>> = {
  intro: () => import('./rooms/intro.ts').then((m) => m.intro),
  white: () => import('./rooms/white.ts').then((m) => m.white),
  corridor: () => import('./rooms/corridor.ts').then((m) => m.corridor),
  postit: () => import('./rooms/postit.ts').then((m) => m.postit),
};
