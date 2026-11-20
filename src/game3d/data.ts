import { game as v1 } from '../data/game.ts';
import type { Game } from '../data/schema.ts';
import type { Room, RoomId } from './schema.ts';
import { corridor } from './rooms/corridor.ts';
import { postit } from './rooms/postit.ts';
import { warm } from './rooms/warm.ts';
import { stairs } from './rooms/stairs.ts';

/** 게임 전체 목록. 가방 물건·메모·소리는 2.5D 때 적어 둔 것을 그대로 써요. */
export const data: Game = {
  ...v1,
  // (11/17 추가) 3D 인트로의 소리: 최종 영상 0~11초(타이틀부터 음악, 10.5초 뒤는 거의 무음 — 3D 하얀 방이 지지직거리는 동안)
  sounds: {
    ...v1.sounds,
    'intro.full': { src: 'intro/full.mp3', bus: 'sfx' },
    // (11/17 추가) 포스트잇의 방 정전 (Mixkit 무료 효과음)
    'sfx.flicker': { src: 'sound/flicker.mp3', bus: 'sfx', gain: 0.8 },
    'sfx.lightsout': { src: 'sound/lights-out.mp3', bus: 'sfx' },
    'sfx.lightson': { src: 'sound/lights-on.mp3', bus: 'sfx', gain: 0.9 },
    // (11/19 추가) 5단계: 빨간 점·갈색 문·따뜻한 방(영화 편집 때 쓴 큐). 음악과 웃음소리는 바탕음 묶음(amb)이라
    // 테이프를 볼 때 같이 먹먹해지고, 오답(hush) 때 같이 뚝 끊겨요
    // (11/19 3차 변경) ~~빨간 점 부풀어 오름(red-swell)~~ → 사용자가 녹음한 캠코더 줌 모터: 줌 인 → 멈춤 → 줌 아웃 → 멈춤(빨간 점 전환에 맞춘 한 파일)
    'sfx.zoom': { src: 'sound/zoom.mp3', bus: 'sfx', gain: 0.9 },
    'sfx.creak': { src: 'sound/door-creak.mp3', bus: 'sfx' },
    'sfx.memory': { src: 'sound/memory.mp3', bus: 'sfx' },
    'sfx.mlaugh': { src: 'sound/montage-laugh.mp3', bus: 'sfx', gain: 0.8 },
    'warm.music': { src: 'sound/dreamy.mp3', bus: 'amb', loop: true, gain: 0.5 }, // "Dreamy Flashback" Kevin MacLeod, CC BY 4.0
    'warm.laugh': { src: 'sound/laugh.mp3', bus: 'amb', loop: true, gain: 0.55 },
    'sfx.wrong': { src: 'sound/wrong.mp3', bus: 'sfx', gain: 0.8 }, // (11/19 2차 추가) 따뜻한 방 오답: 짧은 지지직
    // (11/19 6단계 추가) 잠긴 문 추격(영화 편집 큐 + 경고음·안내음성 원본). 쿵은 입체 음향(그 등 자리에서)
    'sfx.thud': { src: 'sound/thud.mp3', bus: 'sfx', gain: 1.4 },
    'sfx.alarm': { src: 'sound/alarm.wav', bus: 'sfx', loop: true, gain: 0.32 }, // 비상 경고음 "빠앙"(1.15초 주기). (2차) 이음매 틱 소리 → 틈 없는 wav
    'sfx.chew': { src: 'sound/chew.mp3', bus: 'sfx', gain: 0.75 }, // (2차 추가) 실패할 때 지지직(테이프 씹힘)
    'sfx.try1': { src: 'sound/key-try1.mp3', bus: 'sfx', gain: 0.9 },
    'sfx.try2': { src: 'sound/key-try2.mp3', bus: 'sfx', gain: 0.9 },
    'sfx.try3': { src: 'sound/key-try3.mp3', bus: 'sfx', gain: 0.9 },
    'sfx.keysdrop': { src: 'sound/keys-drop.mp3', bus: 'sfx', gain: 0.85 },
    'sfx.jingle': { src: 'sound/keys-jingle.mp3', bus: 'sfx', gain: 0.8 },
    'sfx.redkey': { src: 'sound/red-key.mp3', bus: 'sfx', gain: 0.7 },
    'sfx.unlock': { src: 'sound/unlock.mp3', bus: 'sfx', gain: 1 },
    'sfx.dooropen': { src: 'sound/door-open.mp3', bus: 'sfx', gain: 0.7 },
    'sfx.slam': { src: 'sound/slam.mp3', bus: 'sfx', gain: 1 },
    'sfx.slamboom': { src: 'sound/slam-boom.mp3', bus: 'sfx', gain: 0.8 },
    // (11/20 변경, 사용자 의견) 숨소리 두 개(문 앞·쾅 뒤)는 뺐어요
    // (11/20 2차 변경, 사용자 의견) 잠긴 문 안내음성 둘은 안 써요(열쇠를 고르면 바로 문이 열림) — 정의·파일만 남겨 둬요
    'voice.key': { src: 'sound/voice-key.mp3', bus: 'voice' }, // 최종 영상 84.3~87.8초의 두 마디("Only your own key will open the door.")
    'voice.donot': { src: 'sound/voice-donot.mp3', bus: 'voice' }, // 87.9초부터 — 쾅에 잘림("Please do not lo—")
    // (11/20 7단계 추가) 엔딩: congratulations! 문이 열리면 차오르는 드론 — "The Gates of Heaven" Jovica (CC BY 4.0), 끝 화면에 표기
    'end.gates': { src: 'sound/gates.mp3', bus: 'music', gain: 0.75 },
    // (11/20 2차 추가, 사용자 의견) 끝 화면(파란 화면)에 머무는 동안 반복: 인트로의 그 노래 "Bit Shift" Kevin MacLeod (CC BY 4.0, 끝 화면에 표기)
    'end.music': { src: 'sound/bitshift-end.mp3', bus: 'music', loop: true, gain: 0.7 },
  },
  // (11/17 변경) 하얀 방은 통로와 한 방 데이터(rooms/corridor.ts)라 여기서 시작해요(서는 자리 'start' = 하얀 방).
  // 인트로(타이틀 → LOADING → 에러)는 방이 아니라 main.ts의 영상 흐름이에요.
  start: 'corridor',
  /**
   * (11/17 추가) 3D 게임의 단서 문구 — 건조한 평서문으로(사용자 규칙: 조작·상태는 개조식, 단서 조사는 건조한 평서문,
   * ~해요체는 반전·기괴한 규칙·가짜 목표를 부추기는 바깥 안내에만). 2.5D 보관본은 src/data/game.ts의 문구 그대로.
   */
  notes: {
    ...v1.notes,
    sign: { text: '안내판에는 0¾ 방이 있다. 맨 아래에 PLEASE FOLLOW THE INSTRUCTIONS.' },
    'white-hurry': { text: '흰 종이에 hurry라고 적혀 있다.' },
    'white-this-way': { text: '흰 종이에 this way라고 적혀 있다.' },
    'white-no-that-way': { text: '흰 종이에 no, that way라고 적혀 있다.' },
    'white-too-late': { text: '흰 종이에 too late라고 적혀 있다.' },
    'white-just-follow': { text: '흰 종이에 just follow라고 적혀 있다.' },
    // (11/19 추가) 5단계
    'warm-door': { text: '문은 열리지 않는다.' },
    'warm-window': { text: '창살 너머는 완전한 암흑이다.' },
  },
  rooms: ['corridor', 'postit', 'warm', 'stairs'],
};

/**
 * ~~방 데이터는 그 방에 갈 때 불러와요(지연 로딩).~~
 * (11/20 변경, 폰 점검) 본 게임 방 넷은 처음부터 같이 받아요(합쳐서 압축 약 13KB). 따로 받다가 와이파이가 끊겨 한 번 실패하면
 * 브라우저가 그 실패를 기억해서 새로 고침 전까지 그 방에 영영 못 들어갔어요. 그림·소리는 여전히 그 방에 갈 때(앞 방에서 미리) 받아요.
 */
export const rooms: Record<RoomId, () => Promise<Room>> = {
  corridor: async () => corridor,
  postit: async () => postit,
  warm: async () => warm, // (11/19 추가) 갈색 문·따뜻한 방·옛 녹화·창밖 복도. (6단계) + 잠긴 문 추격
  stairs: async () => stairs, // (11/19 6단계 추가) 계단참 루프. (7단계) + congratulations! 문·엔딩
  // (11/18 추가) 개발용 되감기 시험 방 ?room=tapetest — 개발 미리보기(npm run dev)에서만, 배포 빌드엔 안 들어가요
  ...(import.meta.env.DEV ? { tapetest: () => import('./rooms/tapetest.ts').then((m) => m.tapetest) } : {}),
  // (11/19 6단계 추가) 개발용 추격 시험 방 ?room=chasetest&dev — 등 뒤 빛·뒤 보기 판정·등 뒤 쿵을 먼저 작게 시험(배포엔 안 들어감)
  ...(import.meta.env.DEV ? { chasetest: () => import('./rooms/chasetest.ts').then((m) => m.chasetest) } : {}),
  // (11/20 6단계 추가) 개발용 계단 시험 방 ?room=stairtest&dev — 계단 오르기(바닥 높이)·홀로그램 글씨 등을 먼저 폰에서 확인(배포엔 안 들어감)
  ...(import.meta.env.DEV ? { stairtest: () => import('./rooms/stairtest.ts').then((m) => m.stairtest) } : {}),
};
