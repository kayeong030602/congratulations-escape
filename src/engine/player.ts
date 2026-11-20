/**
 * 영상 플레이어.
 *
 * - 영상 요소 2개(앞/뒤)를 번갈아 써요. 다음 조각을 뒤쪽에 올려 첫 프레임이 준비된 뒤에
 *   앞뒤를 바꿔서, 넘어갈 때 검은 화면이 끼지 않아요.
 * - 화면에 직접 그리지 않아요. "지금 보여 줄 것(cur) / 직전 것(old) / 전환 진행(mix)"만 알려 주고,
 *   그리는 일은 렌더러(renderer.ts → 나중에 WebGL 셰이더)가 해요.
 * - 테이프(되감기): 앞으로 파일과 거꾸로 파일을 같은 순간으로 맞춰 갈아 끼워요.
 */
import { rev, url } from './assets.ts';
import type { Src, Vec } from './renderer.ts';

export type Trans = { kind: 'cut' | 'fade' | 'whip'; ms?: number; dir?: Vec };
export type TapeMode = 'rew' | 'play' | 'slow' | 'pause' | 'ff';

type Seg = { clip: string; dur: number };
type Tape = { segs: Seg[]; i: number; dir: 1 | -1; rate: number; playing: boolean; lock: boolean };

const FRAME = 1 / 30;
const REW_RATE = 3;

export class Player {
  // 렌더러가 읽는 값
  cur: Src | null = null;
  old: Src | null = null;
  mix = 1;
  kind: Trans['kind'] = 'cut';
  dir: Vec = [0, 0];

  /** 테이프가 맨 앞(start)이나 끝(end = 지금)에 닿았을 때. */
  onTapeEdge: (edge: 'start' | 'end') => void = () => {};

  private vids: HTMLVideoElement[];
  private front = 0;
  private images = new Map<string, HTMLImageElement>();
  private durs = new Map<string, number>();
  private t0 = 0;
  private ms = 0;
  private endClip: (() => void) | null = null;
  private tape: Tape | null = null;
  private held: HTMLVideoElement[] = [];

  constructor() {
    this.vids = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      // 화면엔 안 보이지만 문서 안에 있어야 재생되는 브라우저(iOS)가 있어요
      v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
      v.addEventListener('ended', () => {
        if (v === this.vids[this.front] && !this.tape) this.finishClip();
      });
      document.body.append(v);
      return v;
    });
  }

  private get fv() { return this.vids[this.front]; }
  private get bv() { return this.vids[1 - this.front]; }

  // ── 기본 동작 ──────────────────────────────────────

  /** 영상 요소에 파일을 올리고 원하는 위치의 프레임이 준비될 때까지 기다려요. */
  private ready(v: HTMLVideoElement, file: string, at = 0): Promise<void> {
    return new Promise((res, rej) => {
      const seek = () => {
        if (Math.abs(v.currentTime - at) < 0.005) return res();
        v.addEventListener('seeked', () => res(), { once: true });
        v.currentTime = at;
      };
      if (v.dataset.file === file && v.readyState >= 2) return seek();
      v.dataset.file = file;
      v.addEventListener('loadeddata', seek, { once: true });
      v.addEventListener('error', () => rej(new Error(`영상을 못 읽었어요: ${file}`)), { once: true });
      v.src = url(file);
      v.load();
    });
  }

  private present(src: Src, t: Trans) {
    if (src !== this.cur) this.old = this.cur;
    this.cur = src;
    this.kind = t.kind;
    this.dir = t.dir ?? [0, 0];
    this.ms = t.kind === 'cut' ? 0 : (t.ms ?? 150);
    this.mix = this.ms ? 0 : 1;
    this.t0 = performance.now();
    if (!this.ms) this.old = null;
  }

  /** 뒤쪽 영상을 앞으로. */
  private swap(v: HTMLVideoElement, t: Trans) {
    const prev = this.fv;
    this.present(v, t);
    this.front = this.vids.indexOf(v);
    if (prev !== v) prev.pause();
  }

  private finishClip() {
    this.endClip?.();
    this.endClip = null;
  }

  /** 전환 진행. 매 프레임 불러요. */
  update(now: number) {
    if (this.mix >= 1) return;
    this.mix = Math.min(1, (now - this.t0) / this.ms);
    if (this.mix >= 1) this.old = null;
  }

  /** 정지 이미지 보여 주기. */
  async still(file: string, t: Trans = { kind: 'fade' }) {
    let img = this.images.get(file);
    if (!img) {
      const el = new Image();
      await new Promise<void>((res, rej) => {
        el.onload = () => res();
        el.onerror = () => rej(new Error(`이미지를 못 읽었어요: ${file}`));
        el.src = url(file);
      });
      // 미리 풀어 두면 처음 그릴 때 덜 끊겨요. 창이 가려져 있으면 끝나지 않을 수 있어서 0.3초만 기다려요.
      await Promise.race([el.decode().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
      img = el;
      this.images.set(file, img);
    }
    this.present(img, t);
    for (const v of this.vids) v.pause();
  }

  /** 반복 클립 보여 주기. */
  async loop(file: string, t: Trans = { kind: 'fade' }) {
    const v = this.bv;
    await this.ready(v, file, 0);
    v.loop = true;
    v.playbackRate = 1;
    this.swap(v, t);
    await v.play().catch(() => {});
  }

  /** 클립을 한 번 재생하고 끝나면 돌아와요. 끝난 뒤엔 마지막 프레임에 멈춰 있어요. */
  async clip(file: string): Promise<void> {
    const v = this.bv;
    await this.ready(v, file, 0);
    v.loop = false;
    v.playbackRate = 1;
    this.swap(v, { kind: 'fade', ms: 80 });
    const done = new Promise<void>((r) => (this.endClip = r));
    try {
      await v.play();
    } catch {
      this.finishClip(); // 재생이 막힌 경우: 멈추지 않고 넘어가요
    }
    await done;
  }

  /** 전부 멈춤(실패 연출·방 이동 때). 기다리던 clip()도 풀어 줘요. */
  stop() {
    for (const v of this.vids) v.pause();
    this.tape = null;
    this.finishClip();
  }

  /** 일시정지 메뉴. */
  pause() {
    this.held = this.vids.filter((v) => !v.paused);
    for (const v of this.held) v.pause();
  }

  resume() {
    for (const v of this.held) void v.play().catch(() => {});
    this.held = [];
  }

  // ── 테이프(되감기) ─────────────────────────────────

  private async duration(file: string): Promise<number> {
    const hit = this.durs.get(file);
    if (hit) return hit;
    const v = document.createElement('video');
    v.preload = 'metadata';
    await new Promise<void>((res, rej) => {
      v.addEventListener('loadedmetadata', () => res(), { once: true });
      v.addEventListener('error', () => rej(new Error(`테이프를 못 읽었어요: ${file}`)), { once: true });
      v.src = url(file);
    });
    this.durs.set(file, v.duration);
    return v.duration;
  }

  /** 테이프 모드 시작: 녹화된 구간들을 이어 붙이고, 끝(=지금)에서부터 되감기 시작. */
  async tapeOpen(clips: string[]) {
    const segs = await Promise.all(clips.map(async (clip) => ({ clip, dur: await this.duration(clip) })));
    this.finishClip();
    const T: Tape = { segs, i: segs.length - 1, dir: -1, rate: REW_RATE, playing: true, lock: true };
    this.tape = T;
    try {
      await this.tapeRun(-1, REW_RATE, segs[T.i].dur, true);
    } finally {
      T.lock = false;
    }
  }

  tapeClose() {
    this.tape = null;
    for (const v of this.vids) v.pause();
  }

  /** 지금 구간 안에서의 위치(앞으로 파일 기준 초). */
  private local(T: Tape) {
    const t = this.fv.currentTime;
    return T.dir === 1 ? t : T.segs[T.i].dur - t;
  }

  /** 어느 구간의 몇 초인지. */
  tapeWhere(): { i: number; t: number } | null {
    return this.tape ? { i: this.tape.i, t: this.local(this.tape) } : null;
  }

  /** 테이프 전체에서의 위치(초). */
  tapePos(): number {
    const T = this.tape;
    if (!T) return 0;
    return T.segs.slice(0, T.i).reduce((s, x) => s + x.dur, 0) + this.local(T);
  }

  tapeTotal(): number {
    return this.tape?.segs.reduce((s, x) => s + x.dur, 0) ?? 0;
  }

  /**
   * 지금 구간의 t초부터 주어진 방향·속도로.
   * 방향이 바뀌면 반대 파일의 같은 순간(거꾸로 파일 위치 = 길이 − t)으로 갈아 끼워요.
   */
  private async tapeRun(dir: 1 | -1, rate: number, t: number, play: boolean) {
    const T = this.tape!;
    const seg = T.segs[T.i];
    const file = dir === 1 ? seg.clip : rev(seg.clip);
    const same = T.dir === dir && this.cur === this.fv && this.fv.dataset.file === file;
    if (!same) {
      const at = Math.min(Math.max(dir === 1 ? t : seg.dur - t, 0), seg.dur - FRAME);
      const v = this.bv;
      await this.ready(v, file, at);
      if (this.tape !== T) return; // 기다리는 사이 테이프 모드가 끝남
      v.loop = false;
      this.swap(v, { kind: 'cut' });
    }
    const v = this.fv;
    v.playbackRate = rate;
    T.dir = dir;
    T.rate = rate;
    T.playing = play;
    if (play) await v.play().catch(() => {});
    else v.pause();
  }

  /** 테이프 버튼. 바꾸는 중이라 못 받았으면 false. */
  async tapeSet(mode: TapeMode): Promise<boolean> {
    const T = this.tape;
    if (!T || T.lock) return false;
    T.lock = true;
    try {
      const t = this.local(T);
      if (mode === 'rew') await this.tapeRun(-1, REW_RATE, t, true);
      else if (mode === 'pause') await this.tapeRun(1, 1, t, false);
      else await this.tapeRun(1, mode === 'play' ? 1 : mode === 'slow' ? 0.25 : REW_RATE, t, true);
    } finally {
      T.lock = false;
    }
    return true;
  }

  /** 멈춘 채 한 프레임 앞으로. */
  async tapeStep() {
    const T = this.tape;
    if (!T || T.lock || T.playing || T.dir !== 1) return;
    const seg = T.segs[T.i];
    const v = this.fv;
    if (v.currentTime + FRAME < seg.dur - FRAME / 2) {
      v.currentTime += FRAME;
    } else if (T.i < T.segs.length - 1) {
      T.lock = true;
      T.i++;
      try {
        await this.tapeRun(1, 1, 0, false);
      } finally {
        T.lock = false;
      }
    }
  }

  /** 구간 끝에 닿았는지 확인해서 다음(이전) 구간으로 잇거나, 테이프 끝을 알려요. 자주 불러요. */
  tapeTick() {
    const T = this.tape;
    if (!T || T.lock || !T.playing || !this.fv.ended) return;
    T.lock = true;
    let edge: 'start' | 'end' | null = null;
    (async () => {
      if (T.dir === 1) {
        if (T.i < T.segs.length - 1) {
          T.i++;
          await this.tapeRun(1, T.rate, 0, true);
        } else edge = 'end';
      } else if (T.i > 0) {
        T.i--;
        await this.tapeRun(-1, T.rate, T.segs[T.i].dur, true);
      } else edge = 'start';
    })().finally(() => {
      T.lock = false;
      if (edge && this.tape === T) {
        T.playing = false;
        this.onTapeEdge(edge);
      }
    });
  }
}
