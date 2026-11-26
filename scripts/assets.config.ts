/**
 * 소재 뽑기 표 — 1단계 (인트로 → 하얀 방 → 통로 → 포스트잇의 방)
 *
 * 한 줄 = 뽑을 파일 하나. `npm run assets`를 실행하면 public/media/에 만들어져요.
 * 원본은 읽기만 해요. 시간은 원본 영상의 초(소수점 가능, 30fps).
 * 2026-11-16 첫 판: 2fps 콘택트 시트로 잡은 값이라 0.1~0.3초씩 다듬을 수 있어요.
 *
 * kind
 *   still : 정지 이미지(webp 1440×1080). 시점 배경, 줌해서 읽는 곳
 *   loop  : 이음매 없는 반복 클립(끝을 처음에 섞음). 960×720, 소리 없음
 *   clip  : 한 번 재생하는 클립(이동·컷신). 960×720, 소리 없음
 *   tape  : 되감기용 테이프. 640×480 + 거꾸로 파일(.rev.mp4) 자동 생성
 *   audio : 소리(mp3). src가 영상이면 그 구간의 소리만 뽑아요
 */

const D = 'D:/졸업작품';
export const SRC = {
  final: `${D}/AI 합성 적용 편집본 (11-10 Claude)/congratulations_최종.mp4`,
  raw: `${D}/AI 미적용 편집본/AI 미적용 1차 편집본 (포스트잇 방 안내방송 미첨부).mp4`,
  cues: `${D}/컷편집 작업/cues`,
  sfx: `${D}/컷편집 작업/sfx/mixkit`, // (11/17 추가) Mixkit 무료 효과음(크레딧 필수 아님, 원본 파일 재배포는 금지 — 게임 속 소리로만)
  music: `${D}/컷편집 작업/music`,
  voice: `${D}/안내음성_경고음`,
} as const;

export type Job =
  // still은 at 앞뒤 pick초(기본 0.2) 안에서 가장 또렷한 프레임을 골라요. pick: 0 이면 정확히 at.
  | { out: string; kind: 'still'; src: string; at: number; pick?: number }
  // (11/17 추가) w = 가로 크기(세로는 4:3으로). 없으면 960
  | { out: string; kind: 'loop' | 'clip' | 'tape'; src: string; from: number; to: number; w?: number }
  // (11/17 추가) fadeOut = 끝의 몇 초를 서서히 줄여요(뚝 끊기지 않게)
  | { out: string; kind: 'audio'; src: string; from?: number; to?: number; mono?: true; fadeOut?: number
      // (11/19 3차 추가) parts = 여러 구간을 이어 붙임([시작, 끝]초, 이음매마다 아주 짧게 페이드), hp = 이 Hz 아래를 걸러 냄, norm = 크기 맞추기
      parts?: [number, number][]; hp?: number; norm?: true
      // (11/19 6단계 추가) loop = 끊김 없이 반복되게 끝 뒤 loop초를 머리에 겹쳐 섞어요(.wav로 쓰면 이음매 틈도 없음)
      loop?: number }
  // (11/17 추가) crop = 이미지(이미 뽑은 정지 이미지)에서 기울어진 종이 한 장을 바로 세워 잘라요(3D 소품 그림).
  //   cx, cy = 종이 가운데(원본 픽셀), w × h = 자를 크기, deg = 바로 세우려고 돌릴 각도(+ 시계 방향), size = 결과 가로 픽셀
  //   paper·ink를 주면 영상 속 손글씨 획(어두운 부분)만 뽑아 깨끗한 종이 색 위에 다시 얹어요
  //   (영상의 VHS 흰 줄·옆 포스트잇 색이 종이에 박혀 있어서 — 글씨는 촬영한 손글씨 그대로)
  //   (11/19 추가) alpha = 배경을 투명하게: 'ink' 어두운 글씨만(검정) / 'blue' 파란 물감만(흰색 — 게임이 색을 칠해요)
  | { out: string; kind: 'crop'; src: string; cx: number; cy: number; w: number; h: number; deg: number; size: number; paper?: string; ink?: string; alpha?: 'ink' | 'blue' }
  // (11/19 추가) memory = 옛 녹화: 영상에서 여러 장면을 잘라 이어 붙이고, 장면마다 위 메모·아래 날짜 + 색깔 손바닥을 구워 넣어요(scripts/memory-overlay.py)
  | { out: string; kind: 'memory'; src: string; hand: string; font: string; shots: { from: number; to: number; memo: string; date: string; color: string }[] }
  // (11/20 추가) letters = 단색 바탕 위 글씨 그림에서 바탕을 투명하게 오려 내고(가장자리 색 정리), 빛 번짐 그림(glow)도 같이 만들어요(scripts/letters-alpha.py).
  //   w = 글씨 그림 가로 픽셀(빛 번짐은 그 절반). 계단 꼭대기 congratulations! 문의 홀로그램 글씨
  | { out: string; kind: 'letters'; src: string; glow: string; w: number };

export const JOBS: Job[] = [
  // ── 인트로 (최종 0~10.5초) ──────────────────────────
  { out: 'intro/title.mp4', kind: 'loop', src: SRC.final, from: 0.0, to: 4.0 }, // 9분할 + WELCOME TO LEVEL 0
  { out: 'intro/loading.mp4', kind: 'clip', src: SRC.final, from: 4.0, to: 7.0 }, // LOADING...
  { out: 'intro/error.mp4', kind: 'clip', src: SRC.final, from: 7.0, to: 11.0 }, // 암흑 → 파란 화면 → 지지직
  { out: 'intro/intro.mp3', kind: 'audio', src: SRC.final, from: 4.0, to: 11.0 }, // 위 두 클립의 소리(영상과 똑같이)
  // (11/17 추가) 3D 본 게임 인트로: 타이틀 → LOADING → 에러를 한 파일로(아이폰에서 누르는 순간 바로 재생되게, 넘어갈 때 끊김 없게).
  // 10.5초부터의 실사 하얀 방 지지직은 빼요(사용자 의견: 실사 → 3D가 이질적). 위 네 줄은 2.5D 보관본(legacy.html)이 써서 남겨요
  // (11/17 2차 변경) 640×480으로(폰에서 LOADING 화면이 끊기던 것: 매 장면을 그래픽 카드로 올리는 양이 반으로 줄어요. 캠코더 화면도 640×480이라 화질 차이 없음)
  { out: 'intro/full.mp4', kind: 'clip', src: SRC.final, from: 0.0, to: 10.47, w: 640 },
  // 음악은 0초부터(타이틀에서도 들림). 원래 영상은 지지직(10.1~10.38초)이 10.39초에 실사 하얀 방으로 바뀌며 뚝 끊겨요.
  // (11/17 3차 변경) ~~지지직을 1.5초 동안 되풀이하며 잦아들게~~(짧은 소리가 반복돼 인위적) → 원래 소리 그대로 10.39초까지, 끝 0.15초만 페이드아웃
  { out: 'intro/full.mp3', kind: 'audio', src: SRC.final, from: 0.0, to: 10.39, fadeOut: 0.15 },

  // ── 하얀 방 (최종 11~13.5초) ────────────────────────
  { out: 'white/a.webp', kind: 'still', src: SRC.final, at: 11.65, pick: 0.1 }, // 11.4초 앞은 지지직이 심함
  { out: 'white/b.webp', kind: 'still', src: SRC.final, at: 12.6 },
  { out: 'white/m-a-b.mp4', kind: 'clip', src: SRC.final, from: 11.6, to: 12.6 },
  { out: 'white/m-out.mp4', kind: 'clip', src: SRC.final, from: 12.8, to: 14.0 }, // 뒤돌아보기 → 통로

  // ── 통로·안내판 (최종 14~23.5초) ────────────────────
  { out: 'corridor/hall.webp', kind: 'still', src: SRC.final, at: 14.5 }, // (11/16) 반복 클립 → 정지 이미지 + 손떨림
  { out: 'corridor/m-sign.mp4', kind: 'clip', src: SRC.final, from: 15.3, to: 18.3 }, // 안내판이 정면으로 올 때까지
  { out: 'corridor/sign.webp', kind: 'still', src: SRC.final, at: 18.5 },
  { out: 'corridor/m-corner.mp4', kind: 'clip', src: SRC.final, from: 19.5, to: 22.0 },
  { out: 'corridor/corner.webp', kind: 'still', src: SRC.final, at: 22.0 },
  { out: 'corridor/m-out.mp4', kind: 'clip', src: SRC.final, from: 22.2, to: 23.5 }, // 다가가기 → 포스트잇의 방

  // ── 포스트잇의 방 (최종 23.5~41.5초) ────────────────
  { out: 'postit/corner.webp', kind: 'still', src: SRC.final, at: 23.6, pick: 0.15 }, // 23.3초 앞은 어두운 전환
  { out: 'postit/m-corner-ceiling.mp4', kind: 'clip', src: SRC.final, from: 23.6, to: 25.3 },
  { out: 'postit/ceiling.webp', kind: 'still', src: SRC.final, at: 25.3, pick: 0.08 }, // 25.0초는 흔들려 번짐
  { out: 'postit/m-ceiling-wall.mp4', kind: 'clip', src: SRC.final, from: 25.3, to: 27.5 },
  { out: 'postit/wall.webp', kind: 'still', src: SRC.final, at: 27.5 }, // (11/16) 반복 클립 → 정지 이미지
  { out: 'postit/m-wall-whites.mp4', kind: 'clip', src: SRC.final, from: 28.0, to: 29.2 },
  { out: 'postit/whites.webp', kind: 'still', src: SRC.final, at: 29.6 },
  { out: 'postit/behind.webp', kind: 'still', src: SRC.final, at: 31.5 }, // 시키는 대로 돌아본 맨벽 (11/16 정지 이미지로)
  { out: 'postit/m-behind-wall.mp4', kind: 'clip', src: SRC.final, from: 35.0, to: 36.1 },
  { out: 'postit/wall-gone.webp', kind: 'still', src: SRC.final, at: 36.2 },
  { out: 'postit/m-andyou-in.mp4', kind: 'clip', src: SRC.final, from: 36.2, to: 38.1 },
  { out: 'postit/andyou.webp', kind: 'still', src: SRC.final, at: 38.2 },
  { out: 'postit/peel.mp4', kind: 'clip', src: SRC.final, from: 38.8, to: 41.0 },
  { out: 'postit/reddot.webp', kind: 'still', src: SRC.final, at: 41.5, pick: 0 }, // 41.1초 근처는 손이 움직여 번짐

  // 되감기 테이프: AI 미적용 편집본 (흰 종이 몇 장뿐인 원래 벽)
  { out: 'postit/tape-enter.mp4', kind: 'tape', src: SRC.raw, from: 23.4, to: 27.0 }, // 23.0~23.4초는 어두운 전환
  { out: 'postit/tape-whites.mp4', kind: 'tape', src: SRC.raw, from: 27.0, to: 30.9 },
  { out: 'postit/tape-behind.mp4', kind: 'tape', src: SRC.raw, from: 30.9, to: 35.5 },

  // ── 소리 ───────────────────────────────────────────
  { out: 'sound/hum.mp3', kind: 'audio', src: `${SRC.cues}/012_A5_hum_level0.wav`, mono: true },
  { out: 'sound/click.mp3', kind: 'audio', src: `${SRC.cues}/003_A2_title_click.wav` },
  { out: 'sound/whip.mp3', kind: 'audio', src: `${SRC.cues}/014_A3_whip_postit.wav` },
  { out: 'sound/whip-back.mp3', kind: 'audio', src: `${SRC.cues}/021_A3_whip_back.wav` },
  { out: 'sound/andyou-pop.mp3', kind: 'audio', src: `${SRC.cues}/022_A2_andyou_pop.wav` },
  { out: 'sound/peel.mp3', kind: 'audio', src: `${SRC.cues}/024_A2_postit_peel.wav` },
  { out: 'sound/flip.mp3', kind: 'audio', src: `${SRC.cues}/025_A2_postit_flip.wav` },
  // (11/16) 안내음성 '최종': 앞 6.5초 무음을 빼고 두 문장으로 나눔. 종소리와 "Thank you"는 영상에서도 뺀 것이라 안 써요.
  { out: 'sound/voice-behind.mp3', kind: 'audio', src: `${SRC.voice}/포스트잇방_안내음성_최종.wav`, from: 6.45, to: 8.15, mono: true }, // "The exit is behind you."
  { out: 'sound/voice-follow.mp3', kind: 'audio', src: `${SRC.voice}/포스트잇방_안내음성_최종.wav`, from: 8.15, to: 10.5, mono: true }, // "Please follow the instructions."
  { out: 'sound/bitshift.mp3', kind: 'audio', src: `${SRC.music}/bit_shift.mp3` },
  // (11/20 추가, 사용자 의견) 3D 끝 화면(파란 화면)에 머무는 동안 반복: 인트로와 같은 노래 Bit Shift — 영화 편집처럼 0.09초부터(timeline/edit.json).
  //   모노로(폰 메모리 — 다 풀면 스테레오의 절반)
  { out: 'sound/bitshift-end.mp3', kind: 'audio', src: `${SRC.music}/bit_shift.mp3`, from: 0.09, to: 192.05, mono: true },
  // (11/17 추가) 포스트잇의 방 정전 연출: 깜빡임(전기 지지직) → 전등 나감(무거운 스위치) → 다시 켜짐
  // (11/17 변경) 하얀 방 벽 지지직 소리(glitch_static)는 사용자 의견으로 뺐어요
  { out: 'sound/flicker.mp3', kind: 'audio', src: `${SRC.sfx}/glitch_crackles.wav`, mono: true },
  { out: 'sound/lights-out.mp3', kind: 'audio', src: `${SRC.sfx}/bass_switch.wav`, mono: true },
  { out: 'sound/lights-on.mp3', kind: 'audio', src: `${SRC.sfx}/electric_switch.wav`, mono: true },

  // ── (11/17 추가) 3D 포스트잇의 방 소품 그림: 위의 정지 이미지에서 종이 한 장씩 바로 세워 잘라요 ──
  // 흰 종이 5장(postit/whites.webp, 1440×1080). 기울기는 종이 윗변을 보고 잼
  { out: 'postit/n-hurry.webp', kind: 'crop', src: 'public/media/postit/whites.webp', cx: 544, cy: 284, w: 270, h: 270, deg: -6, size: 192, paper: '#B9C5D1', ink: '#23232B' },
  { out: 'postit/n-this-way.webp', kind: 'crop', src: 'public/media/postit/whites.webp', cx: 1028, cy: 280, w: 262, h: 262, deg: 7.4, size: 192, paper: '#B9C5D1', ink: '#23232B' },
  { out: 'postit/n-no-that-way.webp', kind: 'crop', src: 'public/media/postit/whites.webp', cx: 712, cy: 616, w: 262, h: 262, deg: 4, size: 192, paper: '#B9C5D1', ink: '#23232B' },
  { out: 'postit/n-just-follow.webp', kind: 'crop', src: 'public/media/postit/whites.webp', cx: 312, cy: 740, w: 208, h: 208, deg: -13.5, size: 192, paper: '#B9C5D1', ink: '#23232B' },
  { out: 'postit/n-too-late.webp', kind: 'crop', src: 'public/media/postit/whites.webp', cx: 964, cy: 826, w: 280, h: 215, deg: 0, size: 192, paper: '#B9C5D1', ink: '#23232B' },
  // and you?(postit/andyou.webp). 뒷면(빨간 점)은 게임이 이 그림을 뒤집어 옅게 비치게 하고 빨간 점을 찍어 만들어요
  { out: 'postit/n-andyou.webp', kind: 'crop', src: 'public/media/postit/andyou.webp', cx: 714, cy: 420, w: 790, h: 545, deg: 15.8, size: 384, paper: '#ACC8E2', ink: '#26262E' },

  // ── (11/19 추가) 5단계: 빨간 점 → 따뜻한 방 → 옛 녹화 → 맨벽 → 창밖 (최종 41~71초) ─────────────
  // 손자국·글씨 그림: 영상 정지 이미지에서 모양만 뽑아(배경은 투명) 3D 벽에 붙여요. 손자국 색은 게임이 칠해요(설계서의 다섯 색)
  { out: 'warm/s-hand.webp', kind: 'still', src: SRC.final, at: 58.2, pick: 0 }, // 코발트 손자국이 정면으로 또렷한 장면
  { out: 'warm/s-text.webp', kind: 'still', src: SRC.final, at: 56.6, pick: 0 }, // "we were here"가 또렷한 장면
  { out: 'warm/hand.webp', kind: 'crop', src: 'public/media/warm/s-hand.webp', cx: 820, cy: 552, w: 500, h: 600, deg: -8, size: 256, alpha: 'blue' },
  { out: 'warm/text.webp', kind: 'crop', src: 'public/media/warm/s-text.webp', cx: 700, cy: 468, w: 700, h: 136, deg: 6, size: 512, alpha: 'ink' },
  // 옛 녹화: 추억 몽타주에서 네 장면을 0.6초씩, 설계서의 재생 순서대로(2024 → 2022 → 2025 → 2023).
  // 왼쪽 아래 구석에 3글자 메모, 오른쪽 아래(캠코더 날짜 자리)에 "연도. 월 - [색깔 동그라미]"를 영상에 구워 넣어요(테이프에서 멈춰 읽을 것이라 키프레임은 2프레임마다)
  // (11/19 2차 변경, 사용자 의견) ~~가운데 크게, 색깔 손바닥~~ → 구석·날짜 자리, 색깔 동그라미
  {
    out: 'warm/old.mp4', kind: 'memory', src: `${D}/추억 몽타주 생성 영상 (컷편집 완료, 둘중 더 나은걸로 채택)/추억 몽타주_최종 컷편집.MP4`,
    hand: 'public/media/warm/hand.webp', font: 'public/fonts/VCR_OSD_MONO.ttf',
    shots: [
      // (11/19 4차 변경) 동그라미 색 = 방의 손자국 색과 똑같이(rooms/warm.ts의 C). ~~설계서 색 그대로~~(방 손자국은 화면에서 또렷하게 읽히게 더 선명한 색이라 서로 달라 보였어요)
      { from: 14.2, to: 14.8, memo: 'OUR', date: '2024. 07 -', color: '#a64dff' }, // 네컷사진 · 라일락
      { from: 8.3, to: 8.9, memo: 'WAY', date: '2022. 03 -', color: '#14e07e' }, // 강변 자전거 · 민트
      { from: 23.4, to: 24.0, memo: 'BYE', date: '2025. 08 -', color: '#ff2e96' }, // 불꽃놀이 · 버블검 핑크
      { from: 11.1, to: 11.7, memo: 'SEA', date: '2023. 05 -', color: '#f2ac00' }, // 바다 점프 · 머스터드
    ],
  },
  // 소리: 영화 편집 때 쓴 큐(빨간 점이 부풀어 오름, 문 삐걱, 먹먹한 웃음소리, 추억이 스칠 때)와 음악
  // (11/19 3차 변경, 사용자 의견) ~~빨간 점이 부풀어 오르는 큐(red-swell)~~ → 사용자가 녹음한 캠코더 줌 모터 소리(줌인.wav).
  // 모터가 도는 소리(20~123초)에서: 줌 인(18.55초 모터 시작 ~ 0.9초) + 멈춤(124.1초) → 줌 아웃(104초 ~ 0.85초) + 멈춤.
  // 빨간 점 전환(빨갛게 차오름 1.1초 → 갈색으로 걷힘 1.3초)에 맞춘 한 파일. 19초쯤의 낮은 쿵(손 닿는 소리)은 500Hz 아래를 걸러 없애요
  { out: 'sound/zoom.mp3', kind: 'audio', src: `${D}/입장~출구 본편 촬영본/줌인.wav`, mono: true, hp: 500, norm: true,
    parts: [[18.55, 19.45], [123.92, 124.3], [104.0, 104.85], [123.92, 124.35]] },
  { out: 'sound/door-creak.mp3', kind: 'audio', src: `${SRC.cues}/028_A2_door_creak.wav`, mono: true },
  { out: 'sound/laugh.mp3', kind: 'audio', src: `${SRC.cues}/030_A3_laugh_muffled.wav`, mono: true },
  { out: 'sound/memory.mp3', kind: 'audio', src: `${SRC.cues}/031_A3_memory_swell.wav`, mono: true },
  { out: 'sound/montage-laugh.mp3', kind: 'audio', src: `${SRC.cues}/033_A3_montage_laugh.wav`, mono: true },
  { out: 'sound/dreamy.mp3', kind: 'audio', src: `${SRC.music}/dreamy_flashback.mp3`, mono: true }, // CC BY 4.0 — 크레딧에 표기
  // (11/19 2차 추가) 오답: 짧은 지지직(영화의 and you? 글리치 큐 0.5초) — 화면이 살짝 찢어지는 것과 같이(사용자 의견: 음악만 끊기면 오류 같음)
  { out: 'sound/wrong.mp3', kind: 'audio', src: `${SRC.cues}/023_A3_andyou_glitch.wav`, mono: true },

  // ── (11/19 6단계 추가) 잠긴 문 추격 — 영화 편집 큐(최종 영상 01:11~01:31) + 경고음·안내음성 원본 ──
  // 큐 파일은 영화 믹스 크기 그대로라 들쭉날쭉해서, 크기를 맞추고(norm) 게임 데이터(data.ts)에서 서로의 크기를 정해요
  { out: 'sound/thud.mp3', kind: 'audio', src: `${SRC.cues}/046_A3_thud3.wav`, mono: true, norm: true, parts: [[0, 1]] }, // 멀리서 다가오는 쿵(입체 음향으로 그 등 자리에서)
  // 비상 경고음 "빠앙": 정확히 1.15초 주기 → 8주기(9.2초)를 잘라 반복. 이음매는 소리가 잦아든 꼬리(1.10초)
  // (11/19 6단계 2차 변경, 사용자 의견: 반복될 때 "틱" 튀는 소리) ~~mp3~~ → 꼬리 0.3초를 머리에 섞은 .wav(빈 틈 없음)
  { out: 'sound/alarm.wav', kind: 'audio', src: `${SRC.voice}/비상경고음_빠앙_12초.wav`, from: 1.1, to: 10.3, mono: true, loop: 0.3 },
  // (11/19 6단계 2차 추가, 사용자 의견) 실패할 때 지지직(영화 에러 화면의 잡음) — 경고음은 같이 늘어지며 낮아져요(Room.fail)
  { out: 'sound/chew.mp3', kind: 'audio', src: `${SRC.cues}/007_A3_err_static.wav`, from: 0, to: 1.6, fadeOut: 0.6, mono: true },
  // (11/20 변경, 사용자 의견) ~~거친 숨(문 앞에 섰을 때) breath-run.mp3~~ 숨소리는 빼요
  { out: 'sound/key-try1.mp3', kind: 'audio', src: `${SRC.cues}/043_A2_try1.wav`, mono: true, norm: true, parts: [[0, 1.2]] }, // 1차: 열쇠가 헛돎
  { out: 'sound/key-try2.mp3', kind: 'audio', src: `${SRC.cues}/045_A2_try2.wav`, mono: true, norm: true, parts: [[0, 0.6]] }, // 2차 / 틀린 열쇠: 자물쇠가 걸림
  { out: 'sound/key-try3.mp3', kind: 'audio', src: `${SRC.cues}/048_A2_try3.wav`, mono: true, norm: true, parts: [[0, 1.0]] },
  { out: 'sound/keys-drop.mp3', kind: 'audio', src: `${SRC.cues}/049_A2_keys_drop.wav`, mono: true }, // 3차: 꾸러미가 바닥에 와르르
  { out: 'sound/keys-jingle.mp3', kind: 'audio', src: `${SRC.cues}/041_A2_keys_jingle.wav`, mono: true, norm: true, parts: [[0, 1.0]] }, // 열쇠 더미 헤치기 "짤랑"
  { out: 'sound/red-key.mp3', kind: 'audio', src: `${SRC.cues}/050_A3_red_key_beat.wav`, mono: true, norm: true, parts: [[0, 1.2]] }, // 빨간 점 열쇠가 드러남(심장 쿵)
  { out: 'sound/unlock.mp3', kind: 'audio', src: `${SRC.cues}/051_A2_click_unlock.wav`, mono: true }, // 딸깍
  { out: 'sound/door-open.mp3', kind: 'audio', src: `${SRC.cues}/053_A2_door_open_scary.wav`, mono: true, norm: true, parts: [[0, 1.8]] },
  { out: 'sound/slam.mp3', kind: 'audio', src: `${SRC.cues}/054_A2_slam.wav`, mono: true }, // 쾅!
  { out: 'sound/slam-boom.mp3', kind: 'audio', src: `${SRC.cues}/056_A3_slam_boom.wav`, mono: true, norm: true, parts: [[0, 1.6]] }, // 쾅의 낮은 울림
  // (11/20 변경, 사용자 의견) ~~쾅 뒤 정적 속 숨 breath-exit.mp3~~ 숨소리는 빼요
  // 안내음성: 최종 영상과 같은 순서 — 2.56~6.24초(84.3초·86.4초에 나오는 두 마디) → 6.52~8.76초(87.9초부터, 쾅에 1.25초쯤에서 잘림 "Please do not lo—")
  { out: 'sound/voice-key.mp3', kind: 'audio', src: `${SRC.voice}/안내음성_한목소리.wav`, from: 2.5, to: 6.3, mono: true },
  { out: 'sound/voice-donot.mp3', kind: 'audio', src: `${SRC.voice}/안내음성_한목소리.wav`, from: 6.46, to: 8.8, mono: true },

  // ── (11/20 추가) 계단참 루프 — 0-4를 지나면 꼭대기에 나타나는 congratulations! 문 ──
  // 사용자가 준 글씨 그림(회색 그러데이션 바탕, 2400×800 — 원래 프로젝트 맨 위에 있던 것을 assets-src/로 옮김, 사용자 허락)을
  // 바탕만 투명하게 오려 내고 빛 번짐 그림도 같이(게임에서 두께 있는 홀로그램 글씨로 그려요 — world.ts buildHolo)
  { out: 'stairs/congrats.webp', kind: 'letters', src: 'assets-src/stairs/congratulations.png', glow: 'stairs/congrats-glow.webp', w: 1024 },

  // ── (11/20 7단계 추가) 엔딩 — congratulations! 문이 열리면 차오르는 드론(영화 엔딩과 같은 구간: 74.5초 무렵의 부풀어 오름이 문과 만나요) ──
  // "The Gates of Heaven" Jovica (CC BY 4.0) — 크레딧·끝 화면에 표기
  { out: 'sound/gates.mp3', kind: 'audio', src: `${D}/엔딩 파란화면 카피 크레딧/84791__jovica__layers-011-the-gates-of-heaven-98.flac`, from: 74.5, to: 154.5, mono: true, fadeOut: 4 },

  // ── (11/26 추가) 졸전 아이패드 키오스크(public/kiosk.html) 왼쪽에 반복 재생하는 단편 최종본 — 편집은 그대로, 용량만 줄임(음소거 자동 재생이라 소리 없음) ──
  { out: 'kiosk/film.mp4', kind: 'clip', src: SRC.final, from: 0, to: 117.57, w: 800 }, // 960은 26.8MB라 800(25MB 이하 기준)
];
