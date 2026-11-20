/**
 * 게임 데이터 스키마 v1 (2026-11-15)
 *
 * - 장면은 전부 "순수 데이터"예요(함수 없음). 엔진이 이 데이터를 읽어서 움직여요.
 * - 좌표는 4:3 화면 기준 0~1 (x: 왼쪽 0 → 오른쪽 1, y: 위 0 → 아래 1).
 * - 파일 경로는 public/media/ 기준 상대 경로.
 * - 쉬운 설명은 docs/TECH_DESIGN.md 1장.
 */

export type RoomId = string;
export type ViewId = string;
export type ItemId = string;
export type NoteId = string;
export type SoundId = string;
export type Flag = string;

// ── 좌표 ─────────────────────────────────────────────

export type Point = [x: number, y: number];

/** 클릭 영역. 네모(rect)가 기본, 비스듬한 물건은 다각형(poly). */
export type Shape =
  | { rect: [x: number, y: number, w: number, h: number] }
  | { poly: Point[] };

// ── 조건 ─────────────────────────────────────────────

/** "이럴 때만"을 적는 방법. 서로 겹쳐 쓸 수 있어요. */
export type Cond =
  | { flag: Flag } // 플래그가 켜져 있음
  | { has: ItemId } // 가방에 물건이 있음
  | { count: string; gte: number } // 카운터가 n 이상
  | { not: Cond }
  | { all: Cond[] }
  | { any: Cond[] };

// ── 화면에 나오는 것 ──────────────────────────────────

/** 시점의 배경. still = 정지 이미지(webp, 줌용 고해상도), loop = 이음매 없는 반복 클립(mp4). */
export type Media = { still: string } | { loop: string };

/** 한 번 재생하는 클립(휩팬·걷기·컷신). reverse = 같은 클립의 거꾸로 버전(.rev.mp4)을 재생. */
export type ClipRef = string | { clip: string; reverse?: true };

// ── 행동(액션) ────────────────────────────────────────

/**
 * 클릭·누르고 있기·타이머 끝 등에서 "일어나는 일". 위에서부터 차례로 실행돼요.
 * clip / wait / (wait: true인) voice는 끝날 때까지 다음 줄이 기다려요.
 */
export type Action =
  // 이동
  | { do: 'go'; view: ViewId; via?: ClipRef } // 같은 방의 다른 시점으로
  | { do: 'room'; room: RoomId; via?: ClipRef } // 다음 방으로(체크포인트 저장)
  | { do: 'clip'; clip: ClipRef } // 컷신 클립 한 번 재생
  | { do: 'wait'; ms: number }
  // 기억
  | { do: 'set'; flag: Flag; off?: true }
  | { do: 'add'; count: string; by?: number }
  | { do: 'stat'; key: StatKey; by?: number } // 끝 화면 통계(실패해도 안 지워짐)
  | { do: 'give'; item: ItemId }
  | { do: 'take'; item: ItemId }
  | { do: 'note'; note: NoteId } // 메모에 단서 추가
  // 소리
  | { do: 'sound'; sound: SoundId }
  | { do: 'stop'; sound: SoundId; fadeMs?: number }
  | { do: 'voice'; sound: SoundId; wait?: true } // 안내음성
  // 긴장
  | { do: 'timer'; timer: string; stop?: true } // 방 타이머 시작/멈춤
  | { do: 'vhs'; level: number; ms?: number } // VHS 노이즈 세기 0~1 (ms 동안 서서히)
  | { do: 'osd'; text: string; ms?: number } // 캠코더 화면 글씨 잠깐 띄우기
  | { do: 'fail' } // 테이프 씹힘 → 이 방 처음부터
  // 갈림
  | { do: 'if'; when: Cond; then: Action[]; else?: Action[] };

// ── 시점(View) ───────────────────────────────────────

export interface Hotspot {
  id: string;
  /** 한국어 설명(디버그·화면 읽기 프로그램용). 화면엔 안 나와요. */
  label?: string;
  shape: Shape;
  /**
   * click = 누르기(기본) / hold = 누르고 있기(holdMs 동안 버팀)
   * zoom = 이 영역을 향해 minZoom 이상 당기면 저절로 실행(안내판 읽기 등)
   */
  on?: 'click' | 'hold' | 'zoom';
  holdMs?: number;
  /** 줌을 이만큼 당겨야 반응해요(작은 글씨). */
  minZoom?: number;
  when?: Cond;
  /** 한 번만 반응. */
  once?: true;
  cursor?: 'focus' | 'hand' | 'walk';
  do: Action[];
  /** hold 도중 손을 뗐을 때. */
  release?: Action[];
}

/** 조건에 따라 배경이 달라질 때(포스트잇 가득 → 맨벽 → and you? 한 장). */
export interface Backdrop {
  when?: Cond;
  media: Media;
}

export type LookDir = 'left' | 'right' | 'up' | 'down' | 'back';

/** 드래그·방향키로 둘러보기. back = 빠르게 휙(뒤돌아보기). */
export interface Look {
  /** 옮겨 갈 시점. 없으면 do만 실행(예: 뒤돌아보면 다음 방으로). */
  to?: ViewId;
  via?: ClipRef;
  when?: Cond;
  do?: Action[];
}

export interface View {
  label?: string;
  /** 위에서부터 조건이 맞는 첫 번째를 보여 줘요. 마지막 줄은 조건 없이(기본). */
  backdrop: Backdrop[];
  /** 방향마다 하나, 또는 조건별 여러 개(위에서부터 첫 번째로 맞는 것). */
  look?: Partial<Record<LookDir, Look | Look[]>>;
  hotspots?: Hotspot[];
  /** 최대 줌 배율. 없으면 1(줌 안 됨). */
  zoomMax?: number;
  /** 이 시점에 올 때마다 실행. */
  enter?: Action[];
}

// ── 타이머 ───────────────────────────────────────────

export interface Timer {
  /** ms = 정해진 시간 / sound = 그 소리가 끝날 때까지. (3단계에서 '불 칸 수' 방식 추가 예정) */
  length: { ms: number } | { sound: SoundId };
  /** 시간이 다 됐을 때. */
  end: Action[];
  /** 남은 시간이 줄수록 VHS 노이즈가 세짐. */
  tension?: true;
}

// ── 테이프(되감기) ───────────────────────────────────

/** 테이프 화면에서만 잡히는 것(예: 옛 녹화의 날짜). */
export interface TapeMark {
  id: string;
  /** 구간 시작부터 몇 초~몇 초 사이. */
  from: number;
  to: number;
  shape: Shape;
  /** pause = 멈췄을 때만 / slow = 느린 재생이나 멈춤일 때만 잡혀요. */
  needs?: 'pause' | 'slow';
  once?: true;
  do: Action[];
}

/** 테이프에 '녹화된' 한 구간. 영상 순서대로 적어요. */
export interface TapeSegment {
  id: string;
  /** 앞으로 재생하는 파일. 되감기용 거꾸로 파일은 같은 이름 + ".rev.mp4"(자동 생성). */
  clip: string;
  /** 이 조건이 참이 된 뒤부터 테이프에 붙어요. 없으면 방에 들어오자마자. */
  when?: Cond;
  /** ▶ 재생 때만 나오는 테이프 소리. */
  sound?: SoundId;
  marks?: TapeMark[];
}

export interface Tape {
  segments: TapeSegment[];
}

// ── 방(Room) ─────────────────────────────────────────

/** 조건이 거짓 → 참으로 바뀌는 순간 한 번 실행(예: 흰 종이 5장을 다 찾았을 때). */
export interface Rule {
  when: Cond;
  do: Action[];
}

export interface Room {
  id: RoomId;
  /** 한국어. 저장·지도용. */
  title: string;
  /** 방에 들어왔을 때(실패해서 다시 시작할 때도). */
  start: { view: ViewId; do?: Action[] };
  views: Record<ViewId, View>;
  rules?: Rule[];
  timers?: Record<string, Timer>;
  /** 없으면 이 방에선 되감기 불가. */
  tape?: Tape;
  /** 방 바탕음(험 등). */
  amb?: SoundId;
  /** 기본 VHS 노이즈 세기 0~1. */
  vhs?: number;
}

// ── 게임 전체 ────────────────────────────────────────

export interface Item {
  name: string;
  icon: string;
  text?: string;
}

export interface Note {
  text: string;
}

export interface Sound {
  src: string;
  /** amb 바탕음 / sfx 효과음 / voice 안내음성 / music 음악. 종류별로 볼륨을 따로 다뤄요. */
  bus: 'amb' | 'sfx' | 'voice' | 'music';
  loop?: true;
  gain?: number;
}

export interface Game {
  version: 1;
  start: RoomId;
  /** 방 순서(지도·테이프 카운터용). 방 데이터는 방마다 따로 불러와요(지연 로딩). */
  rooms: RoomId[];
  items: Record<ItemId, Item>;
  notes: Record<NoteId, Note>;
  sounds: Record<SoundId, Sound>;
}

// ── 저장(localStorage) ───────────────────────────────

export type StatKey = 'obeyed' | 'keysTried' | 'fails' | 'rewinds'; // (11/20 7단계 추가) rewinds = 테이프를 돌려 본 횟수(끝 화면)

/** 방에 들어설 때 찍는 체크포인트. 실패하면 이 상태로 돌아가요(stats만 그대로). */
export interface Save {
  v: 1;
  room: RoomId;
  flags: Flag[];
  counts: Record<string, number>;
  items: ItemId[];
  notes: NoteId[];
  /** 지금까지 녹화된 테이프 길이(초). 테이프 카운터 표시용. */
  tapeSec: number;
  stats: Record<StatKey, number> & { playMs: number };
}
