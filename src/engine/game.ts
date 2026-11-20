/**
 * 게임 진행기 — 방 데이터(src/data/rooms)를 읽어서 실제로 굴려요.
 *
 * 맡은 일: 상태(플래그·가방·메모), 조건 검사, 행동 실행, 시점 이동, 줌, 누르고 있기,
 *          타이머, 규칙, 되감기, 실패 → 방 처음부터, 체크포인트 저장.
 * 맡지 않는 일: 화면 그리기(renderer), 영상 다루기(player), 소리(audio), 입력 받기(input).
 */
import type {
  Action, Cond, Game as GameData, Hotspot, Look, LookDir, Room, RoomId, Save, Shape, TapeSegment, View,
} from '../data/schema.ts';
import { clipFile, collect, preload } from './assets.ts';
import type { AudioEngine } from './audio.ts';
import {
  APP, MODE, TRANSPORT, TRANSPORT_START, next,
  type App, type Mode, type ModeEvent, type Transport, type TransportEvent,
} from './machine.ts';
import type { Player, Trans } from './player.ts';
import { OVERSCAN, clampFocus, toImage, type Frame, type Vec } from './renderer.ts';

const ABORT = Symbol('abort'); // 실패·방 이동으로 하던 행동을 그만둘 때
const SAVE_KEY = 'congrats-escape/save/v1';
const FAIL_MS = 1400; // 테이프 씹힘 연출 길이
const DIRS: Record<LookDir, Vec> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1], back: [1, 0] };

export interface Hooks {
  /** 상태가 바뀜(표시 갱신용). */
  change?(): void;
  /** 방 소재 받는 중. */
  loading?(done: number, total: number): void;
  /** 개발용 기록. */
  log?(msg: string): void;
  /** 캠코더 화면 글씨 잠깐 띄우기. */
  osd?(text: string, ms: number): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const swallow = (e: unknown) => { if (e !== ABORT) console.error(e); };

function inside(s: Shape, [x, y]: Vec): boolean {
  if ('rect' in s) {
    const [rx, ry, rw, rh] = s.rect;
    return x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  }
  let hit = false;
  for (let i = 0, j = s.poly.length - 1; i < s.poly.length; j = i++) {
    const [xi, yi] = s.poly[i];
    const [xj, yj] = s.poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

export class Game {
  app: App = 'boot';
  mode: Mode = 'busy';
  transport: Transport = TRANSPORT_START;
  paused = false;

  room!: Room;
  viewId = '';
  zoom = 1;
  focus: Vec = [0.5, 0.5];

  flags = new Set<string>();
  counts: Record<string, number> = {};
  items = new Set<string>();
  notes = new Set<string>();
  stats = { obeyed: 0, keysTried: 0, fails: 0, rewinds: 0, playMs: 0 };
  tapeSec = 0;

  /** 개발용: 클릭 영역 테두리 보기. */
  showSpots = false;

  private done = new Set<string>(); // 한 번만 반응하는 것들 중 이미 쓴 것
  private gen = 0; // 실패·방 이동 때마다 올라가요. 예전 행동 줄은 이 값이 달라진 걸 보고 그만둬요
  private clock = 0; // 게임 시간(ms). 일시정지 중엔 안 흘러요
  private last = performance.now();
  private timers = new Map<string, { end: number; len: number }>();
  private waiters: { at: number; gen: number; res: () => void }[] = [];
  private ruleOn: boolean[] = [];
  private checkpoint: Save | null = null;
  private hold: { spot: Hotspot; start: number } | null = null;
  private whip: Vec = [1, 0];
  private shown = '';
  private vhsBase = 0.2;
  private tapeSegs: TapeSegment[] = [];
  private failAt = Infinity;

  constructor(
    private data: GameData,
    private rooms: Record<RoomId, () => Promise<Room>>,
    private player: Player,
    private audio: AudioEngine,
    private hooks: Hooks = {},
  ) {
    player.onTapeEdge = (edge) => (edge === 'start' ? void this.tapeBtn('HIT_START') : this.tapeStop());
    setInterval(() => this.tick(), 33);
  }

  get view(): View { return this.room.views[this.viewId]; }

  private send(ev: ModeEvent) {
    this.mode = next(MODE, this.mode, ev);
    this.hooks.change?.();
  }

  // ── 시작·저장 ──────────────────────────────────────

  /** roomId를 주면 그 방에서 새로, 안 주면 저장된 곳(없으면 처음)에서. */
  async start(roomId?: RoomId) {
    const saved = roomId ? null : Game.loadSave();
    if (saved) this.restore(saved, true);
    await this.enterRoom(roomId ?? saved?.room ?? this.data.start, !!saved);
  }

  static loadSave(): Save | null {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as Save | null;
      return s?.v === 1 ? s : null;
    } catch {
      return null;
    }
  }

  static clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* 저장소를 못 쓰는 환경 */ }
  }

  private snapshot(room: RoomId): Save {
    return {
      v: 1, room,
      flags: [...this.flags], counts: { ...this.counts }, items: [...this.items], notes: [...this.notes],
      tapeSec: this.tapeSec, stats: { ...this.stats },
    };
  }

  private restore(s: Save, withStats: boolean) {
    this.flags = new Set(s.flags);
    this.counts = { ...s.counts };
    this.items = new Set(s.items);
    this.notes = new Set(s.notes);
    this.tapeSec = s.tapeSec;
    if (withStats) this.stats = { ...s.stats };
  }

  /** 방에 들어가기. keep = 체크포인트를 새로 찍지 않음(실패 후 다시 시작, 저장에서 이어 하기). */
  private async enterRoom(id: RoomId, keep: boolean) {
    const gen = ++this.gen;
    if (this.mode === 'failing') this.send('RESTARTED');
    if (this.mode === 'live') this.send('RUN');

    const load = this.rooms[id];
    if (!load) throw new Error(`방 데이터가 없어요: ${id}`);
    const room = await load();
    const { media, sounds } = collect(room);
    await Promise.all([preload(media, this.hooks.loading), this.audio.load(sounds)]);
    if (gen !== this.gen) return;

    this.room = room;
    this.timers.clear();
    this.done.clear();
    this.hold = null;
    this.zoom = 1;
    this.focus = [0.5, 0.5];
    this.shown = '';
    this.vhsBase = room.vhs ?? 0.2;

    if (!keep) {
      this.checkpoint = this.snapshot(id);
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.checkpoint)); } catch { /* 저장 못 해도 계속 */ }
    } else this.checkpoint ??= this.snapshot(id);

    this.ruleOn = (room.rules ?? []).map((r) => this.test(r.when));
    this.audio.setAmb(room.amb);
    this.viewId = room.start.view;
    await this.showView({ kind: 'fade', ms: 200 });

    if (this.app === 'boot') this.app = next(APP, this.app, 'READY');
    if (this.app === 'title' && id !== this.data.start) this.app = next(APP, this.app, 'INSERT');
    this.hooks.log?.(`방: ${room.title}`);

    try {
      await this.exec(room.start.do ?? [], gen);
      await this.exec(this.view.enter ?? [], gen);
    } catch (e) {
      return swallow(e);
    }
    if (gen === this.gen && this.mode === 'busy') this.send('DONE');
  }

  // ── 조건 ───────────────────────────────────────────

  test(c: Cond): boolean {
    if ('flag' in c) return this.flags.has(c.flag);
    if ('has' in c) return this.items.has(c.has);
    if ('count' in c) return (this.counts[c.count] ?? 0) >= c.gte;
    if ('not' in c) return !this.test(c.not);
    if ('all' in c) return c.all.every((x) => this.test(x));
    return c.any.some((x) => this.test(x));
  }

  // ── 행동 실행 ──────────────────────────────────────

  /** 플레이어 조작에서 시작된 행동 줄. 실행하는 동안 입력을 잠가요(busy). */
  private async act(actions: Action[]) {
    if (!actions.length) return;
    const gen = this.gen;
    if (this.mode === 'live') this.send('RUN');
    try {
      await this.exec(actions, gen);
      if (this.mode !== 'tape') await this.showView({ kind: 'fade', ms: 250 }); // 조건이 바뀌어 배경이 달라졌으면
    } catch (e) {
      return swallow(e);
    }
    if (gen === this.gen && this.mode === 'busy') this.send('DONE');
  }

  private async exec(actions: Action[], gen: number): Promise<void> {
    for (const a of actions) {
      if (gen !== this.gen) throw ABORT;
      switch (a.do) {
        case 'go': {
          if (a.via) {
            this.shown = '';
            await this.player.clip(clipFile(a.via));
            if (gen !== this.gen) throw ABORT;
          }
          this.viewId = a.view;
          this.zoom = 1;
          this.focus = [0.5, 0.5];
          await this.showView(a.via ? { kind: 'fade', ms: 120 } : { kind: 'whip', ms: 300, dir: this.whip });
          await this.exec(this.view.enter ?? [], gen);
          break;
        }
        case 'room':
          if (a.via) {
            await this.player.clip(clipFile(a.via));
            if (gen !== this.gen) throw ABORT;
          }
          await this.enterRoom(a.room, false);
          throw ABORT; // 이전 방의 남은 행동은 버려요
        case 'clip':
          this.shown = '';
          await this.player.clip(clipFile(a.clip));
          break;
        case 'wait':
          await this.sleep(a.ms);
          break;
        case 'set':
          if (a.off) this.flags.delete(a.flag);
          else this.flags.add(a.flag);
          break;
        case 'add':
          this.counts[a.count] = (this.counts[a.count] ?? 0) + (a.by ?? 1);
          break;
        case 'stat':
          this.stats[a.key] += a.by ?? 1;
          break;
        case 'give':
          this.items.add(a.item);
          this.hooks.log?.(`가방 + ${this.data.items[a.item]?.name ?? a.item}`);
          break;
        case 'take':
          this.items.delete(a.item);
          break;
        case 'note':
          if (!this.notes.has(a.note)) this.hooks.log?.(`메모 + ${this.data.notes[a.note]?.text ?? a.note}`);
          this.notes.add(a.note);
          break;
        case 'sound':
          this.audio.play(a.sound);
          break;
        case 'stop':
          this.audio.stop(a.sound, a.fadeMs);
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
    const len = 'ms' in t.length ? t.length.ms : this.audio.play(t.length.sound).duration * 1000;
    this.timers.set(id, { end: this.clock + len, len });
  }

  /** 타이머 남은 시간(초). 표시용. */
  timeLeft(): Record<string, number> {
    return Object.fromEntries([...this.timers].map(([id, t]) => [id, Math.max(0, (t.end - this.clock) / 1000)]));
  }

  private async showView(t: Trans) {
    const b = this.view.backdrop.find((x) => !x.when || this.test(x.when));
    if (!b) return;
    const file = 'still' in b.media ? b.media.still : b.media.loop;
    if (file === this.shown) return;
    this.shown = file;
    if ('still' in b.media) await this.player.still(file, t);
    else await this.player.loop(file, t);
  }

  // ── 실패 ───────────────────────────────────────────

  /** 테이프 씹힘 → 잠시 뒤 이 방의 체크포인트로. */
  private fail() {
    if (this.mode === 'failing') return;
    this.gen++;
    this.timers.clear();
    this.hold = null;
    this.audio.stopBus('voice');
    this.audio.stopBus('sfx', 100);
    this.player.stop();
    this.send('FAIL');
    this.stats.fails++;
    this.failAt = this.clock + FAIL_MS;
    this.hooks.log?.('테이프 씹힘 → 방 처음부터');
  }

  // ── 매 순간 ────────────────────────────────────────

  private tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    if (this.paused || this.app === 'boot') return;
    this.clock += dt;
    this.stats.playMs += dt;

    if (this.waiters.length) {
      const keep: typeof this.waiters = [];
      for (const w of this.waiters) {
        if (w.at <= this.clock || w.gen !== this.gen) w.res();
        else keep.push(w);
      }
      this.waiters = keep;
    }

    for (const [id, t] of this.timers) {
      if (this.clock < t.end) continue;
      this.timers.delete(id);
      this.hooks.log?.(`⏱ 시간 끝: ${id}`);
      void this.exec(this.room.timers![id].end, this.gen).catch(swallow);
    }

    if (this.hold && this.mode === 'holding' && this.clock - this.hold.start >= (this.hold.spot.holdMs ?? 1000)) {
      const h = this.hold.spot;
      this.hold = null;
      this.send('HOLD_DONE');
      this.fire(h);
    }

    if (this.mode === 'failing' && this.clock >= this.failAt && this.checkpoint) {
      this.failAt = Infinity;
      this.restore(this.checkpoint, false);
      void this.enterRoom(this.checkpoint.room, true);
    }

    this.player.tapeTick();
    if (this.timers.size || this.mode === 'tape' || this.hold) this.hooks.change?.();
  }

  // ── 조작 (input.ts와 시험용 버튼이 불러요) ─────────────

  private key(id: string) { return `${this.room.id}.${this.viewId}.${id}`; }

  private spots(): Hotspot[] {
    return (this.view.hotspots ?? []).filter(
      (h) => (!h.when || this.test(h.when)) && !(h.once && this.done.has(this.key(h.id))),
    );
  }

  /** 화면 좌표 p(0~1)에 있는 클릭 영역. */
  spotAt(p: Vec): Hotspot | null {
    if (this.mode !== 'live' || this.paused) return null;
    const q = toImage(p, this.zoom, this.focus);
    return this.spots().find((h) => (h.on === 'zoom' || this.zoom >= (h.minZoom ?? 1)) && inside(h.shape, q)) ?? null;
  }

  private fire(h: Hotspot) {
    if (h.once) this.done.add(this.key(h.id));
    this.hooks.log?.(`▶ ${h.label ?? h.id}`);
    void this.act(h.do);
  }

  click(p: Vec) {
    if (this.paused) return;
    if (this.mode === 'tape') return this.tapeClick(p);
    const h = this.spotAt(p);
    if (h && h.on !== 'hold') this.fire(h); // 줌 영역은 눌러도 다가가요(모바일·접근성)
  }

  /** 누르고 있기 시작. 그 자리에 누르고 있을 것이 있으면 true. */
  holdStart(p: Vec): boolean {
    const h = this.spotAt(p);
    if (!h || h.on !== 'hold') return false;
    this.send('HOLD_START');
    this.hold = { spot: h, start: this.clock };
    return true;
  }

  holdEnd() {
    if (!this.hold || this.mode !== 'holding') return;
    const h = this.hold.spot;
    this.hold = null;
    this.send('HOLD_CANCEL');
    if (h.release) void this.act(h.release);
  }

  private lookOf(dir: LookDir): Look | null {
    const v = this.view.look?.[dir];
    if (!v) return null;
    return (Array.isArray(v) ? v : [v]).find((l) => !l.when || this.test(l.when)) ?? null;
  }

  /** 지금 둘러볼 수 있는 방향. */
  looks(): LookDir[] {
    if (this.mode !== 'live') return [];
    return (Object.keys(DIRS) as LookDir[]).filter((d) => this.lookOf(d));
  }

  look(dir: LookDir): boolean {
    if (this.mode !== 'live' || this.paused) return false;
    const l = this.lookOf(dir);
    if (!l) return false;
    this.whip = DIRS[dir];
    this.hooks.log?.(`둘러보기: ${dir}`);
    void this.act([...(l.to ? [{ do: 'go' as const, view: l.to, via: l.via }] : []), ...(l.do ?? [])]);
    return true;
  }

  /** 줌. p = 줌의 중심이 될 화면 좌표(마우스 위치). */
  setZoom(z: number, p: Vec = [0.5, 0.5]) {
    if (this.mode !== 'live' || this.paused) return;
    const q = toImage(p, this.zoom, this.focus); // 마우스 아래의 이미지 지점이 그대로 마우스 아래에 있게
    this.zoom = clamp(z, 1, this.view.zoomMax ?? 1);
    const zz = this.zoom * OVERSCAN;
    this.focus = clampFocus([q[0] - (p[0] - 0.5) / zz, q[1] - (p[1] - 0.5) / zz], this.zoom);
    // 줌 영역: 마우스가 가리키는 곳(또는 화면 가운데)이 그 영역 안이고 충분히 당겼으면 실행
    const h = this.spots().find(
      (x) => x.on === 'zoom' && this.zoom >= (x.minZoom ?? 1.5) && (inside(x.shape, q) || inside(x.shape, this.focus)),
    );
    if (h) this.fire(h);
    this.hooks.change?.();
  }

  // ── 되감기 ─────────────────────────────────────────

  async rewind() {
    if (this.mode !== 'live' || this.paused) return;
    const segs = (this.room.tape?.segments ?? []).filter((s) => !s.when || this.test(s.when));
    if (!segs.length) return this.hooks.log?.('이 방엔 되감을 테이프가 없어요');
    this.send('REWIND');
    this.transport = TRANSPORT_START;
    this.tapeSegs = segs;
    await this.player.tapeOpen(segs.map((s) => s.clip));
    if ((this.mode as Mode) !== 'tape') this.player.tapeClose(); // 여는 사이 실패한 경우
  }

  async tapeBtn(ev: TransportEvent) {
    if (this.mode !== 'tape' || this.paused) return;
    if (ev === 'STEP') {
      if (this.transport === 'pause') await this.player.tapeStep();
      return;
    }
    const t = next(TRANSPORT, this.transport, ev);
    if (t === this.transport) return;
    if (await this.player.tapeSet(t)) {
      this.transport = t;
      this.hooks.change?.();
    }
  }

  /** ■ 또는 테이프 끝(=지금) → 보던 시점으로. */
  tapeStop() {
    if (this.mode !== 'tape') return;
    this.player.tapeClose();
    this.send('TAPE_STOP');
    this.shown = '';
    void this.showView({ kind: 'fade', ms: 200 });
  }

  /** 테이프 위치와 길이(초). 표시용. */
  tapeInfo() {
    return { pos: this.player.tapePos(), total: this.player.tapeTotal() };
  }

  private tapeClick(p: Vec) {
    const w = this.player.tapeWhere();
    const seg = w && this.tapeSegs[w.i];
    if (!w || !seg) return;
    const q = toImage(p, 1, [0.5, 0.5]);
    const m = seg.marks?.find(
      (x) =>
        w.t >= x.from && w.t <= x.to && inside(x.shape, q) &&
        !(x.once && this.done.has(`tape.${seg.id}.${x.id}`)) &&
        (!x.needs || this.transport === 'pause' || (x.needs === 'slow' && this.transport === 'slow')),
    );
    if (!m) return;
    if (m.once) this.done.add(`tape.${seg.id}.${m.id}`);
    this.hooks.log?.(`테이프에서 찾음: ${m.id}`);
    void this.exec(m.do, this.gen).catch(swallow);
  }

  // ── 일시정지 ───────────────────────────────────────

  setPaused(on: boolean) {
    const a = next(APP, this.app, on ? 'PAUSE' : 'RESUME');
    if (a === this.app) return;
    this.app = a;
    this.paused = on;
    if (on) { this.player.pause(); this.audio.suspend(); }
    else { this.player.resume(); this.audio.resume(); }
    this.hooks.change?.();
  }

  // ── 그릴 것 ────────────────────────────────────────

  private get vhs(): number {
    let v = this.vhsBase;
    for (const [id, t] of this.timers) {
      if (this.room.timers?.[id]?.tension) v = Math.max(v, this.vhsBase + (1 - (t.end - this.clock) / t.len) * 0.6);
    }
    return Math.min(1, v);
  }

  /** 이번 프레임에 그릴 내용. */
  frame(now: number): Frame {
    const p = this.player;
    p.update(now);
    const tape = this.mode === 'tape';
    const look: Frame['look'] = this.paused ? 'menu'
      : this.mode === 'failing' ? 'fail'
      : !tape ? 'live'
      : this.transport === 'rew' || this.transport === 'ff' ? 'tape-rew'
      : this.transport === 'pause' ? 'tape-pause' : 'tape-play';
    return {
      cur: p.cur, old: p.old, mix: p.mix, kind: p.kind, dir: p.dir,
      zoom: tape ? 1 : this.zoom,
      focus: tape ? [0.5, 0.5] : this.focus,
      shake: p.cur instanceof HTMLImageElement ? 1 : 0,
      vhs: this.room ? this.vhs : 0,
      look,
      hold: this.hold ? clamp((this.clock - this.hold.start) / (this.hold.spot.holdMs ?? 1000), 0, 1) : 0,
      time: now / 1000,
      debug: this.showSpots && this.mode === 'live' ? this.spots().map((h) => h.shape) : undefined,
    };
  }
}
