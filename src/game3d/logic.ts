/**
 * 논리 — 방 데이터를 읽어 게임을 굴려요. 3D는 전혀 몰라요(three.js를 불러오지 않아요).
 *
 * 맡은 일: 상태(플래그·개수·가방·메모), 조건 검사, 행동 실행, 규칙, 타이머,
 *          조준 대상(누르기·누르고 있기·줌·바라보기·보임), 바닥 영역, 실패 → 방 처음부터, 저장, 테이프 보기 모드.
 * 맡지 않는 일: 방 짓기·그리기·걷기·조준 선 쏘기(world.ts), 소리 내기(audio), 입력 받기(main.ts),
 *               테이프 재생 위치·버튼(tape.ts).
 *
 * 세계와 주고받는 길은 두 가지뿐이에요.
 *   세계 → 논리 : update(dt, sense)  — "지금 무엇을 조준하고, 어느 영역에 서 있고, 누르고 있는지"
 *   논리 → 세계 : WorldPort          — "이 방을 지어 세워라 / 이 자리로 옮겨라"
 * 소품이 보이고 숨는 것은 세계가 test()를 불러 스스로 맞춰요.
 *
 * (11/18 추가) 되감기: 테이프를 보는 동안(mode 'tape') 진짜 상태는 하나도 되돌리지 않아요. 시간(타이머)은 계속 흐르고,
 *   조준·영역은 쉬어요(테이프 전용 대상만 반응). 테이프에서 새로 알게 된 것(테이프 대상의 행동)은 앞으로만 더해져요.
 */
import type { Game as GameData } from '../data/schema.ts';
import {
  APP, MODE, next,
  type App, type Mode, type ModeEvent, type Transport,
} from '../engine/machine.ts';
import type { Action, Cond, Fx, Room, RoomId, Save, Spawn, Target } from './schema.ts';
import { testCond, type Snapshot, type StateEvent } from './state.ts';
import { CLIP_INDEX } from './tape.ts';

export type { StateEvent } from './state.ts';

const ABORT = Symbol('abort'); // 실패·방 이동으로 하던 행동을 그만둘 때
const SAVE_KEY = 'congrats-escape/save/v2';
export const FAIL_MS = 1400; // 테이프 씹힘 연출 길이(화면의 씹힘 효과도 이 길이에 맞춰요)
/** (11/18 추가) 이 플래그가 켜진 뒤부터 되감기를 쓸 수 있어요(포스트잇의 방 정전 뒤). */
export const TAPE_FLAG = 'tape';

/** 세계가 매 프레임 알려 주는 것. */
export interface Sense {
  /** 조준한 대상(없으면 null). */
  aim: string | null;
  zoom: number;
  /** 지금 서 있는 바닥 영역들. */
  zones: string[];
  /** 누르고 있는 중. */
  press: boolean;
  /** 이번 프레임에 막 눌렀음. */
  click: boolean;
  /** (11/18 추가) 화면 안쪽에 가리지 않고 보이는 seen 대상들. */
  seen?: string[];
}

/** 논리가 세계에 시키는 것. */
export interface WorldPort {
  /** 방을 짓고(이미 지었으면 꺼내고) 그 자리에 세워요. */
  enter(room: Room, spawn: Spawn, via: Fx): Promise<void>;
  /** 같은 방 안의 다른 자리로 옮겨요. */
  warp(spawn: Spawn, via: Fx): Promise<void>;
  /** (11/17 추가) 전체 화면 영상을 한 번 틀고 끝날 때까지 기다려요. (11/18 추가) onStart = 실제로 화면에 나오기 시작한 순간(테이프 기록용) */
  clip(file: string, onStart?: () => void): Promise<void>;
  /** (11/17 추가) 다음에 갈 방을 미리 지어 둬요(폰에서 방을 옮기는 순간 멈추지 않게). */
  prebuild?(room: Room): void;
  /** (11/17 추가) 벽의 소품(종이)이 캠코더 앞으로 와요 / 그 종이를 뒤집어요. */
  pick?(prop: string): Promise<void>;
  flip?(prop: string): Promise<void>;
  /** (11/17 추가) 방의 불: 깜빡임(끝날 때까지) / 꺼짐 / 켜짐. */
  light?(fx: 'flicker' | 'off' | 'on'): Promise<void>;
  /** (11/19 추가) 화면 노이즈 한 번(level = 트래킹 노이즈, ms = 찢어지는 지지직 길이). */
  noise?(level: number, ms?: number): void;
  /** (11/19 6단계 추가) 카메라가 그 자리로 저절로 걸어가며 돌아서요(끝날 때까지). */
  walk?(spawn: Spawn, ms: number): Promise<void>;
  /** (11/20 7단계 추가) 바닥 없는 곳으로 떨어져요(끝날 때까지). */
  fall?(ms: number, depth: number): Promise<void>;
  /** (11/20 추가, 폰 점검) 이 방에서 틀 전체 화면 영상을 미리 받아 둬요(옛 녹화 — 누르는 순간 받기 시작하면 느린 와이파이에서 늦게 나와요). */
  prepareClip?(file: string): void;
}

/** 논리가 소리에 시키는 것(AudioEngine이 이 모양이에요). */
export interface AudioPort {
  load(ids: Iterable<string>): Promise<void>;
  play(id: string, fadeInMs?: number, at?: [number, number, number]): { duration: number }; // (11/19 6단계) at = 그 자리에서 나는 소리(입체 음향)
  stop(id: string, fadeMs?: number, slow?: boolean): void;
  stopBus(bus: 'amb' | 'sfx' | 'voice' | 'music', fadeMs?: number): void;
  setAmb(id: string | undefined): void;
  /** (11/19 추가) 묶음 소리를 먹먹하게·작게(hush 행동). */
  muffle?(bus: 'amb' | 'sfx' | 'voice' | 'music', k: number, level?: number, ms?: number): void;
  suspend(): void;
  resume(): void;
}

export interface Hooks {
  /** 상태가 바뀜(표시 갱신용). */
  change?(): void;
  /** 개발용 기록. */
  log?(msg: string): void;
  /** 캠코더 화면 글씨 잠깐 띄우기. */
  osd?(text: string, ms: number): void;
  /** 가방·메모에 무언가 들어옴(한국어 알림). */
  toast?(text: string): void;
  /** (11/17 추가) 조작 안내(한국어). touch = 폰에서 대신 보일 글씨. 어느 쪽을 보일지는 main.ts가 정해요. */
  hint?(text: string, touch?: string): void;
  /** 세계 상태가 바뀜(되감기 기록 장치가 받아 적어요). */
  event?(e: StateEvent): void;
  /** (11/18 추가) 논리가 스스로 테이프 보기를 끝냄(실패·방 이동) — 세계·소리·화면을 라이브로 돌려놔요. */
  tapeEnd?(): void;
  /** (11/20 7단계 추가) 끝 화면으로(게임 끝). */
  end?(): void;
}

const swallow = (e: unknown) => { if (e !== ABORT) console.error(e); };

/** 방 데이터를 훑어서 그 방이 쓰는 소리 이름을 모아요. */
function soundsOf(room: Room): string[] {
  const out = new Set<string>();
  (function walk(v: unknown) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if ((k === 'sound' || k === 'amb') && typeof x === 'string') out.add(x);
      else walk(x);
    }
  })(room);
  return [...out];
}

/** (11/20 추가) 방 데이터를 훑어서 그 방이 트는 전체 화면 영상 파일을 모아요(clip 행동). */
function clipsOf(room: Room): string[] {
  const out = new Set<string>();
  (function walk(v: unknown) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.do === 'clip' && typeof o.clip === 'string') out.add(o.clip);
    for (const x of Object.values(o)) walk(x);
  })(room);
  return [...out];
}

export class Logic {
  app: App = 'boot';
  mode: Mode = 'busy';
  paused = false;

  room!: Room;
  spawnId = 'start';

  flags = new Set<string>();
  counts: Record<string, number> = {};
  items = new Set<string>();
  notes = new Set<string>();
  stats = { obeyed: 0, keysTried: 0, fails: 0, rewinds: 0, playMs: 0 }; // (11/20 7단계) rewinds = 테이프를 돌려 본 횟수(끝 화면)
  /**
   * (11/20 7단계 추가) 엔딩 타자 글씨(main.ts가 캠코더 화면 가운데에 그려요). null이면 평소 캠코더 글씨.
   * cur = 지금 치는 줄(앞에서 몇 글자까지 보이는지 n), size = 줄마다 글씨 크기
   */
  typed: { lines: string[]; sizes: number[]; n: number } | null = null;
  /** 테이프 카운터(초). (11/18 변경) 테이프를 보는 동안엔 안 늘어요(카운터 = 녹화한 길이). */
  tapeSec = 0;
  /** (11/17 추가) 화면 위쪽 한국어 안내 문구(main.ts가 그려요). count·of = 채워지는 네모 칸 */
  goal: { lines: string[]; count?: string; of?: number; strong?: boolean } | null = null;
  /** (11/18 추가) 테이프 버튼 상태(테이프를 볼 때만, main.ts가 매 프레임 알려 줘요). needs: 'pause' 대상에 써요 */
  transport: Transport | null = null;
  /**
   * (11/20 추가) 테이프를 볼 때 "재생 위치 그 시각의 상태"로 조건 검사(main.ts가 매 프레임 알려 줘요, 테이프가 아니면 null).
   * 테이프 대상(tape: true)의 when을 지금 상태와 그 시각 상태 둘 다로 걸러요 — 계단: 0-3 녹화를 보고 0-4를 통과하는 구멍 막기.
   */
  tapeTest: ((c: Cond) => boolean) | null = null;
  /**
   * (11/20 2차 추가) 테이프 재생 빠르기(배, 거꾸로면 -, 멈춤 0 — main.ts가 매 프레임). 테이프에서 seen 대상은 "지나간 테이프 시간"으로 세요:
   * ◀◀·▶▶(3~10배)로 빨리 감으면 흔적이 화면을 0.4초 안에 지나가 버려서 본 걸로 안 쳤어요(사용자: 되감아 봤는데 안 넘어감)
   */
  tapeSpeed = 0;

  /** 게임 시간(ms). 일시정지 중엔 안 흘러요. */
  clock = 0;

  private done = new Set<string>(); // 한 번만 반응하는 것들 중 이미 쓴 것
  private gen = 0; // 실패·방 이동 때마다 올라가요. 예전 행동 줄은 이 값이 달라진 걸 보고 그만둬요
  private locks = 0; // 걷기·조작을 잠근 행동 줄의 수
  private scripts = 0; // (11/18 추가) 아직 끝나지 않은 행동 줄의 수(정전처럼 기다리는 연출). 0이 아니면 되감기가 안 돼요
  // (11/19 6단계 변경) 끝나는 시각 대신 남은 시간(ms)을 줄여 가요 — 뒤를 보는 동안 빨리 흐르는 타이머(faster)
  private timers = new Map<string, { left: number; len: number }>();
  /** (11/19 6단계 추가) 이번 프레임에 빨리 흐른 타이머가 있음(개발용 표시 "뒤 보기") */
  fast = false;
  private waiters: { at: number; gen: number; res: () => void }[] = [];
  private ruleOn: boolean[] = [];
  private checkpoint: Save | null = null;
  private hold: { t: Target; start: number } | null = null;
  private dwell: { id: string; ms: number } | null = null;
  /** (11/20 5차 추가) 줌 대상을 줌 없이 조준하고 있는 시간(ms, -1 = 이번 조준에선 더 안 셈 — 이미 안내했거나 줌을 당기기 시작함) */
  private zoomIdle: { id: string; ms: number } | null = null;
  private seenMs = new Map<string, number>(); // (11/18 추가) seen 대상마다 보인 시간(ms, -1 = 방금 반응함)
  private zonesIn = new Set<string>();
  private primed = false; // 방에 막 들어섰을 때 서 있던 영역은 "들어섬"으로 치지 않아요
  private vhsBase = 0.25;
  private failAt = Infinity;
  private wantPlay = false; // PLAY ▶를 눌렀음(방을 다 짓기 전에 눌러도 놓치지 않게)

  constructor(
    private data: GameData,
    private rooms: Record<RoomId, () => Promise<Room>>,
    private world: WorldPort,
    private audio: AudioPort,
    private hooks: Hooks = {},
  ) {}

  /** 걷기와 조작이 되는 상태인가. */
  get free(): boolean { return !this.paused && (this.mode === 'live' || this.mode === 'holding'); }

  /** (11/20 추가) 둘러보기(마우스·손가락)가 되는가 — 걷기가 되면 당연히, 연출 중이어도 look 대상의 연출이면(walk 전까지). */
  get canLook(): boolean { return this.free || (!this.paused && this.mode === 'busy' && this.lookOK); }
  private lookOK = false;

  private send(ev: ModeEvent) {
    const m = next(MODE, this.mode, ev);
    if (m === this.mode) return;
    this.mode = m;
    this.hooks.change?.();
  }

  private lock() {
    if (this.locks++ === 0) this.send('RUN');
  }

  private unlock() {
    if (this.locks > 0 && --this.locks === 0) this.send('DONE');
  }

  private emit(kind: StateEvent['kind'], id: string, v?: number, arg?: string) {
    this.hooks.event?.({ t: this.clock, kind, id, v, arg });
  }

  // ── 시작·저장 ──────────────────────────────────────

  /** roomId를 주면 그 방에서 새로, 안 주면 저장된 곳(없으면 처음)에서. */
  async start(roomId?: RoomId, dev?: { spawn?: string; flags?: string[]; counts?: Record<string, number> }) {
    const saved = roomId ? null : Logic.loadSave();
    // (11/21 8단계 ③ 고침) 이어 하기: 저장된 체크포인트를 그대로(이름 tag 포함) 써요. 전엔 이름 없이 새로 찍어서
    //   잠긴 문 앞에서 이어 한 뒤 실패하면 횟수가 fails.warm에 세어져 → 손잡이부터 다시·보험 문구 안 나옴(사용자 발견)
    if (saved) { this.restore(saved, true); this.checkpoint = saved; }
    // (11/20 추가) 개발용 바로가기: 그 방의 다른 자리에서, 플래그를 켠 채로(예: 따뜻한 방을 푼 뒤 잠긴 문 앞)
    for (const f of dev?.flags ?? []) this.flags.add(f);
    Object.assign(this.counts, dev?.counts ?? {}); // (11/20 7단계) 개수도(계단 마지막 바퀴 stair.floor:5)
    await this.enterRoom(roomId ?? saved?.room ?? this.data.start, dev?.spawn ?? saved?.spawn ?? 'start', !!saved, 'cut');
  }

  /** PLAY ▶(테이프 넣기): 타이틀 → 플레이. 방을 아직 짓는 중이면 다 지은 뒤에 넘어가요. */
  insert() {
    this.wantPlay = true;
    this.app = next(APP, this.app, 'INSERT');
  }

  static loadSave(): Save | null {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Save | null;
      return s?.v === 2 ? s : null;
    } catch {
      return null;
    }
  }

  static clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  }

  /** (11/18 추가) 지금 진행 상태 한 벌(테이프 구간 시작에 찍어요). */
  state(): Snapshot {
    return { flags: [...this.flags], counts: { ...this.counts }, items: [...this.items], notes: [...this.notes], done: [...this.done] };
  }

  private snapshot(room: RoomId, spawn: string): Save {
    return { v: 2, room, spawn, ...this.state(), tapeSec: this.tapeSec, stats: { ...this.stats } };
  }

  private restore(s: Save, withStats: boolean) {
    this.flags = new Set(s.flags);
    this.counts = { ...s.counts };
    this.items = new Set(s.items);
    this.notes = new Set(s.notes);
    this.done = new Set(s.done);
    this.tapeSec = s.tapeSec;
    if (withStats) this.stats = { ...s.stats, rewinds: s.stats.rewinds ?? 0 }; // (11/20) 전에 저장한 것엔 rewinds가 없어요 // (11/20) 전에 저장한 것엔 rewinds가 없어요
  }

  /** 체크포인트를 브라우저에 남겨요. (11/18 추가) 개발용 시험 방(dev)은 안 남겨요. */
  private persist() {
    if (!this.checkpoint || this.room?.dev) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.checkpoint)); } catch { /* 저장 못 해도 계속 */ }
  }

  /** 방에 들어가기. keep = 체크포인트를 새로 찍지 않음(실패 후 다시 시작, 저장에서 이어 하기). */
  private async enterRoom(id: RoomId, spawn: string, keep: boolean, via: Fx) {
    this.leaveTape(); // (11/18 추가) 테이프를 보다가 방을 옮기면(타이머 등) 먼저 라이브로
    const gen = ++this.gen;
    this.locks = 0;
    this.lookOK = false;
    if (this.mode === 'failing') this.send('RESTARTED');
    if (this.mode === 'holding') this.send('HOLD_CANCEL');
    this.lock();

    const load = this.rooms[id];
    if (!load) throw new Error(`방 데이터가 없어요: ${id}`);
    const room = await load();
    await this.audio.load(soundsOf(room));
    if (gen !== this.gen) return;

    const at = room.spawns[spawn] ?? room.spawns.start;
    this.room = room;
    this.spawnId = room.spawns[spawn] ? spawn : 'start';
    this.timers.clear();
    this.hold = null;
    this.dwell = null;
    this.zoomIdle = null;
    this.seenMs.clear();
    this.zonesIn.clear();
    this.primed = false;
    this.vhsBase = room.vhs ?? 0.25;
    this.goal = null;
    this.typed = null;

    if (!keep) {
      this.checkpoint = this.snapshot(id, this.spawnId);
      this.persist();
    } else this.checkpoint ??= this.snapshot(id, this.spawnId);

    this.ruleOn = (room.rules ?? []).map((r) => this.test(r.when));
    this.audio.setAmb(room.amb);
    await this.world.enter(room, at, via);
    if (gen !== this.gen) return;
    this.prefetch(room);
    for (const f of clipsOf(room)) this.world.prepareClip?.(f); // (11/20 추가) 옛 녹화를 미리 받아 둬요

    if (this.app === 'boot') this.app = next(APP, this.app, 'READY');
    // (11/17 변경) 바로 플레이하지 않고 타이틀에서 PLAY ▶를 기다려요(main.ts의 인트로)
    if (this.app === 'title' && this.wantPlay) this.app = next(APP, this.app, 'INSERT');
    this.emit('room', id); // 기록 장치가 새 테이프 구간을 시작해요(되감기는 여기까지)
    this.hooks.log?.(`방: ${room.title}`);

    try {
      await this.script(room.enter ?? [], gen);
    } catch (e) {
      return swallow(e);
    }
    if (gen === this.gen) this.unlock();
  }

  /**
   * (11/17 추가) 이 방에서 갈 수 있는 방(room 행동이 가리키는 방)을 미리 불러오고, 소리를 받고, 지어 둬요.
   * 굽기는 나눠서 해서 그동안 게임은 그대로 돌아요.
   */
  private prefetch(room: Room) {
    const ids = new Set<string>();
    (function walk(v: unknown) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!v || typeof v !== 'object') return;
      const o = v as Record<string, unknown>;
      if (o.do === 'room' && typeof o.room === 'string') ids.add(o.room);
      for (const x of Object.values(o)) walk(x);
    })(room);
    ids.delete(room.id);
    for (const id of ids) {
      const load = this.rooms[id];
      if (!load) continue;
      void load()
        .then(async (r) => { await this.audio.load(soundsOf(r)); this.world.prebuild?.(r); })
        .catch((e) => console.warn('다음 방을 미리 못 불러왔어요', e));
    }
  }

  // ── 조건 ───────────────────────────────────────────

  /** (11/18 변경) 조건 검사는 state.ts의 testCond 하나를 테이프와 같이 써요. */
  test = (c: Cond): boolean => testCond(this, c);

  // ── 행동 실행 ──────────────────────────────────────

  /** 행동 줄 하나를 끝까지. (11/18 추가) 끝나지 않은 줄의 수를 세요(그동안은 되감기가 안 돼요 — 연출과 테이프가 섞이지 않게). */
  private async script(actions: Action[], gen: number): Promise<void> {
    this.scripts++;
    try {
      await this.exec(actions, gen);
    } finally {
      this.scripts--;
    }
  }

  /** 사건에서 시작된 행동 줄. block이면 끝날 때까지 걷기·조작을 잠가요. (11/20) look = 잠근 동안에도 둘러보기는 돼요(walk 전까지) */
  private async run(actions: Action[], block: boolean, look = false) {
    if (!actions.length) return;
    const gen = this.gen;
    if (block) { this.lock(); if (look) this.lookOK = true; }
    try {
      await this.script(actions, gen);
    } catch (e) {
      return swallow(e);
    } finally {
      if (look) this.lookOK = false;
    }
    if (block && gen === this.gen) this.unlock();
  }

  private async exec(actions: Action[], gen: number): Promise<void> {
    for (const a of actions) {
      if (gen !== this.gen) throw ABORT;
      switch (a.do) {
        case 'room':
          await this.enterRoom(a.room, a.spawn ?? 'start', false, a.via ?? 'fade');
          throw ABORT; // 이전 방의 남은 행동은 버려요
        case 'warp': {
          const s = this.room.spawns[a.spawn];
          if (!s) { console.warn(`서는 자리가 없어요: ${a.spawn}`); break; }
          this.leaveTape();
          this.lock();
          this.emit('act', 'warp', undefined, a.via ?? 'cut'); // (11/18 추가) 테이프에서도 같은 전환(어두워졌다 밝아짐)이 보이게
          await this.world.warp(s, a.via ?? 'cut');
          this.emit('act', 'warp-end', undefined, a.via ?? 'cut');
          if (gen !== this.gen) throw ABORT;
          this.zonesIn.clear();
          this.primed = false;
          this.unlock();
          break;
        }
        case 'wait':
          await this.sleep(a.ms);
          break;
        case 'walk': {
          // (11/19 6단계 추가) 카메라가 그 자리로 저절로(뛰어들어 돌아서기). 걷기·조작은 잠가요
          const s = this.room.spawns[a.spawn];
          if (!s) { console.warn(`서는 자리가 없어요: ${a.spawn}`); break; }
          this.lookOK = false; // (11/20) 연출로 걷기 시작하면 둘러보기도 잠가요(시선은 연출이 정해요)
          this.lock();
          await this.world.walk?.(s, a.ms);
          if (gen !== this.gen) throw ABORT;
          this.unlock();
          break;
        }
        case 'fall':
          // (11/20 7단계 추가) 문 너머 무의 공간으로 떨어짐 — 연출이라 걷기·둘러보기 잠금
          this.lookOK = false;
          this.lock();
          await this.world.fall?.(a.ms, a.depth);
          if (gen !== this.gen) throw ABORT;
          this.unlock();
          break;
        case 'checkpoint':
          // (11/19 6단계 추가) 이 방에서 실패하면 여기(지금 상태·이 자리)부터 다시. 저장도 여기로
          this.checkpoint = { ...this.snapshot(this.room.id, a.spawn), tag: a.name };
          this.persist();
          this.hooks.log?.(`체크포인트: ${a.spawn}`);
          break;
        case 'lock':
          if (a.off) this.unlock();
          else this.lock();
          break;
        case 'clip': {
          // (11/18 추가) 영상은 테이프에도 실사로 찍혀요: 실제로 화면에 나오기 시작한 순간과 끝난 순간을 적어요
          const onTape = a.tape !== false;
          if (a.index) CLIP_INDEX.set(a.clip, a.index); // (11/21 추가) 테이프의 INDEX 멈춤 자리
          this.lock();
          await this.world.clip(a.clip, onTape ? () => this.emit('act', 'clip', undefined, a.clip) : undefined);
          if (onTape) this.emit('act', 'clip-end', undefined, a.clip);
          if (gen !== this.gen) throw ABORT;
          this.unlock();
          break;
        }
        case 'pick':
          this.emit('act', 'pick', undefined, a.prop); // (11/18 추가) 테이프에서도 종이가 들려 다가오게
          await this.world.pick?.(a.prop);
          break;
        case 'flip':
          this.emit('act', 'flip', undefined, a.prop);
          await this.world.flip?.(a.prop);
          break;
        case 'light':
          this.emit('act', 'light', undefined, a.fx); // (11/18 추가) 정전도 테이프에 찍혀요
          await this.world.light?.(a.fx);
          break;
        case 'goal':
          if (!a.text) this.goal = null;
          else if (a.add && this.goal) this.goal = { ...this.goal, lines: [...this.goal.lines, a.text] };
          else this.goal = { lines: [a.text], count: a.count, of: a.of, strong: !!a.strong };
          break;
        case 'set':
          if (a.off) {
            if (this.flags.delete(a.flag)) this.emit('flag', a.flag, 0);
          } else if (!this.flags.has(a.flag)) {
            this.flags.add(a.flag);
            this.emit('flag', a.flag, 1);
          }
          break;
        case 'add': {
          const v = a.set ?? (this.counts[a.count] ?? 0) + (a.by ?? 1);
          if (v === this.counts[a.count]) break;
          this.counts[a.count] = v;
          this.emit('count', a.count, v);
          break;
        }
        case 'stat':
          this.stats[a.key] += a.by ?? 1;
          break;
        case 'give':
          // (11/17 변경) 가방은 화면에 안 보여 줘요(다시 꺼내 쓸 물건이 이야기에 없어서) — 조건 검사용으로만 기억해요
          if (!this.items.has(a.item)) {
            this.items.add(a.item);
            this.emit('item', a.item, 1);
          }
          break;
        case 'take':
          if (this.items.delete(a.item)) this.emit('item', a.item, 0);
          break;
        case 'note': {
          // 읽은 내용을 건조한 평서문으로 띄워요. 다시 읽어도 또 보여요. (11/17 변경) "메모 +" 머리말은 뺐어요(메모 화면이 없어서)
          const text = this.data.notes[a.note]?.text ?? a.note;
          if (!this.notes.has(a.note)) {
            this.notes.add(a.note);
            this.emit('note', a.note, 1);
          }
          this.hooks.toast?.(text);
          break;
        }
        case 'sound':
          this.audio.play(a.sound, a.fade ?? 0, a.at); // (11/20 2차) fade = 서서히 커지며
          break;
        case 'muffle':
          // (11/19 6단계 추가) 바탕음이 물속처럼 먹먹해졌다 돌아와요. 테이프를 보고 있으면 테이프 쪽 소리 설정이 우선이라 되돌리지 않아요
          this.audio.muffle?.('amb', 0.92, 0.75, 90);
          await this.sleep(a.ms);
          if (this.mode !== 'tape') this.audio.muffle?.('amb', 0, 1, 350);
          break;
        case 'stop':
          this.audio.stop(a.sound, a.fadeMs, a.slow);
          break;
        case 'amb':
          this.audio.setAmb(a.sound);
          break;
        case 'hint':
          this.hooks.hint?.(a.text, a.touch);
          break;
        case 'hush':
          // (11/19 추가) 음악·웃음소리(바탕음 묶음)가 뚝 끊겼다가 돌아와요. 테이프를 보고 있으면 테이프 쪽 소리 설정이 우선이라 건너뛰어요
          this.audio.muffle?.('amb', 0, 0, 30);
          await this.sleep(a.ms);
          if (this.mode !== 'tape') this.audio.muffle?.('amb', 0, 1, 260);
          break;
        case 'noise':
          this.world.noise?.(a.level, a.ms);
          break;
        case 'voice': {
          const { duration } = this.audio.play(a.sound);
          this.hooks.log?.(`🔊 ${a.sound}`);
          if (a.wait) await this.sleep(duration * 1000);
          break;
        }
        case 'timer':
          if (a.stop) this.timers.delete(a.timer);
          else this.startTimer(a.timer);
          break;
        case 'vhs':
          this.vhsBase = a.level;
          break;
        case 'osd':
          this.hooks.osd?.(a.text, a.ms ?? 2000);
          break;
        case 'fail':
          this.fail();
          throw ABORT;
        case 'type': {
          // (11/20 7단계) 엔딩 타자 글씨 — 영화 엔딩(build_ending_e3_v2.py)과 같은 빠르기(사용자 의견: 너무 느림):
          //   카피 = 글자마다 0.6·1.6·2.6프레임(30fps) 중 하나 + 문장부호 뒤 4프레임 / 크레딧(fast) = 한 프레임에 약 3.5글자
          //   소리: 카피는 글자마다, 크레딧은 한 프레임에 한 번. 게임 시간으로 재요(멈추면 같이 멈춤)
          if (a.off) { this.typed = null; break; }
          if (a.clear || !this.typed) {
            if (this.typed?.lines.length) this.audio.play('type.clear');
            this.typed = { lines: [], sizes: [], n: 0 };
          }
          if (a.text === undefined) break;
          const t = this.typed, text = a.text, F = 1000 / 30;
          t.lines.push(text);
          t.sizes.push(a.size ?? 21);
          t.n = 0;
          const at: number[] = [];
          let ms = 0;
          for (const ch of text) {
            at.push(ms);
            ms += a.fast ? 0.28 * F : [0.6, 1.6, 2.6][Math.floor(Math.random() * 3)] * F + (/[.,!]/.test(ch) ? 4 * F : 0);
          }
          const t0 = this.clock;
          while (t.n < text.length) {
            const el = this.clock - t0;
            let n = t.n;
            while (n < text.length && at[n] <= el) n++;
            if (n > t.n) {
              const ch = text[n - 1];
              this.audio.play(ch === ' ' ? 'type.space' : `type.${(n * 7 + text.length) % 6}`);
              t.n = n;
            }
            if (t.n < text.length) await this.sleep(1);
            if (gen !== this.gen) throw ABORT;
          }
          if (text.length) this.audio.play('type.done');
          break;
        }
        case 'end':
          // (11/20 7단계 추가) 끝 화면. 걷기·조작은 잠근 채로
          this.lock();
          this.hooks.end?.();
          break;
        case 'if':
          await this.exec(this.test(a.when) ? a.then : (a.else ?? []), gen);
          break;
      }
      if (gen !== this.gen) throw ABORT;
      await this.checkRules(gen);
    }
    this.hooks.change?.();
  }

  /** 규칙: 조건이 거짓 → 참으로 바뀌는 순간 한 번 실행. */
  private async checkRules(gen: number) {
    const rules = this.room.rules ?? [];
    for (let i = 0; i < rules.length; i++) {
      const now = this.test(rules[i].when);
      const fire = now && !this.ruleOn[i];
      this.ruleOn[i] = now;
      if (fire) await this.exec(rules[i].do, gen);
    }
  }

  /** 게임 시간으로 기다리기(일시정지 중엔 멈춤). */
  private sleep(ms: number): Promise<void> {
    return new Promise((res) => this.waiters.push({ at: this.clock + ms, gen: this.gen, res }));
  }

  private startTimer(id: string) {
    const t = this.room.timers?.[id];
    if (!t) return console.warn(`타이머 정의가 없어요: ${id}`);
    let len = 'ms' in t.length ? t.length.ms : this.audio.play(t.length.sound).duration * 1000;
    // (11/19 6단계 2차 추가) 개수에 따라 길이가 달라지는 타이머(끝없는 복도의 먼 불은 짧게, 가까운 불은 길게)
    if (t.steps) len = t.steps.ms[Math.min(t.steps.ms.length - 1, Math.max(0, this.counts[t.steps.count] ?? 0))];
    this.timers.set(id, { left: len, len });
  }

  /** 타이머 남은 시간(초). 표시용. */
  timeLeft(): Record<string, number> {
    return Object.fromEntries([...this.timers].map(([id, t]) => [id, Math.max(0, t.left / 1000)]));
  }

  // ── 실패 ───────────────────────────────────────────

  /** 테이프 씹힘 → 잠시 뒤 이 방의 체크포인트로. */
  private fail() {
    if (this.mode === 'failing') return;
    if (this.mode === 'tape') this.hooks.tapeEnd?.(); // (11/18 추가) 테이프를 보다가 시간이 다 되면 바로 씹힘 화면으로
    this.transport = null;
    this.seenMs.clear();
    this.gen++;
    this.locks = 0;
    this.lookOK = false;
    this.timers.clear();
    this.hold = null;
    this.dwell = null;
    this.zoomIdle = null;
    this.typed = null;
    // (11/19 6단계 2차 추가, 사용자 의견) 방마다 실패 소리: 경고음 같은 것은 늘어지며 낮아지다 멈추고(씹힘 길이만큼), 지지직이 같이 나요
    const ff = this.room?.fail;
    for (const id of ff?.slow ?? []) this.audio.stop(id, FAIL_MS - 100, true);
    this.audio.stopBus('voice');
    this.audio.stopBus('sfx', 100);
    if (ff?.sound) this.audio.play(ff.sound);
    this.send('FAIL');
    this.stats.fails++;
    this.failAt = this.clock + FAIL_MS;
    this.hooks.log?.('테이프 씹힘 → 방 처음부터');
  }

  // ── 되감기(테이프 보기) ── (11/18 추가) ─────────────

  /**
   * 되감기를 시작할 수 있는가: 녹화 중(live)이고, 연출이 진행 중이 아니고(정전·떼어 뒤집기 …), 이 방에서 끄지 않았고,
   * 되감기가 열렸을 때(플래그 'tape'). force = 개발용(아무 데서나).
   */
  canRewind(force = false): boolean {
    return this.app === 'play' && !this.paused && this.mode === 'live' && this.scripts === 0
      && !!this.room && !this.tapeOff && (force || this.flags.has(TAPE_FLAG));
  }

  /** (11/19 6단계 추가) 이 방에서 지금 되감기를 껐는가(방 전체 off, 또는 offWhen 조건 — 잠긴 문 추격 중). */
  get tapeOff(): boolean {
    const t = this.room?.tape;
    return !!t && (!!t.off || (!!t.offWhen && this.test(t.offWhen)));
  }

  /** ◀◀: 테이프 보기로. 진짜 상태는 그대로 두고, 조준·영역만 쉬어요. */
  rewind(force = false): boolean {
    if (!this.canRewind(force)) return false;
    this.send('REWIND');
    this.stats.rewinds++; // (11/20 7단계) 끝 화면 기록
    this.dwell = null;
    this.zoomIdle = null;
    this.seenMs.clear();
    this.hooks.log?.('◀◀ 테이프 보기');
    return true;
  }

  /** ■ 또는 테이프 끝(=지금)에 닿음: 녹화 화면(라이브)으로. */
  stopTape() {
    if (this.mode !== 'tape') return;
    this.send('TAPE_STOP');
    this.transport = null;
    this.dwell = null;
    this.zoomIdle = null;
    this.seenMs.clear();
    this.hooks.log?.('■ 녹화 화면으로');
  }

  /** 논리가 스스로 테이프 보기를 끝낼 때(방 이동·순간이동): 세계·소리·화면도 라이브로 돌려놓게 알려요. */
  private leaveTape() {
    if (this.mode !== 'tape') return;
    this.hooks.tapeEnd?.();
    this.stopTape();
  }

  // ── 조준 대상·영역 ─────────────────────────────────

  private key(kind: 't' | 'z', id: string) { return `${this.room.id}.${kind}.${id}`; }

  private on(x: { id: string; when?: Cond; once?: true }, kind: 't' | 'z'): boolean {
    return (!x.when || this.test(x.when)) && !(x.once && this.done.has(this.key(kind, x.id)));
  }

  /**
   * 지금 반응할 수 있는 조준 대상. 세계가 이 목록에만 선을 쏴요.
   * (11/18 추가) 테이프를 볼 때는 테이프 대상(tape: true)만, 녹화 중에는 그 밖의 대상만.
   */
  targets(): Target[] {
    if (!this.room || this.paused) return [];
    const tape = this.mode === 'tape';
    if (!tape && !this.free) return [];
    const slow = this.transport === 'pause' || this.transport === 'slow';
    return (this.room.targets ?? []).filter((t) => !!t.tape === tape && (!t.needs || slow) && this.on(t, 't')
      && (!tape || !t.when || !this.tapeTest || this.tapeTest(t.when))); // (11/20) 테이프 대상은 그 시각의 상태로도
  }

  private fire(t: Target) {
    if (t.once) this.done.add(this.key('t', t.id));
    this.emit('fire', t.id);
    this.hooks.log?.(`▶ ${t.label ?? t.id}`);
    void this.run(t.do, !!t.block && this.mode !== 'tape', !!t.look); // 테이프를 보는 중엔 잠그지 않아요(테이프 대상은 기억·소리·글씨만)
  }

  private zones(sense: Sense) {
    const zones = this.room.zones ?? [];
    if (!this.primed) {
      this.primed = true;
      // (11/19 6단계 변경) 조건(when)이 아직 안 맞는 영역은 "서 있던 영역"으로 치지 않아요 — 서 있는 채로 조건이 맞게 되면 그때 들어섬으로 쳐요
      // (잠긴 문: 문 앞에 서 있는데 불빛이 등 뒤까지 오면 잡힘)
      for (const z of zones) if (sense.zones.includes(z.id) && this.on(z, 'z')) this.zonesIn.add(z.id);
      return;
    }
    for (const z of zones) {
      const inside = sense.zones.includes(z.id);
      const was = this.zonesIn.has(z.id);
      if (inside && !was && this.on(z, 'z')) {
        this.zonesIn.add(z.id);
        if (z.once) this.done.add(this.key('z', z.id));
        this.hooks.log?.(`영역 들어섬: ${z.id}`);
        void this.run(z.enter ?? [], false);
        if (this.mode !== 'live') return; // 방을 옮기기 시작했으면 나머지 영역은 보지 않아요
      } else if (!inside && was) {
        this.zonesIn.delete(z.id);
        void this.run(z.leave ?? [], false);
      }
    }
  }

  /** (11/19 6단계 2차 추가 · 11/20 5차 줌 대상에도) 줌이 모자랄 때: unzoomed 행동(줌 안내). */
  private unzoom(t: Target) {
    this.hooks.log?.(`▷ ${t.label ?? t.id} — 줌 부족`);
    void this.run(t.unzoomed ?? [], false);
  }

  /** 조준 대상 반응(녹화 중에도, 테이프를 볼 때도). ms = 이번 프레임 길이. */
  private interact(sense: Sense, ms: number) {
    const list = this.targets();
    const tape = this.mode === 'tape';

    // (11/18 추가) seen: 화면 안쪽에 보이는 채로 잠깐 두면 반응. 화면에서 벗어났다 다시 들어와야 또 반응해요
    const seen = new Set(sense.seen ?? []);
    // (11/20 2차) 테이프에선 지나간 테이프 시간으로(빨리 감아도 본 것), 멈춤·느리게면 실제 시간 그대로
    const pass = ms * (tape ? Math.max(1, Math.abs(this.tapeSpeed)) : 1);
    for (const t of list) {
      if (t.on !== 'seen') continue;
      if (!seen.has(t.id)) { this.seenMs.delete(t.id); continue; }
      const v = this.seenMs.get(t.id) ?? 0;
      if (v < 0) continue;
      if (v + pass >= (t.dwellMs ?? 500)) { this.seenMs.set(t.id, -1); this.fire(t); }
      else this.seenMs.set(t.id, v + pass);
    }
    if (this.mode !== (tape ? 'tape' : 'live')) return;

    const t = sense.aim ? list.find((x) => x.id === sense.aim && x.on !== 'seen') : undefined;
    if (!t) { this.dwell = null; this.zoomIdle = null; return; }

    if (t.on === 'click') {
      // (11/19 6단계 2차 추가) 줌을 당겨야 하는 대상: 덜 당기고 누르면 줌 안내(unzoomed)만
      if (sense.click && t.needZoom && sense.zoom < t.needZoom) {
        this.unzoom(t);
      } else if (sense.click) this.fire(t);
    } else if (t.on === 'hold') {
      if (sense.press && !tape) {
        this.send('HOLD_START');
        this.hold = { t, start: this.clock };
      }
    } else {
      // zoom·aim: 조준한 채 잠깐 두면 반응.
      // 반응한 뒤에는 줌을 풀거나 시선을 돌렸다가 다시 맞춰야 또 반응해요(ms = -1: 방금 반응함)
      const ok = t.on === 'aim' || sense.zoom >= (t.minZoom ?? 1.5);
      // (11/20 5차 추가, 사용자 의견: 통로 안내판에서 줌을 몰라 막힐 수 있음) 줌 대상인데 줌이 모자람 → unzoomed(조작 안내 등):
      //   줌 없이 누름(폰은 톡) / 줌을 전혀 안 당긴 채 unzoomedMs 동안 조준 — 한 번 조준하는 동안 한 번만, 줌을 당기기 시작하면(스스로 알아냄) 안 셈
      if (t.on === 'zoom' && !ok && t.unzoomed && !tape) {
        if (this.zoomIdle?.id !== t.id) this.zoomIdle = { id: t.id, ms: 0 };
        if (sense.zoom > 1.05) this.zoomIdle.ms = -1;
        if (sense.click) this.unzoom(t);
        else if (t.unzoomedMs && this.zoomIdle.ms >= 0 && (this.zoomIdle.ms += ms) >= t.unzoomedMs) { this.zoomIdle.ms = -1; this.unzoom(t); }
      }
      if (!ok) this.dwell = null;
      else {
        if (this.dwell?.id !== t.id) this.dwell = { id: t.id, ms: 0 };
        if (this.dwell.ms >= 0) {
          this.dwell.ms += ms;
          if (this.dwell.ms >= (t.dwellMs ?? 500)) {
            this.dwell.ms = -1;
            this.fire(t);
          }
        }
      }
    }
  }

  // ── 매 프레임 ──────────────────────────────────────

  /** dt = 흐른 시간(초). sense = 세계가 본 것. */
  update(dt: number, sense: Sense) {
    if (this.paused || this.app !== 'play' || !this.room) return;
    const ms = dt * 1000;
    this.clock += ms; // 테이프를 보는 동안에도 방의 시간은 흘러요(TECH_DESIGN 4장 규칙 1)
    this.stats.playMs += ms;
    if (this.mode !== 'tape') this.tapeSec += dt;

    if (this.waiters.length) {
      const keep: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.at <= this.clock || w.gen !== this.gen) w.res();
        else keep.push(w);
      }
      this.waiters = keep;
    }

    // (11/19 6단계 변경) 남은 시간을 줄여요. faster: 그 seen 대상이 화면에 보이는 동안은 x배(뒤를 보는 동안 불이 빨리 다가옴)
    this.fast = false;
    const seenNow = sense.seen ?? [];
    for (const [id, t] of this.timers) {
      const f = this.room.timers?.[id]?.faster;
      const quick = !!f && this.mode !== 'tape' && seenNow.includes(f.seen);
      if (quick) this.fast = true;
      t.left -= ms * (quick ? f!.x : 1);
      if (t.left > 0) continue;
      this.timers.delete(id);
      this.hooks.log?.(`⏱ 시간 끝: ${id}`);
      void this.script(this.room.timers![id].end, this.gen).catch(swallow);
    }

    if (this.mode === 'failing') {
      if (this.clock >= this.failAt && this.checkpoint) {
        this.failAt = Infinity;
        // (11/18 추가) 그 방에서 실패한 횟수 fails.<방> — 다시 시작해도, 새로 고침해도 남아요.
        // 방 데이터에서 { count: 'fails.<방>', gte: 2 }처럼 조건으로 써요(잠긴 문: 2번 넘게 실패하면 보험 힌트)
        const key = `fails.${this.checkpoint.tag ?? this.checkpoint.room}`; // (11/19 6단계) checkpoint 행동으로 찍은 자리면 그 이름(잠긴 문 = fails.lockdoor)
        const n = (this.counts[key] ?? 0) + 1;
        this.restore(this.checkpoint, false);
        this.counts[key] = n;
        this.checkpoint.counts[key] = n;
        this.persist();
        void this.enterRoom(this.checkpoint.room, this.checkpoint.spawn, true, 'cut');
      }
      return;
    }

    if (this.mode === 'holding' && this.hold) {
      const h = this.hold;
      if (!sense.press || sense.aim !== h.t.id) {
        this.hold = null;
        this.send('HOLD_CANCEL');
        void this.run(h.t.release ?? [], false);
      } else if (this.clock - h.start >= (h.t.holdMs ?? 1000)) {
        this.hold = null;
        this.send('HOLD_DONE'); // → busy
        this.locks = 1;
        if (h.t.once) this.done.add(this.key('t', h.t.id));
        this.emit('fire', h.t.id);
        this.hooks.log?.(`▶ ${h.t.label ?? h.t.id}`);
        const gen = this.gen;
        void this.script(h.t.do, gen).catch(swallow).then(() => { if (gen === this.gen) this.unlock(); });
      }
      this.hooks.change?.();
      return;
    }

    if (this.mode === 'tape') {
      this.interact(sense, ms); // 테이프 대상만(조준 = 테이프 속 화면 가운데)
      return;
    }

    if (this.mode !== 'live') return;

    this.zones(sense);
    if (this.mode !== 'live') return;
    this.interact(sense, ms);
  }

  // ── 일시정지 ───────────────────────────────────────

  setPaused(on: boolean) {
    const a = next(APP, this.app, on ? 'PAUSE' : 'RESUME');
    if (a === this.app) return;
    this.app = a;
    this.paused = on;
    if (on) this.audio.suspend();
    else this.audio.resume();
    this.hooks.change?.();
  }

  // ── 표시용 ─────────────────────────────────────────

  /** VHS 노이즈 세기 0~1. 긴장 타이머가 줄수록 세져요. */
  get vhs(): number {
    if (this.mode === 'failing') return 1;
    let v = this.vhsBase;
    for (const [id, t] of this.timers) {
      if (this.room.timers?.[id]?.tension) v = Math.max(v, this.vhsBase + (1 - t.left / t.len) * 0.6);
    }
    return Math.min(1, v);
  }

  /** 누르고 있기 진행 0~1. */
  get holdRatio(): number {
    return this.hold ? Math.min(1, (this.clock - this.hold.start) / (this.hold.t.holdMs ?? 1000)) : 0;
  }

  /** 줌·바라보기 진행 0~1. */
  get dwellRatio(): number {
    if (!this.dwell || !this.room) return 0;
    const t = this.room.targets?.find((x) => x.id === this.dwell!.id);
    return Math.max(0, Math.min(1, this.dwell.ms / (t?.dwellMs ?? 500)));
  }
}
