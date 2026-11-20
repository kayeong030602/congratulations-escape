/**
 * 상태 머신 v1 (2026-11-15) — "지금 무엇을 할 수 있는 상태인가"를 정하는 표.
 * 표에 없는 조합은 무시돼요(상태 그대로). 쉬운 설명은 docs/TECH_DESIGN.md 2장.
 *
 * 세 겹으로 나뉘어요.
 *   1) App       : 게임 전체 흐름 (타이틀 / 플레이 / 일시정지 / 엔딩)
 *   2) Mode      : 플레이 중 캠코더 상태 (live / busy / holding / tape / failing)
 *   3) Transport : 테이프 모드 안의 재생 버튼 상태 (◀◀ ▶ 느리게 ⏸ ▶▶)
 */

type Table<S extends string, E extends string> = Record<S, Partial<Record<E, S>>>;

/** 표를 보고 다음 상태를 돌려줘요. 표에 없으면 지금 상태 그대로. */
export function next<S extends string, E extends string>(table: Table<S, E>, state: S, event: E): S {
  return table[state][event] ?? state;
}

// ── 1) App ───────────────────────────────────────────

export type App = 'boot' | 'title' | 'play' | 'menu' | 'ending';
export type AppEvent = 'READY' | 'INSERT' | 'PAUSE' | 'RESUME' | 'QUIT' | 'FINISH' | 'RESTART';

export const APP: Table<App, AppEvent> = {
  boot: { READY: 'title' }, // 인트로 소재 로딩 끝
  title: { INSERT: 'play' }, // PLAY ▶ 클릭(테이프 넣기). 이 클릭으로 소리가 켜져요
  play: { PAUSE: 'menu', FINISH: 'ending' },
  menu: { RESUME: 'play', QUIT: 'title' }, // 파란 VCR 화면. 타이머·소리·영상 모두 멈춤
  ending: { RESTART: 'title' },
};

// ── 2) Mode (플레이 중) ──────────────────────────────

export type Mode =
  | 'live' // REC ● 시점에 서 있음. 둘러보기·줌·클릭·누르고 있기·되감기 가능
  | 'busy' // 이동 클립이나 컷신이 나오는 중. 입력 잠금
  | 'holding' // 누르고 있는 중(게이지가 참)
  | 'tape' // 되감기 모드. 테이프를 보는 중
  | 'failing'; // 테이프 씹힘 연출 → 방 처음으로

export type ModeEvent =
  | 'RUN' // 기다려야 하는 액션(이동·컷신) 시작
  | 'DONE' // 액션 끝
  | 'HOLD_START'
  | 'HOLD_CANCEL' // 다 차기 전에 손을 뗌
  | 'HOLD_DONE' // 끝까지 버팀
  | 'REWIND' // ◀◀ 누름(테이프에 녹화된 구간이 있을 때만)
  | 'TAPE_STOP' // ■ 누르거나 테이프 끝(=지금)에 닿음
  | 'FAIL' // 타이머 끝 등
  | 'RESTARTED'; // 방 처음 상태로 되돌리기 끝

export const MODE: Table<Mode, ModeEvent> = {
  live: { RUN: 'busy', HOLD_START: 'holding', REWIND: 'tape', FAIL: 'failing' },
  busy: { DONE: 'live', FAIL: 'failing' },
  holding: { HOLD_CANCEL: 'live', HOLD_DONE: 'busy', FAIL: 'failing' },
  tape: { TAPE_STOP: 'live', FAIL: 'failing' },
  failing: { RESTARTED: 'live' },
};

// ── 3) Transport (테이프 모드 안) ─────────────────────

export type Transport = 'rew' | 'play' | 'slow' | 'pause' | 'ff';

export type TransportEvent =
  | 'REW'
  | 'PLAY'
  | 'SLOW'
  | 'PAUSE'
  | 'FF'
  | 'STEP' // 멈춘 채 한 프레임 앞으로
  | 'HIT_START'; // 되감다가 테이프(이 방) 맨 앞에 닿음
// 테이프 끝(=지금)에 닿는 건 Transport가 아니라 Mode의 TAPE_STOP으로 처리해요.

/** 테이프 모드는 늘 'rew'(되감는 중)로 시작해요. */
export const TRANSPORT_START: Transport = 'rew';

export const TRANSPORT: Table<Transport, TransportEvent> = {
  rew: { PLAY: 'play', PAUSE: 'pause', FF: 'ff', HIT_START: 'pause' },
  play: { REW: 'rew', PAUSE: 'pause', SLOW: 'slow', FF: 'ff' },
  slow: { REW: 'rew', PAUSE: 'pause', PLAY: 'play', FF: 'ff' },
  pause: { REW: 'rew', PLAY: 'play', SLOW: 'slow', FF: 'ff', STEP: 'pause' },
  ff: { REW: 'rew', PAUSE: 'pause', PLAY: 'play' },
};
