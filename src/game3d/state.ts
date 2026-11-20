/**
 * (11/18 추가) 게임 진행 상태 한 벌 — 저장(체크포인트), 실패 후 다시 시작, 되감기 테이프가 같은 모양을 써요.
 *
 * 진행 상태는 이 네 가지로만 적어요(따뜻한 방·잠긴 문·계단 퍼즐도 전부):
 *   flags  켜짐/꺼짐            예) gone, tape, warm.played, warm.solved
 *   counts 숫자                 예) whites(찾은 흰 종이), fails.<방>(그 방에서 실패한 횟수, 논리가 알아서 셈)
 *   items  가방(조건 검사용)     예) postit-andyou
 *   notes  읽은 단서
 * 바뀌는 길은 논리(logic.ts)의 한 곳뿐이고, 바뀔 때마다 사건이 기록 장치로 가요.
 * 그래서 새 퍼즐은 방 데이터에 플래그·개수를 적기만 하면 저장·실패·되감기에 저절로 들어가요(코드 수정 없음).
 *
 * 되감기는 이 상태를 "되돌리지" 않아요. 테이프 구간 시작 때의 한 벌 + 그 뒤의 사건으로
 * "그 시각의 모습"(Ghost)을 따로 만들어 화면에만 써요(docs/TECH_DESIGN.md 12장).
 */
import type { Cond } from './schema.ts';

/** 조건 검사에 필요한 것. */
export interface CondState {
  flags: Set<string>;
  counts: Record<string, number>;
  items: Set<string>;
}

/** 조건 검사 — 논리와 테이프가 같이 써요(규칙이 한 곳에만 있게). */
export function testCond(s: CondState, c: Cond): boolean {
  if ('flag' in c) return s.flags.has(c.flag);
  if ('has' in c) return s.items.has(c.has);
  if ('count' in c) return (s.counts[c.count] ?? 0) >= c.gte;
  if ('not' in c) return !testCond(s, c.not);
  if ('all' in c) return c.all.every((x) => testCond(s, x));
  return c.any.some((x) => testCond(s, x));
}

/** 진행 상태 한 벌(저장·테이프 구간 시작에 찍는 모양). */
export interface Snapshot {
  flags: string[];
  counts: Record<string, number>;
  items: string[];
  notes: string[];
  /** 한 번만 반응하는 것들 중 이미 쓴 것("방.t.대상"). */
  done: string[];
}

/**
 * 상태가 바뀐 순간(기록 장치가 받아 적어요).
 *   flag·item: v 1 켜짐 / 0 꺼짐, count: v 새 값, note: v 1
 *   act: 화면에 보이는 세계 연출 — id = light(arg: flicker·off·on) / pick·flip(arg: 소품) / clip·clip-end(arg: 영상 파일)
 *   room: 방에 들어섬(새 테이프 구간), fire: 조준 대상이 반응함
 */
export interface StateEvent {
  /** 게임 시간(ms). 기록 장치는 자기 "녹화 시간"으로 다시 찍어요. */
  t: number;
  kind: 'room' | 'flag' | 'count' | 'item' | 'note' | 'fire' | 'act';
  id: string;
  v?: number;
  arg?: string;
}

/** 그 시각의 상태(테이프 화면용). 진짜 게임 상태와는 따로예요. */
export class Ghost implements CondState {
  flags: Set<string>;
  counts: Record<string, number>;
  items: Set<string>;
  notes: Set<string>;

  constructor(s: Snapshot) {
    this.flags = new Set(s.flags);
    this.counts = { ...s.counts };
    this.items = new Set(s.items);
    this.notes = new Set(s.notes);
  }

  apply(e: { kind: StateEvent['kind']; id: string; v?: number }) {
    switch (e.kind) {
      case 'flag': if (e.v) this.flags.add(e.id); else this.flags.delete(e.id); break;
      case 'item': if (e.v) this.items.add(e.id); else this.items.delete(e.id); break;
      case 'count': this.counts[e.id] = e.v ?? 0; break;
      case 'note': this.notes.add(e.id); break;
      default: break; // room·fire·act는 상태가 아니에요(act는 테이프 재생기가 따로 읽어요)
    }
  }

  test = (c: Cond): boolean => testCond(this, c);
}
