/**
 * 방 데이터 v2 (2026-11-16) — 풀 3D용.
 *
 * v1(src/data/schema.ts)에서 그대로 가져온 것: 조건, 행동(대부분), 규칙, 타이머, 가방·메모·소리.
 * 바뀐 것: 시점·배경·클릭 영역 → 공간(상자)·소품·조준 대상·바닥 영역·서는 자리.
 *
 * - 전부 "순수 데이터"예요(함수 없음). 논리(logic.ts)와 3D 세계(world.ts)가 이 데이터를 읽어요.
 * - 단위는 미터. 가운데 숫자가 높이(y). yaw 0 = -z 쪽을 봄, 90 = -x 쪽, -90 = +x 쪽, 180 = +z 쪽.
 * - 그림 파일 경로는 public/ 기준.
 */
import type { Cond, Flag, ItemId, NoteId, SoundId, StatKey } from '../data/schema.ts';
import type { Box, Lamp, V3 } from '../lab3d/room.ts';

export type { Box, Cond, Lamp, V3 };
export type RoomId = string;

// ── 행동 ─────────────────────────────────────────────

/**
 * 방을 옮길 때의 화면 효과.
 * through = 벽을 통과하듯 그대로 걸어 들어감(벽에 닿는 순간 지지직 → 새 공간의 벽에서 걸어 나옴),
 * fade = 어두워졌다 밝아짐, cut = 바로.
 * (11/16 변경) 휩팬(whip)은 방향 감각이 실제와 달라져 헷갈린다는 사용자 의견으로 뺐어요.
 */
// (11/19 추가) red = 빨간 점에 줌한 채로 화면이 빨갛게 차오름 → 갈색으로 식으며 새 공간(포스트잇의 방 → 갈색 문, 영상 41~42초)
export type Fx = 'through' | 'fade' | 'cut' | 'red';

/**
 * "일어나는 일". 위에서부터 차례로 실행돼요.
 * wait / (wait: true인) voice / room / warp는 끝날 때까지 다음 줄이 기다려요.
 */
export type Action =
  // 이동
  | { do: 'room'; room: RoomId; spawn?: string; via?: Fx } // 다른 방으로(체크포인트 저장)
  | { do: 'warp'; spawn: string; via?: Fx } // 같은 방 안의 다른 자리로
  | { do: 'wait'; ms: number }
  | { do: 'lock'; off?: true } // 걷기·조작 잠그기 / 풀기
  // (11/17 추가) 전체 화면 영상 한 번(옛 녹화·엔딩 같은 실사). 끝날 때까지 기다려요. 경로는 public/media/ 기준
  // (11/18 추가) 영상은 테이프에도 실사로 찍혀요 — 되감으면 그 대목에서 3D 대신 이 영상이 나와요(옛 녹화를 멈춰 읽기). tape: false = 테이프에 안 남김
  // (11/21 추가) index = 테이프에서 ◀◀·▶▶로 감을 때 저절로 멈추는 자리(영상 안 초 — 옛 녹화 4장면의 가운데). tape.ts의 INDEX 멈춤
  | { do: 'clip'; clip: string; tape?: false; index?: number[] }
  | { do: 'pick'; prop: string } // (11/17 추가) 벽의 소품(종이)이 떨어져 캠코더 앞으로 와요(손 없이 — 손에 든 것처럼). 끝날 때까지 기다려요
  | { do: 'flip'; prop: string } // (11/17 추가) 캠코더 앞의 종이를 뒤집어 뒷면을 보여요(and you? → 빨간 점)
  | { do: 'light'; fx: 'flicker' | 'off' | 'on' } // (11/17 추가) 방의 불: 깜빡이다(끝날 때까지 기다림) / 꺼짐(암흑 — 이때 바뀌는 건 보는 중이어도 바뀜) / 팍 켜짐
  // (11/17 추가) 화면 위쪽의 한국어 안내 문구. text 없으면 지움, add면 한 줄 더. count·of = 빈 네모 of칸이 개수만큼 채워짐
  // (11/19 3차 추가) strong = 한 단계 더 나아간 힌트(1분 뒤 문구): 노란 글씨가 은은하게 빛나요
  | { do: 'goal'; text?: string; add?: true; count?: string; of?: number; strong?: true }
  // (11/19 6단계 추가) 카메라가 그 자리로 저절로 걸어가며 돌아서요(ms 동안, 끝날 때까지 기다림) — 잠긴 문을 열고 뛰어들어 돌아서기
  | { do: 'walk'; spawn: string; ms: number }
  // (11/19 6단계 추가) 이 방의 "다시 시작할 자리"를 지금 상태로 찍어요(실패하면 방 처음이 아니라 여기부터). name = 실패 횟수 이름(fails.<name>)
  //   잠긴 문: 따뜻한 방과 한 방 데이터라, 문 앞에 서면 찍어서 실패해도 따뜻한 방 퍼즐을 다시 안 풀게
  | { do: 'checkpoint'; spawn: string; name?: string }
  // 기억
  | { do: 'set'; flag: Flag; off?: true }
  // (11/19 6단계 추가) set = 그 값으로 맞춤(계단 층 표시를 0-1로 되돌리기)
  | { do: 'add'; count: string; by?: number; set?: number }
  | { do: 'stat'; key: StatKey; by?: number }
  | { do: 'give'; item: ItemId }
  | { do: 'take'; item: ItemId }
  | { do: 'note'; note: NoteId }
  // 소리
  // (11/19 6단계 추가) at = 그 자리에서 나는 소리(입체 음향 — 등 뒤에서 나면 먹먹하고, 돌아보면 또렷해요)
  | { do: 'sound'; sound: SoundId; at?: V3; fade?: number } // (11/20 2차 추가) fade = 서서히 커지며 시작(ms) — 끝 화면 노래
  // (11/19 6단계 추가) 바탕음(험)이 물속처럼 먹먹해졌다 ms 뒤 돌아와요(계단 0-4의 신호)
  | { do: 'muffle'; ms: number }
  | { do: 'stop'; sound: SoundId; fadeMs?: number; slow?: true } // (11/19 추가) slow = 테이프가 늘어지듯 음이 낮아지며 느려지다 멈춤(fadeMs 동안)
  | { do: 'voice'; sound: SoundId; wait?: true }
  | { do: 'amb'; sound?: SoundId } // (11/17 추가) 바탕음 바꾸기(없으면 끔). 방 하나 안에서 소리가 바뀔 때(하얀 방의 정적 → 험)
  // (11/19 추가) 바탕음 묶음(amb — 음악·웃음소리처럼 bus가 amb인 소리도)을 ms 동안 뚝 끊었다가 돌려놔요. 끝날 때까지 기다려요(따뜻한 방 오답)
  | { do: 'hush'; ms: number }
  // (11/19 추가) 화면 노이즈 한 번: level = 트래킹 노이즈 세기(0~1, 곧 잦아듦), ms = 화면이 찢어지는 지지직 길이(없으면 안 찢어짐)
  | { do: 'noise'; level: number; ms?: number }
  // 긴장 밖의 안내
  | { do: 'hint'; text: string; touch?: string } // (11/17 추가) 한국어 조작 안내(번지지 않는 글씨). touch = 폰에서 대신 보일 글씨
  // 긴장
  | { do: 'timer'; timer: string; stop?: true }
  | { do: 'vhs'; level: number }
  | { do: 'osd'; text: string; ms?: number }
  | { do: 'fail' } // 테이프 씹힘 → 이 방 처음부터
  // (11/20 7단계 추가) 엔딩 타자 글씨: 화면 가운데에 검은 VCR 글씨가 한 글자씩(깜빡이는 네모 커서, 8비트 타자음).
  //   text = 새 줄 하나를 쳐요(끝날 때까지 기다림, '' = 빈 줄), ms = 한 글자 간격(기본 70, 크레딧은 빠르게), size = 글씨 크기(640×480 기준 px)
  //   clear = 다 지우고 커서만, off = 타자 글씨 화면을 끔(캠코더 글씨로 돌아감)
  //   (11/20 2차 변경) ~~ms = 한 글자 간격~~ → 빠르기는 영화 엔딩과 같게 고정, fast = 크레딧처럼 아주 빠르게(한 프레임에 약 3.5글자)
  | { do: 'type'; text?: string; fast?: true; size?: number; clear?: true; off?: true }
  // (11/20 2차 추가) 바닥 없는 곳으로 떨어짐(ms 동안 depth미터, 끝날 때까지 기다림) — congratulations! 문 너머 무의 공간
  | { do: 'fall'; ms: number; depth: number }
  // (11/20 7단계 추가) 끝 화면(기록·출처·방 이름의 뜻) — 게임이 끝나요
  | { do: 'end' }
  // 갈림
  | { do: 'if'; when: Cond; then: Action[]; else?: Action[] };

// ── 공간에 놓이는 것 ──────────────────────────────────

/** 벽에 붙는 평면이 바라보는 방향. (11/17 추가) y- = 천장(아래를 봄). (11/18 추가) y+ = 바닥(위를 봄 — 계단의 흩어진 열쇠 같은 것). */
export type Face = 'x+' | 'x-' | 'z+' | 'z-' | 'y-' | 'y+';

/**
 * 소품의 겉면: 그림 파일 / 코드로 그린 무늬.
 * portal = 너머로 가는 벽(멀리선 그냥 벽, 가까이 가면 그 자리에 은은한 지지직). dotted-door = 점선 문(시험용, 안 씀).
 */
export type Skin = { img: string } | { gen: 'dotted-door' } | { gen: 'portal' } // (11/19 2차) 벽에 붙이던 햇살 무늬(gen: 'sun')는 진짜 창 햇살(Room.sun)로 바꿔서 뺐어요
  // (11/19 6단계 추가) 코드로 그린 열쇠(은색, 배경 투명 — blend: 'alpha'로): key 그냥 / key-red 머리에 빨간 점 / key-dull 같은 점이 어두운 회색(어둠 속 실루엣)
  | { gen: 'key' | 'key-red' | 'key-dull' }
  // (11/20 6단계 계단참 추가) 코드로 그린 표지판: 판 색(bg)에 글씨 줄(fg) — 계단실 층 표시(0-1)·영어 안내판(건물 표지판, 사용자 결정)
  | { sign: string[]; bg: string; fg: string }
  // (11/20 6단계 계단참 추가) 홀로그램 글씨: 투명 바탕 글씨 그림 + 빛 번짐 그림(public/ 기준). 두께가 있고, 보는 각도에 따라 무지개 빛이 흐르고,
  //   스스로 빛나요(구운 빛 안 받음). 처음 눈에 들어오는 순간 깜빡이며 켜져요 — 꼭대기 congratulations! 문(사용자가 준 글씨 그림, fixtures.ts)
  | { holo: string; glow: string }
  // (11/20 6단계 2차 추가) 한 가지 색으로 칠한 판(lit: false면 스스로 빛나요 — congratulations! 문틈으로 새어 나오는 빛)
  | { color: string };

/** 소품(지금은 벽에 붙는 평면 한 장: 안내판, 점선 문, 포스트잇 …). */
export interface Prop {
  id: string;
  /** 가로, 세로(미터). */
  plane: [w: number, h: number];
  at: V3;
  face: Face;
  skin: Skin;
  /** 이 조건이 맞을 때만 보여요. */
  when?: Cond;
  /** unseen = 화면에 안 보일 때만 나타나거나 사라져요(눈앞에서 툭 바뀌지 않게). */
  swap?: 'unseen';
  /**
   * live = 지금 눈에만 보임 / tape = 되감은 테이프에만 찍혀 있음. 없으면 둘 다.
   * (11/18) 계단 설계서의 tapeOnly: true = layer: 'tape'. 테이프에서는 when을 "그 시각의 상태"로 검사해요.
   * 떼어 드는 소품(pick)은 라이브용·테이프용 둘로 나눠 적어요(포스트잇의 방 and you? 참고).
   */
  layer?: 'live' | 'tape';
  /** (11/17 추가) 면 위에서 기울인 각도(도, + = 보는 사람 기준 시계 반대 방향). 종이가 비뚤게 붙은 것처럼 */
  tilt?: number;
  /**
   * (11/19 추가) 그림을 붙이는 방식. alpha = 그림의 투명한 곳은 비침(손자국·글씨) / add = 빛처럼 더해짐(햇살 무늬).
   * 없으면 그림 그대로 네모(종이처럼).
   */
  blend?: 'alpha' | 'add';
  /** (11/19 추가) 그림에 곱할 색(sRGB) — 흰 손자국 그림 하나를 여러 색으로 칠해요 */
  tint?: string;
  /**
   * (11/19 추가) false = 구운 빛에 물들지 않음(스스로 빛나는 것).
   * (11/19 2차 추가) mono = 구운 빛의 밝기만 받고 색은 안 받음 — 따뜻한 빛에 물들어 손자국 색이 탁해지지 않게
   */
  lit?: false | 'mono';
  /** (11/19 추가) 좌우를 뒤집어 붙여요(오른손 → 왼손) */
  mirror?: true;
  /**
   * (11/19 2차 추가) 같은 이름끼리 한 덩어리로 묶어 한 번에 그려요(손자국 70개 → 그리기 1회, 폰 부담).
   * 묶음은 같은 그림·같은 when·같은 layer여야 해요(보이고 숨는 것도 같이). 색(tint)과 자리·기울기는 제각각 돼요.
   */
  group?: string;
  /**
   * (11/19 4차 추가) 가장자리를 이만큼 어둡게(0~1) — 그림 둘레에 얇은 어두운 테두리. 밝은 벽에서 노랑 손자국이 묻히지 않게.
   * 묶음(group)에서는 첫 소품 값을 써요.
   */
  edge?: number;
  /**
   * (11/20 7단계 추가) 색 판(skin.color)을 흰색보다 몇 배 밝게 — 노출을 올리지 않아도 하얗게 날아가 빛나요(문 너머 하얀 공간).
   * 화면 전체 노출을 올리면 계단실까지 고르게 회색으로 떠 버려서(사용자: 구조물이 부자연스러움) 이 판만 밝게
   */
  power?: number;
}

/**
 * (11/17 추가) 흩뿌린 종이 — 같은 모양 수천 장을 한 번에 그려요(포스트잇 벽·천장).
 * 면마다 칸을 나눠 한 장씩 조금씩 비뚤게, 조금씩 겹치게 붙여요. 글씨는 손글씨풍 단어 그림 64개 중에서 골라요.
 * chunk 크기로 조각을 나눠 조각마다 따로 보이고 숨어요(swap: 'unseen'이면 안 보는 조각부터 하나씩 사라짐).
 * 천장 면에서는 천장등 자리를 비워요.
 */
export interface Scatter {
  id: string;
  /** 붙일 면들. face = 면이 바라보는 쪽, at = 면의 가운데(벽 표면 위), size = [가로, 세로](미터, 면의 u·v 방향) */
  areas: { face: Face; at: V3; size: [number, number] }[];
  /** 종이 한 장 크기(미터). 칸 간격은 이것의 90%(살짝 겹치게) */
  note: number;
  /** 종이 색(sRGB)에서 골고루 */
  colors: string[];
  /** 같은 배치가 나오게 하는 씨앗 */
  seed: number;
  /** 조각 크기(미터) */
  chunk: number;
  when?: Cond;
  swap?: 'unseen';
  layer?: 'live' | 'tape';
  /** (11/20 6단계 2차 추가) 종이가 벽보다 밝게 빛나 보이는 정도(기본 1.25 — 형광). 1이면 그 자리 빛 그대로(보호색 포스트잇) */
  glow?: number;
  /**
   * (11/17 추가) 착시 화살표 — 한 자리(eye)에서 볼 때만 같은 색 종이들이 이어져 화살표가 돼요(가까이·다른 자리에선 흩어진 조각).
   * 조건(when)이 맞는 첫 화살표 하나만 칠해요. 칠하고 지우는 건 그 조각을 안 보는 사이에.
   * from = 꼬리(eye에서 본 각도 [좌우, 위아래] 도, 오른쪽·위가 +), at = 가리키는 곳(세상 좌표 — 흰 종이), gap = 끝과 종이 사이(도)
   */
  figures?: { id: string; when: Cond; color: string; eye: V3; from: [number, number]; at: V3; width?: number; gap?: number }[];
  /** (11/17 추가) 이 자리 위에 형광 종이를 몇 장 더 겹쳐 붙여 반쯤 가려요(흰 종이 자리) */
  covers?: { face: Face; at: V3 }[];
}

/**
 * 조준 대상 — 화면 가운데(모바일은 누른 자리)에서 쏜 선이 이 상자에 닿으면 반응해요.
 *   click = 조준하고 누르기 / hold = 조준한 채 누르고 있기(holdMs)
 *   zoom  = 조준하고 minZoom 이상 당긴 채 잠깐 두기 / aim = 조준만 한 채 잠깐 두기(dwellMs)
 *   (11/18 추가) seen = 화면 안쪽(가장자리 10% 제외)에 가리지 않고 보이는 채로 잠깐 두기(dwellMs) — 조준하지 않아도 돼요
 *
 * (11/18 추가) tape: true = 되감은 테이프를 볼 때만 반응해요(라이브에선 없음). "테이프에서만 잡히는 것".
 *   테이프 속 카메라는 기록된 그대로라, 조준 = 그때 내가 본 화면 가운데(폰은 누른 자리)예요.
 *   예) 계단 0-4: 테이프에만 찍힌 이상현상을 seen으로 → 플래그(테이프에서 봤음) → (11/19 변경: 계단은 올라가는 쪽이 정방향) 아래로 되돌아 내려가면 통과.
 *   테이프 대상의 행동은 기억(set·add·note)·소리·글씨만 써요(방 이동·불·떼기처럼 세계를 바꾸는 건 라이브에서).
 *   needs: 'pause' = 테이프를 멈추거나 느리게 볼 때만.
 */
export interface Target {
  id: string;
  /** 한국어 설명(개발 기록용). 화면엔 안 나와요. */
  label?: string;
  at: V3;
  size: V3;
  on: 'click' | 'hold' | 'zoom' | 'aim' | 'seen';
  /**
   * (11/19 추가) 캠코더 앞에 든 소품(pick)을 조준 대상으로 — 그 소품을 들고 있는 동안은 늘 조준한 것으로 쳐요(at·size는 안 씀).
   * 포스트잇의 방: 뒤집은 종이의 빨간 점에 줌.
   */
  held?: string;
  tape?: true;
  needs?: 'pause';
  /** 닿는 거리(미터). 누르기는 팔 길이(1.5쯤), 줌으로 읽기는 멀리서도. */
  maxDist: number;
  minZoom?: number;
  /** zoom·aim: 이만큼 조준하고 있어야 반응(기본 500). */
  dwellMs?: number;
  /** hold: 이만큼 버텨야 반응(기본 1000). */
  holdMs?: number;
  when?: Cond;
  once?: true;
  /** 실행하는 동안 걷기·조작을 잠가요. */
  block?: true;
  do: Action[];
  /** hold 도중 손을 떼거나 시선이 벗어났을 때. */
  release?: Action[];
  /**
   * (11/19 6단계 2차 추가, 사용자 의견) click: 줌을 이만큼 당겨야 do가 실행돼요. 덜 당기고 누르면 unzoomed(줌 안내).
   * 잠긴 문 열쇠: 줌 없이 아무리 눌러도 아무 일이 없어 당황스러웠다 → "줌 인" 안내가 떠요.
   */
  needZoom?: number;
  /**
   * (11/20 5차 추가) zoom 대상에도: 줌이 minZoom에 모자란 채 누르면(폰은 톡) 실행. unzoomedMs를 주면 줌을 전혀 안 당긴 채
   * 그만큼 조준하고 있어도 실행. 한 번 조준하는 동안 한 번만, 줌을 당기기 시작하면 안 셈(스스로 알아낸 사람에겐 안 나와요).
   * 통로 안내판: 줌을 처음 배우는 곳인데 줌 안내가 없어 막힐 수 있었어요(사용자 의견).
   */
  unzoomed?: Action[];
  unzoomedMs?: number;
  /**
   * (11/20 추가, 사용자 의견) block으로 잠근 동안에도 둘러보기(마우스·손가락)는 돼요(걷기만 잠김). walk 행동이 시작되면 그때부터 둘러보기도 잠겨요.
   * 잠긴 문 빨간 점 열쇠: 안내음성이 나오는 동안 화면이 멈춘 것처럼 느껴지지 않게.
   */
  look?: true;
}

/** 바닥 영역 — 들어서거나 나갈 때 일이 일어나요. */
export interface Zone {
  id: string;
  at: V3;
  size: V3;
  /**
   * (11/17 추가) 이 방향으로 걸어 들어갈 때만 "들어섬"으로 쳐요(z+ = +z 쪽으로 걸어감). 너머로 가는 벽 앞 영역에 써요 —
   * 벽을 따라 옆으로 스치거나 서 있기만 해도 넘어가 버리던 버그(포스트잇의 방에서 뒤쪽 벽을 따라 옆걸음하면 통로로 넘어감)를 막아요.
   */
  into?: Face;
  when?: Cond;
  once?: true;
  enter?: Action[];
  leave?: Action[];
}

/**
 * (11/17 추가) 생겼다 사라지는 상자 묶음 — 하얀 방 뒤쪽 벽처럼 "안 보는 사이에 없어지는 벽".
 * when이 맞을 때만 있고(보이고, 부딪히고, 시선을 가림), swap: 'unseen'이면 화면에 안 보일 때만 바뀌어요.
 * 빛은 그 벽이 "없을 때"를 기준으로 구워요(열린 뒤의 모습이 자연스럽게).
 */
export interface Part {
  id: string;
  when?: Cond;
  /**
   * unseen = 안 볼 때만 바뀜. (11/17 추가) dissolve = 보는 중이어도 지지직거리며 흩어지듯 사라짐(나타날 땐 반대로)
   * (11/19 추가) swing = 문: when이 거짓이 되면 사라지지 않고 경첩(swing.hinge)을 축으로 swing.deg만큼 열려요(부딪힘은 열리기 시작할 때 빠짐).
   *   다시 참이 되면(실패해서 다시 시작) 바로 닫힌 채로. 빛은 문이 "없을 때"로 구워요(열린 뒤가 자연스럽게)
   */
  swap?: 'unseen' | 'dissolve' | 'swing';
  /** dissolve·swing 길이(ms, 기본 1400) */
  ms?: number;
  /** (11/19 6단계 2차 추가) swing 문이 다시 닫힐 때 길이(ms, 없으면 ms) — 쾅 닫히는 문 */
  closeMs?: number;
  /**
   * (11/19 6단계 2차 추가) 둥근 은색 문손잡이 — 문과 같이 움직여요(영상의 잠긴 문).
   * (11/20 변경, 사용자 의견: 그냥 공 모양 같음) ~~공 하나(반지름 r)~~ → 문에 붙는 둥근 받침 + 목 + 둥근 손잡이 + 앞면 열쇠 구멍.
   * at = 문 표면의 붙는 자리, face = 손잡이가 튀어나오는 쪽. 열쇠 구멍은 at에서 face 쪽으로 7.2cm
   */
  knob?: { at: V3; face: Face }[];
  /** (11/19 추가) 문 경첩 자리 [x, z]와 열리는 각도(도, + = 위에서 볼 때 시계 반대 방향) */
  swing?: { hinge: [number, number]; deg: number };
  /**
   * (11/20 7단계 추가) swing 문을 보일 조건(없으면 늘 보임) — 안 보는 사이에만 나타나고 사라져요.
   * congratulations! 문: 마지막 바퀴에만 있고, 하얀 공간으로 들어간 뒤 돌아보면 없어요
   */
  show?: Cond;
  boxes: Box[];
}

/** 서는 자리. 방마다 'start'는 꼭 있어야 해요. */
export interface Spawn { at: V3; yaw: number; pitch?: number }

/** 조건이 거짓 → 참으로 바뀌는 순간 한 번 실행. */
export interface Rule { when: Cond; do: Action[] }

export interface Timer {
  length: { ms: number } | { sound: SoundId };
  end: Action[];
  /** 남은 시간이 줄수록 VHS 노이즈가 세짐. */
  tension?: true;
  /**
   * (11/19 6단계 추가) 이 seen 대상(on: 'seen')이 화면에 보이는 동안은 x배 빨리 흘러요.
   * 잠긴 문: 뒤쪽 복도를 바라보는 동안 불이 빨리 다가와요("뒤를 보는 중" 판정 = 복도가 화면 안쪽에 가리지 않고 보임).
   */
  faster?: { seen: string; x: number };
  /**
   * (11/19 6단계 2차 추가) 길이를 개수에 따라: 이 타이머를 시작할 때 ms[개수](넘으면 마지막 값)로.
   * 잠긴 문: 끝없는 복도의 먼 불은 짧게 차르르, 가까운 불은 한 칸씩 길게.
   */
  steps?: { count: string; ms: number[] };
}

// ── 방 ───────────────────────────────────────────────

export interface Room {
  id: RoomId;
  /** 한국어. 저장·지도용. */
  title: string;
  /**
   * (11/20 추가) reach = 면을 만들 때 위아래 바닥·천장을 찾는 거리(기본 6m, 계단실은 높아서 늘려요).
   * (11/20 2차 추가) amb = 여러 번 튕긴 빛 어림값의 배율(기본 1) — 줄이면 등 빛이 닿지 않는 구석이 진짜로 어두워요(계단실)
   */
  space: { boxes: Box[]; lamps: Lamp[]; reach?: number; amb?: number };
  spawns: Record<string, Spawn> & { start: Spawn };
  parts?: Part[];
  props?: Prop[];
  scatter?: Scatter[];
  targets?: Target[];
  zones?: Zone[];
  rules?: Rule[];
  timers?: Record<string, Timer>;
  /** 방에 들어왔을 때(실패해서 다시 시작할 때도). */
  enter?: Action[];
  amb?: SoundId;
  /** 기본 VHS 노이즈 세기 0~1. */
  vhs?: number;
  /** 최대 줌 배율(기본 3). */
  zoomMax?: number;
  /**
   * (11/18 추가) 되감기 설정. off = 이 방에선 되감기가 안 돼요(예: 잠긴 문 추격 — 정할 때 결정).
   * 되감기는 플래그 'tape'가 켜진 뒤부터 쓸 수 있어요(~~포스트잇의 방 정전 뒤에 켜짐~~ (11/21 변경) 따뜻한 방 옛 녹화가 지나간 직후).
   */
  tape?: { off?: true; offWhen?: Cond }; // (11/19 6단계 추가) offWhen = 이 조건이 맞는 동안만 꺼요(잠긴 문 추격 중)
  /** (11/19 6단계 추가) 켜고 끄는 등(구운 빛과 따로) — 아래 LiveLight */
  live?: LiveLight;
  /** (11/19 6단계 2차 추가) 바닥에 쏟아지는 3D 열쇠 꾸러미 — 아래 KeyBunch */
  keys?: KeyBunch[];
  /**
   * (11/19 6단계 2차 추가, 사용자 의견) 이 방에서 실패할 때(테이프 씹힘): slow = 늘어지며 낮아지다 멈출 소리(경고음), sound = 지지직.
   * 나머지 효과음·안내음성은 전처럼 바로 꺼져요.
   */
  fail?: { slow?: SoundId[]; sound?: SoundId };
  /**
   * (11/19 추가) 이 조건이 맞으면 화면이 차갑고 어둡게(색이 빠진 회색빛) — 따뜻한 방을 풀고 난 뒤의 "어두운 맨벽".
   * 플래그로 정하니 저장·테이프(그 시각의 상태)에도 저절로 맞아요.
   */
  cold?: Cond;
  /** (11/19 3차 추가) 노출을 몇 배 더 밝게(자동 노출이 밝아진 만큼 다시 눌러서 — 따뜻한 방 1.3). cold일 땐 1로 돌아가요 */
  exposure?: number;
  /** (11/19 6단계 2차 추가) 이 조건이 맞는 동안은 exposure를 안 써요(따뜻한 방과 한 방 데이터인 창밖 복도) */
  exposureOff?: Cond;
  /** (11/20 7단계 추가) 이 조건이 맞으면 노출을 x배로(천천히 바뀜) — congratulations! 문이 열리면 하얀 빛이 차올라 하얗게 날아가요 */
  bright?: { when: Cond; x: number };
  /** (11/19 2차 추가) 창으로 들어오는 햇살(따뜻한 방). 아래 Sun */
  sun?: Sun;
  /** (11/18 추가) 개발용 시험 방: 저장(체크포인트)을 안 남겨요(다음에 열었을 때 이 방으로 이어지지 않게). */
  dev?: true;
  /** (11/20 6단계 계단참 추가) 난간 — 아래 Rail. 계단을 따라 기울어진 막대라 상자 대신 따로 지어요(fixtures.ts) */
  rails?: Rail[];
}

/**
 * (11/20 6단계 계단참 추가) 난간: 손잡이 막대(윗면이 from → to, 계단을 따라 기울어도 돼요) + h 아래의 아래 막대 + 그 사이 살대 + 두 끝 기둥.
 * 보이기만 해요(부딪힘은 보이지 않는 벽 Box.ghost로 따로). 빛은 구운 빛을 난간을 따라 재서 칠해요.
 */
export interface Rail {
  from: V3;
  to: V3;
  /** 손잡이 높이(아래 막대까지, 기본 0.9) */
  h?: number;
  /** 살대 간격(바닥 위 길이, 기본 0.13) */
  gap?: number;
  /** 두 끝 기둥(기본 있음) */
  posts?: false;
}

/**
 * (11/19 2차 추가) 창으로 들어오는 햇살 — 창 모양(가운데 십자 창살 그림자)이 햇빛 방향으로 방 안의 벽·바닥·문·손자국에 비치고,
 * 창에서 그 자리까지 옅은 빛줄기와 떠다니는 먼지, 창 밖은 하얗게 날아간 빛. 조건이 거짓이 되면(퍼즐을 풂) 모두 꺼지고 창 밖은 암흑.
 * 구운 빛과 따로 셰이더로 더해서, 켜고 끄기가 바로 되고 테이프에선 그 시각대로 보여요.
 */
export interface Sun {
  when?: Cond;
  /** 창(햇빛이 들어오는 구멍): 가운데, 크기 [가로, 세로], 바라보는 쪽(방 안쪽) */
  window: { at: V3; size: [number, number]; face: Face };
  /** 햇빛이 나아가는 방향(창에서 방 안으로). 길이는 상관없어요 */
  dir: V3;
  /** 햇살 색(sRGB)과 세기 */
  color: string;
  power: number;
  /** 햇살이 닿는 공간(이 상자 안의 면만 — 벽 너머로 새지 않게) */
  room: [V3, V3];
  /** 창살(가운데 십자) 반 굵기(미터) */
  bar?: number;
  /** 빛줄기 진하기(0~1, 기본 0.1) */
  beam?: number;
}

/**
 * (11/19 6단계 추가) 켜고 끄는 등 — 구운 빛과 따로 셰이더로 더해서 켜고 끄기가 바로 돼요(잠긴 문 추격: 복도 끝부터 하나씩 켜짐).
 * 방의 모든 면(벽·바닥·문·소품)이 이 등의 빛을 받고, shadow인 등은 내 몸 그림자를 바닥·벽에 드리워요(등 뒤 빛 → 앞으로 뻗는 그림자).
 * 켜질 때는 형광등처럼 깜빡이며, 꺼질 때는 탁. 테이프에선 그 시각에 켜져 있었는지대로.
 */
export interface LiveLamp {
  id: string;
  /** 천장 등 가운데(높이 = 천장) */
  at: V3;
  /** 보이는 등 판 크기 [가로(x), 세로(z)] */
  size: [number, number];
  /** (11/20 7단계 추가) 보이는 등 판 없이 빛만(문틈에서 쏟아지는 빛) */
  hidden?: true;
  /** (11/20 7단계 추가) 형광등처럼 깜빡이지 않고 이만큼(초) 서서히 켜지고 꺼져요 */
  fade?: number;
  power: number;
  color: string;
  /** 켜지는 조건 */
  when?: Cond;
  /** 이 등이 내 몸 그림자를 드리움 */
  shadow?: true;
}
export interface LiveLight {
  lamps: LiveLamp[];
  /** 빛이 닿는 공간(이 상자 안의 면만 — 벽 너머로 새지 않게) */
  box: [V3, V3];
  /** 이 조건이 맞으면 방 전체의 구운 빛을 level배로(정전 — 다가오는 불만 남게) */
  dim?: { when: Cond; level: number };
  /** (11/19 6단계 2차 추가) 보기에만 있는 끝없는 복도 — 아래 FarHall */
  far?: FarHall;
}

/**
 * (11/19 6단계 2차 추가, 사용자 의견) 보기에만 있는 끝없는 복도: 걸어 들어갈 수는 없고(그 자리에 보이지 않는 벽 — Box.ghost), 굽지 않아
 * 가벼워요. 빛은 그 복도의 등에서만 와서, 켜지지 않은 먼 곳은 캄캄해 끝이 안 보여요.
 * 등은 일정한 간격으로 n개, 먼 쪽부터 켜져요: k번째 등(0 = 가까운 쪽)은 lamps.count ≥ lamps.first + (n − 1 − k)일 때.
 */
export interface FarHall {
  /** 가까운 끝(바닥 가운데)과 뻗어 가는 쪽 */
  from: V3;
  dir: 'x-' | 'x+' | 'z-' | 'z+';
  length: number;
  width: number;
  height: number;
  mats: { floor: Box['mat']; wall: Box['mat']; ceil: Box['mat'] };
  lamps: { spacing: number; n: number; power: number; color: string; size: [number, number]; count: string; first: number };
  /** 보이는 조건 */
  when: Cond;
}

/**
 * (11/19 6단계 2차 추가, 사용자 의견: 열쇠가 너무 2D) 3D 열쇠 꾸러미 — 은색 열쇠(두께·모서리가 있는 금속, 등 빛에 반짝임) + 고리 + 빨간 점 열쇠 하나.
 * 손잡이에 걸려 있다가(열쇠 하나는 손잡이에 꽂힘) fall 조건이 맞으면 바닥으로 와르르 떨어지고, spread 개수(0 엉킴 → 1 → 2 다 헤침)에 따라
 * 위의 열쇠들이 옆으로 밀려나 빨간 점 열쇠가 드러나요. 빨간 점은 redOn이 맞을 때만 빨갛고(아니면 어두운 회색 — 어둠 속 실루엣).
 */
export interface KeyBunch {
  id: string;
  /** 손잡이(걸려 있을 때) — 문 앞면 위 손잡이 자리와 문이 바라보는 쪽(나를 향한 쪽) */
  knob: V3;
  face: Face;
  /** 바닥 무더기 가운데 */
  floor: V3;
  /** 빨간 점 열쇠 말고 열쇠 수 */
  keys: number;
  seed: number;
  fall: Cond;
  spread: string;
  redOn: Cond;
  /** 이 조건이 맞으면 빨간 점 열쇠가 바닥에서 손잡이로 날아가 꽂혀요(손 없이) */
  use?: Cond;
}

// ── 저장 ─────────────────────────────────────────────

/** 방에 들어설 때 찍는 체크포인트. 실패하면 이 상태로 돌아가요(stats만 그대로). */
export interface Save {
  v: 2;
  room: RoomId;
  spawn: string;
  flags: Flag[];
  counts: Record<string, number>;
  items: ItemId[];
  notes: NoteId[];
  /** 한 번만 반응하는 것들 중 이미 쓴 것("방.대상"). */
  done: string[];
  tapeSec: number;
  stats: Record<StatKey, number> & { playMs: number };
  /** (11/19 6단계 추가) checkpoint 행동으로 찍은 자리의 이름(실패 횟수 fails.<tag>). 없으면 방 이름 */
  tag?: string;
}
