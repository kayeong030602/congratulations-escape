/**
 * 카메라 기록 장치 — 되감기(R3 "내가 찍은 테이프")의 바탕.
 *
 * 1초에 15번 "시간·위치·시선·줌"을 적고, 세계가 바뀐 순간(플래그 등)도 시간과 함께 적어요.
 * 이것만 있으면 테이프의 어느 시각이든 그때의 카메라와 세계 상태를 되살려 다시 그릴 수 있어요(tape.ts).
 * 30분을 찍어도 약 0.6MB예요.
 *
 * (11/18 변경) 되감기 단계에서 고친 것
 *  - 시계를 하나로: 카메라도 사건도 "녹화한 시간"(구간 시작부터, 초)으로 찍어요. 전엔 카메라는 걸을 수 있을 때만,
 *    사건은 게임 시계로 찍혀서 연출(떼어 뒤집기 등)이 끼면 둘이 어긋났어요.
 *    녹화한 시간은 걷는 중·연출 중·누르고 있는 중에 흐르고, 테이프를 보는 동안·멈춤 화면에선 멈춰요(main.ts가 tick을 안 불러요).
 *  - 구간 시작 상태를 저장과 같은 모양(Snapshot)으로: 플래그·개수·가방·메모·한 번만 반응한 것.
 *  - 순간이동(같은 방 안의 warp, 계단 루프)은 두 기록 사이를 이어 그리지 않아요(한 번에 0.75m 넘게 움직이면 끊어진 것으로 봄).
 */
import type { RoomId } from './schema.ts';
import type { Snapshot, StateEvent } from './state.ts';

const HZ = 15;
const N = 7; // 한 번에 적는 숫자: 시간, x, z, 좌우 시선, 위아래 시선, 줌, (11/20 추가) 발 높이(계단)
const MAX_SEC = 30 * 60; // 테이프 길이 한도. 넘으면 가장 오래된 구간부터 지워요
/** 두 기록 사이에 이만큼 넘게 움직였으면 순간이동 → 이어 그리지 않아요(뛰어도 1/15초에 0.2m가 안 돼요). */
const CUT = 0.75;
/** (11/20 추가) 기록 i → j 사이가 순간이동인가: 바닥 위로든 높이로든(계단 루프 — 꼭대기에서 시작 칸으로) CUT 넘게 움직였으면. */
function jump(s: Segment, i: number, j: number): boolean {
  const a = i * N, b = j * N;
  return Math.hypot(s.poses[b + 1] - s.poses[a + 1], s.poses[b + 2] - s.poses[a + 2], s.poses[b + 6] - s.poses[a + 6]) > CUT;
}

/** 그 순간의 카메라. (11/20 추가) y = 발 높이(계단을 오르면 달라져요) */
export interface Pose { x: number; z: number; yaw: number; pitch: number; zoom: number; y: number }

/** 테이프에 찍힌 사건(at = 구간 시작부터 녹화한 시간, 초). */
export type TapeEvent = Omit<StateEvent, 't'> & { at: number };

/** 방에 한 번 들어가서 나올 때까지(또는 실패해서 다시 시작할 때까지)의 한 구간. */
export interface Segment {
  room: RoomId;
  /** 구간이 시작될 때의 진행 상태. */
  init: Snapshot;
  /** 녹화한 길이(초). */
  len: number;
  /** 적힌 횟수. */
  n: number;
  /** [시간(초, 구간 시작부터), x, z, yaw, pitch, zoom, 발 높이] × n */
  poses: Float32Array;
  events: TapeEvent[];
}

export class Recorder {
  segments: Segment[] = [];
  private acc = 0;

  /** 지금 찍고 있는 구간(되감기는 이 구간의 처음까지만 — 지금 방의 처음까지). */
  get current(): Segment | null { return this.segments.at(-1) ?? null; }

  /** 방에 들어섰을 때(실패해서 다시 시작할 때도) 새 구간을 시작해요. */
  begin(room: RoomId, init: Snapshot) {
    this.segments.push({ room, init, len: 0, n: 0, poses: new Float32Array(N * HZ * 60), events: [] });
    this.acc = 1 / HZ; // 첫 프레임을 바로 적어요
    while (this.seconds > MAX_SEC && this.segments.length > 1) this.segments.shift();
  }

  /** 녹화 중인 매 프레임 불러요(테이프를 보는 동안·멈춤 중엔 안 불러요). 1/15초마다 한 번씩만 적어요. */
  tick(dt: number, p: Pose) {
    const s = this.current;
    if (!s) return;
    s.len += dt;
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    this.acc %= 1 / HZ;
    if ((s.n + 1) * N > s.poses.length) {
      const bigger = new Float32Array(s.poses.length * 2);
      bigger.set(s.poses);
      s.poses = bigger;
    }
    s.poses.set([s.len, p.x, p.z, p.yaw, p.pitch, p.zoom, p.y], s.n * N);
    s.n++;
  }

  /** 세계가 바뀐 순간을 적어요(지금까지 녹화한 시간으로). */
  event(e: StateEvent) {
    const s = this.current;
    if (!s) return;
    const { t: _t, ...rest } = e;
    s.events.push({ ...rest, at: s.len });
  }

  /** 지금까지 찍힌 길이(초). */
  get seconds(): number {
    return this.segments.reduce((sum, s) => sum + s.len, 0);
  }

  /** 구간 안의 시각 t(초)의 카메라. 적힌 두 순간 사이는 부드럽게 이어요(순간이동한 곳은 끊어서). */
  static poseAt(s: Segment, t: number): Pose | null {
    if (!s.n) return null;
    let lo = 0, hi = s.n - 1;
    if (t <= s.poses[0]) hi = 0;
    else {
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (s.poses[mid * N] <= t) lo = mid;
        else hi = mid;
      }
    }
    const a = lo * N, b = hi * N;
    const ta = s.poses[a], tb = s.poses[b];
    let k = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0;
    if (jump(s, lo, hi)) k = k < 1 ? 0 : 1;
    const mix = (i: number) => s.poses[a + i] + (s.poses[b + i] - s.poses[a + i]) * k;
    return { x: mix(1), z: mix(2), yaw: mix(3), pitch: mix(4), zoom: mix(5), y: mix(6) };
  }

  /**
   * 구간의 걸은 거리 누적(기록마다, 미터). 테이프에서 걸음 출렁임을 다시 입힐 때 써요.
   * 순간이동은 빼요.
   */
  static walked(s: Segment): Float32Array {
    const out = new Float32Array(s.n);
    for (let i = 1; i < s.n; i++) {
      const d = Math.hypot(s.poses[i * N + 1] - s.poses[(i - 1) * N + 1], s.poses[i * N + 2] - s.poses[(i - 1) * N + 2]);
      out[i] = out[i - 1] + (jump(s, i - 1, i) ? 0 : d);
    }
    return out;
  }

  /** 기록 i번째의 시각(초). */
  static timeAt(s: Segment, i: number): number { return s.poses[i * N]; }

  /** (11/18 추가) t0~t1 사이에 순간이동(끊긴 곳)이 있는가. 빨리 감을 때 카메라를 고르게 펴면서 순간이동 자리는 섞지 않게. */
  static hasCut(s: Segment, t0: number, t1: number): boolean {
    return Recorder.cutTime(s, t0, t1) !== null;
  }

  /** (11/18 추가) t0~t1 사이의 첫 순간이동: 새 자리가 처음 적힌 시각(없으면 null). 테이프의 어두워짐을 이 순간에 맞춰요. */
  static cutTime(s: Segment, t0: number, t1: number): number | null {
    for (let i = 1; i < s.n; i++) {
      const t = s.poses[i * N];
      if (t < t0) continue;
      if (s.poses[(i - 1) * N] > t1) break;
      if (jump(s, i - 1, i)) return t;
    }
    return null;
  }
}
