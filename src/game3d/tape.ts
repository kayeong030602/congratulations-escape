/**
 * (11/18 추가) 테이프 재생기 — 되감기(R3 "내가 찍은 테이프").
 *
 * 기록 장치(recorder.ts)의 지금 구간(= 지금 방의 처음부터)을 읽어, 재생 위치(head)의
 *   - 카메라(그때 내가 서 있던 자리·시선·줌, 걸음 출렁임)
 *   - "그 시각의 모습"(구간 시작 상태 + 그때까지의 사건 → Ghost) — 화면에만 써요. 진짜 게임 상태는 안 건드려요
 *   - 세계 연출(정전, 떼어 든 종이, 끼어든 실사 영상)
 * 을 내줘요. 테이프 버튼 상태는 engine/machine.ts의 표(TRANSPORT) 그대로예요.
 *
 *   ◀◀ rew  : 3배로 시작해 2.5초에 걸쳐 10배까지 빨라져요(짧게 감을 땐 정확하게, 길게 감을 땐 금방)
 *   ▶ play  : 1배    ▶ slow : 0.25배    ❚❚ pause : 멈춤(한 장씩 넘기기)    ▶▶ ff : rew와 같은 빠르기로 앞으로
 *   맨 앞에 닿으면 멈춤, 앞으로 가다 끝(=지금)에 닿으면 녹화 화면으로(main.ts).
 */
import { TRANSPORT, next, type Transport, type TransportEvent } from '../engine/machine.ts';
import { Recorder, type Pose, type Segment } from './recorder.ts';
import type { Cond } from './schema.ts';
import { Ghost } from './state.ts';

const BASE: Record<Transport, number> = { rew: -3, play: 1, slow: 0.25, pause: 0, ff: 3 };
const FAST = { max: 10, ramp: 2.5 };
/** 멈춤에서 한 장 = 기록 한 번(1/15초). */
const FRAME = 1 / 15;

/** 재생 위치의 모습(세계가 그리는 데 써요). since = 그 사건부터 흐른 테이프 시간(초). */
export interface TapeView {
  /** 재생 위치와 길이(초). */
  t: number;
  len: number;
  transport: Transport;
  /** 지금 빠르기(배, 거꾸로면 -). */
  speed: number;
  pose: Pose;
  /** 걸은 거리(미터)와 걷는 정도(0~1) — 걸음 출렁임. */
  walked: number;
  moving: number;
  /** 그 시각의 상태로 조건 검사. */
  test: (c: Cond) => boolean;
  light: { fx: 'flicker' | 'off' | 'on'; since: number } | null;
  /** 떼어 든 종이: 뗀 뒤 흐른 시간, 뒤집은 뒤 흐른 시간(아직이면 null). */
  picks: Map<string, { pick: number; flip: number | null }>;
  /** 끼어든 실사 영상과 그 영상 안의 시각. */
  insert: { file: string; t: number } | null;
  /** (11/18 추가) 손떨림·걸음 출렁임 세기 배율. 빨리 감을수록 약하게(사용자 의견: 되감을 때 흔들려서 멀미남). */
  calm: number;
  /**
   * (11/18 추가) 같은 방 안의 순간이동(warp): 방법, 시작부터 흐른 시간, 끝난 뒤 흐른 시간(아직이면 null),
   * 자리가 바뀐 순간부터 흐른 시간(cut, 그 전이면 -). 테이프에서도 바뀌는 순간에 가장 어둡게 어두워졌다 밝아져요
   */
  warp: { via: string; since: number; after: number | null; cut: number | null } | null;
}

export class TapePlayer {
  seg: Segment | null = null;
  head = 0;
  transport: Transport = 'rew';
  private held = 0; // 지금 ◀◀·▶▶를 이어 온 시간(빨라지기)
  private walk: Float32Array | null = null;

  get active(): boolean { return !!this.seg; }
  get len(): number { return this.seg?.len ?? 0; }

  /** 지금 구간의 끝(=지금)에서 ◀◀로 시작해요. */
  start(seg: Segment) {
    this.seg = seg;
    this.head = seg.len;
    this.transport = 'rew';
    this.held = 0;
    this.walk = Recorder.walked(seg);
  }

  stop() {
    this.seg = null;
    this.walk = null;
  }

  /** 테이프 버튼. 표에 없는 조합은 무시돼요. */
  press(ev: TransportEvent) {
    const t = next(TRANSPORT, this.transport, ev);
    if (t === this.transport) return;
    this.transport = t;
    this.held = 0;
  }

  /** 멈춘 채 한 장씩(앞 +1 / 뒤 -1). */
  step(dir: 1 | -1) {
    if (this.transport !== 'pause') return;
    if (dir > 0) this.press('STEP');
    this.head = Math.max(0, Math.min(this.len, this.head + dir * FRAME));
  }

  get speed(): number {
    const b = BASE[this.transport];
    if (this.transport !== 'rew' && this.transport !== 'ff') return b;
    const k = Math.min(1, this.held / FAST.ramp);
    return Math.sign(b) * (Math.abs(b) + (FAST.max - Math.abs(b)) * k * k);
  }

  /** 재생 위치를 흘려요. 'end' = 앞으로 가다 끝(=지금)에 닿음 → 녹화 화면으로. */
  tick(dt: number): 'end' | null {
    if (!this.seg) return null;
    if (this.transport === 'rew' || this.transport === 'ff') this.held += dt;
    const v = this.speed;
    this.head += v * dt;
    if (this.head <= 0) {
      this.head = 0;
      if (this.transport === 'rew') this.press('HIT_START');
    }
    if (this.head >= this.len) {
      this.head = this.len;
      if (v > 0) return 'end';
    }
    return null;
  }

  /** 재생 위치의 모습. 사건이 수십 개라 매 프레임 처음부터 다시 세도 0.01ms 수준이에요. */
  view(): TapeView | null {
    const s = this.seg;
    if (!s || !s.n) return null;
    const h = this.head;
    const ghost = new Ghost(s.init);
    let light: TapeView['light'] = null;
    let insert: TapeView['insert'] = null;
    let warp: TapeView['warp'] = null;
    const picks: TapeView['picks'] = new Map();
    for (const e of s.events) {
      if (e.at > h) break; // 사건은 시간 순서로 쌓여요
      ghost.apply(e);
      if (e.kind !== 'act' || !e.arg) continue;
      const since = h - e.at;
      if (e.id === 'light') light = { fx: e.arg as 'flicker' | 'off' | 'on', since };
      else if (e.id === 'pick') picks.set(e.arg, { pick: since, flip: null });
      else if (e.id === 'flip') { const p = picks.get(e.arg); if (p) p.flip = since; }
      else if (e.id === 'clip') insert = { file: e.arg, t: since };
      else if (e.id === 'clip-end') insert = null;
      else if (e.id === 'warp') {
        const tc = Recorder.cutTime(s, e.at, e.at + 1.5); // 기록상 자리가 바뀐 순간(이벤트보다 조금 늦어요)
        warp = { via: e.arg, since, after: null, cut: tc === null ? null : h - tc };
      }
      else if (e.id === 'warp-end' && warp) warp.after = since;
    }
    if (warp && warp.after !== null && warp.after > 1) warp = null;

    // 걸은 거리와 걷는 정도: 앞뒤 0.2초쯤의 기록으로
    let lo = 0, hi = s.n - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (Recorder.timeAt(s, mid) <= h) lo = mid;
      else hi = mid;
    }
    const w = this.walk!;
    const ta = Recorder.timeAt(s, lo), tb = Recorder.timeAt(s, hi);
    const k = tb > ta ? Math.max(0, Math.min(1, (h - ta) / (tb - ta))) : 0;
    const walked = w[lo] + (w[hi] - w[lo]) * k;
    const i0 = Math.max(0, lo - 2), i1 = Math.min(s.n - 1, lo + 3);
    const span = Recorder.timeAt(s, i1) - Recorder.timeAt(s, i0);
    const pace = span > 0 ? (w[i1] - w[i0]) / span : 0;
    const moving = Math.max(0, Math.min(1, (pace - 0.15) / 0.5));

    // (11/18 추가) 빨리 감을 때는 카메라를 앞뒤로 고르게 펴요(손이 살짝 떨린 것까지 빨라져 어지럽지 않게). 순간이동한 자리는 섞지 않아요
    const sp = Math.abs(this.speed);
    let pose = Recorder.poseAt(s, h)!;
    if (sp > 1.5) {
      const w = Math.min(0.5, 0.045 * sp);
      const t0 = Math.max(0, h - w), t1 = Math.min(this.len, h + w);
      if (!Recorder.hasCut(s, t0, t1)) {
        const ps = [t0, (t0 + h) / 2, h, (h + t1) / 2, t1].map((t) => Recorder.poseAt(s, t)!);
        const avg = (k: keyof typeof pose) => ps.reduce((a, p) => a + p[k], 0) / ps.length;
        pose = { x: avg('x'), z: avg('z'), yaw: avg('yaw'), pitch: avg('pitch'), zoom: avg('zoom'), y: avg('y') }; // (11/20) 발 높이도(계단)
      }
    }

    return {
      t: h, len: this.len, transport: this.transport, speed: this.speed,
      pose, walked, moving,
      test: ghost.test, light, picks, insert,
      calm: 1 / Math.max(1, sp), warp,
    };
  }
}
