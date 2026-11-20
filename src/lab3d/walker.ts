/**
 * 걷는 몸 — 이동, 벽 충돌, 시선, 캠코더 흔들림.
 *
 * 충돌은 "평면도 방식": 나를 위에서 본 원으로, 벽을 네모로 보고 원이 네모에 못 들어가게 밀어내요.
 * 비스듬히 부딪히면 벽을 따라 미끄러져요. 물리 엔진은 쓰지 않아요.
 *
 * (11/20 추가, 본 게임 6단계 계단참) 바닥 높이: 밟는 상자(Box.walk — 계단 한 칸·계단참)의 윗면이 바닥이에요.
 *   - 발 높이에서 STEP(45cm)까지 높은 윗면은 밟고 올라가고, 그보다 높은 밟는 상자는 벽처럼 막아요.
 *   - 계단 칸마다 툭툭 오르지 않게 앞뒤 세 점의 바닥을 고르게 펴고(경사로처럼), 카메라는 그 높이를 0.1초쯤에 걸쳐 따라가요.
 *   - 충돌 네모는 높이도 봐요: 지금 발 높이에서 몸(발 위 10cm~1.6m)에 걸리는 상자만 막아요(전엔 바닥 0 기준으로 미리 골라 뒀어요 —
 *     발 높이 0이면 같은 결과라 다른 방은 그대로예요). 밟는 상자가 없는 방은 바닥이 늘 0이에요.
 *   - 계단을 오르내리는 동안은 천천히(STAIR_PACE — 평지의 0.65배).
 */
import type * as THREE from 'three';
import type { Rect } from './build.ts';

const RADIUS = 0.28;   // 몸 반지름(미터)
const EYE = 1.5;       // 캠코더 높이
const SPEED = 1.35;    // 걷는 속도(초당 미터)
const RUN = 1.9;       // 뛸 때는 걷는 속도의 몇 배(약 초당 2.6미터)
const STRIDE = 0.72;   // 한 걸음 길이
const PITCH_MAX = 1.2; // 위아래 시선 한계(약 70도)
// (11/20 추가) 계단
const STEP = 0.45;       // 발 높이에서 이만큼 높은 윗면까지는 밟고 올라가요(계단 한 칸 17.5cm)
const BODY = 1.6;        // 발에서 이 높이까지 걸리는 상자가 몸을 막아요
const SOLE = 0.1;        // 발밑 10cm는 안 걸려요(걸레받이 같은 것)
const FLOOR_T = 0.1;     // 바닥 높이를 따라가는 시간(초)
const FLOOR_PROBE = 0.14; // 바닥을 앞뒤로 재는 거리(미터) — 칸의 턱을 고르게 펴요
const STAIR_PACE = 0.65; // 계단을 오르내릴 때 걷는 빠르기 배율 (11/20 2차, 사용자 의견: 너무 빠름 0.82 → 0.65)

export class Walker {
  x = 0; z = 0;
  /** (11/20 추가) 발 높이(바닥, 부드럽게 따라감). 카메라 높이 = 발 + 1.5m */
  y = 0;
  yaw = 0; pitch = 0;
  /** 흔들림 세기(0이면 끔). 멀미가 나면 줄여요. */
  shake = 1;
  private vx = 0; private vz = 0;
  /** (11/17 추가) 지금 움직이는 빠르기와 방향(초당 미터, 바닥 위 x·z). 본 게임이 "벽 쪽으로 걸어 들어가는 중인가"를 볼 때 써요. */
  get vel(): [number, number] { return [this.vx, this.vz]; }
  private walked = 0;   // 걸은 거리(걸음 출렁임에 씀)
  private moving = 0;   // 0~1, 걷는 중일수록 1
  private pace = 0;     // 0~1, 뛰는 중일수록 1
  private yT = 0;       // (11/20) 따라갈 바닥 높이
  private climb = 0;    // (11/20) 0~1, 계단을 오르내리는 중일수록 1

  constructor(private rects: Rect[]) {}

  /** 방이 바뀌면 벽(충돌 네모)을 갈아 끼워요. */
  setRects(rects: Rect[]) { this.rects = rects; }

  /** (11/20 변경) y = 발 높이의 기준(서는 자리의 높이). 그 높이에서 밟을 수 있는 가장 높은 바닥에 바로 서요(따라가지 않고). */
  place(x: number, z: number, yawDeg = 0, pitchDeg = 0, y?: number) {
    this.x = x; this.z = z;
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    this.vx = this.vz = 0;
    const ref = y ?? this.y;
    this.y = this.yT = this.floorAt(x, z, ref) ?? ref;
    this.climb = 0;
  }

  /**
   * (11/19 6단계 추가) 연출로 몸을 옮겨요(본 게임의 walk 행동 — 문을 열고 뛰어들어 돌아서기). 걸음 출렁임은 이어져요.
   * 각도는 라디안. (11/20) 바닥 높이는 다음 update가 따라가요.
   */
  glide(x: number, z: number, yaw: number, pitch: number) {
    const moved = Math.hypot(x - this.x, z - this.z);
    this.x = x; this.z = z; this.yaw = yaw; this.pitch = pitch;
    this.vx = this.vz = 0;
    this.walked += moved;
    this.moving = Math.max(this.moving, Math.min(1, moved * 40));
    this.pace = 0.6;
  }

  /** (11/20 7단계 추가) 연출로 발 높이를 바로 정해요(바닥 없는 하얀 공간으로 떨어짐) — 바닥을 따라가지 않게 따라갈 높이도 같이 */
  drop(y: number) { this.y = this.yT = y; }

  turn(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, this.pitch - dy));
  }

  /** fwd: 앞(+1)/뒤(-1), side: 오른쪽(+1)/왼쪽(-1), run: 뛰기. */
  update(dt: number, fwd: number, side: number, run = false) {
    const len = Math.hypot(fwd, side);
    if (len > 1) { fwd /= len; side /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const speed = SPEED * (run ? RUN : 1) * (1 - (1 - STAIR_PACE) * this.climb);
    this.pace += ((run && len > 0.1 ? 1 : 0) - this.pace) * Math.min(1, dt * 5);
    // 앞 = (-sin, -cos), 오른쪽 = (cos, -sin)
    const tx = (-sin * fwd + cos * side) * speed;
    const tz = (-cos * fwd - sin * side) * speed;
    const k = Math.min(1, dt * 9); // 살짝 미끄러지듯 출발·멈춤
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;

    const px = this.x, pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.collide();
    const moved = Math.hypot(this.x - px, this.z - pz);
    this.walked += moved;
    this.moving += ((moved / dt > 0.3 ? 1 : 0) - this.moving) * Math.min(1, dt * 6);

    // (11/20 추가) 바닥 높이: 앞뒤 세 점을 고르게 펴서(움직이는 쪽으로) 따라가요
    this.yT = this.sampleFloor();
    if (dt > 0) {
      this.y += (this.yT - this.y) * (1 - Math.exp(-dt / FLOOR_T));
      if (Math.abs(this.yT - this.y) < 1e-4) this.y = this.yT;
    }
    this.climb += ((Math.abs(this.yT - this.y) > 0.015 ? 1 : 0) - this.climb) * Math.min(1, dt * 5);
  }

  /** (11/20 추가) (x, z)에서 ref 높이의 발이 밟을 수 있는 가장 높은 바닥(밟는 상자 윗면). 없으면 null. */
  private floorAt(x: number, z: number, ref: number): number | null {
    let best: number | null = null;
    for (const r of this.rects) {
      if (!r.walk || x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1 || r.y1 > ref + STEP) continue;
      if (best === null || r.y1 > best) best = r.y1;
    }
    return best;
  }

  /** (11/20 추가) 따라갈 바닥: 서 있는 자리와 움직이는 쪽 앞뒤 FLOOR_PROBE의 바닥을 고르게. 밟는 상자가 없으면 지금 높이 그대로. */
  private sampleFloor(): number {
    const ref = Math.max(this.y, this.yT);
    const sp = Math.hypot(this.vx, this.vz);
    const pts: [number, number][] = [[this.x, this.z]];
    if (sp > 0.05) {
      const ux = (this.vx / sp) * FLOOR_PROBE, uz = (this.vz / sp) * FLOOR_PROBE;
      pts.push([this.x + ux, this.z + uz], [this.x - ux, this.z - uz]);
    }
    let sum = 0, n = 0;
    for (const [x, z] of pts) {
      const f = this.floorAt(x, z, ref);
      if (f !== null) { sum += f; n++; }
    }
    return n ? sum / n : this.yT;
  }

  private collide() {
    // (11/20 변경) 지금 발 높이에서 몸에 걸리는 상자만: 단단한 상자는 발 위 10cm~1.6m에 걸치면, 밟는 상자는 너무 높아 못 밟으면
    const ref = Math.max(this.y, this.yT);
    for (let pass = 0; pass < 3; pass++) {
      for (const r of this.rects) {
        if (r.walk ? !(r.y1 > ref + STEP && r.y0 < ref + BODY) : !(r.y0 < ref + BODY && r.y1 > ref + SOLE)) continue;
        const cx = Math.max(r.x0, Math.min(r.x1, this.x));
        const cz = Math.max(r.z0, Math.min(r.z1, this.z));
        const dx = this.x - cx, dz = this.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= RADIUS * RADIUS) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          this.x = cx + (dx / d) * RADIUS;
          this.z = cz + (dz / d) * RADIUS;
        } else {
          // 벽 속에 들어가 버린 경우: 가장 가까운 면으로 밀어내요
          const l = this.x - r.x0, rr = r.x1 - this.x, t = this.z - r.z0, b = r.z1 - this.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) this.x = r.x0 - RADIUS;
          else if (m === rr) this.x = r.x1 + RADIUS;
          else if (m === t) this.z = r.z0 - RADIUS;
          else this.z = r.z1 + RADIUS;
        }
      }
    }
  }

  /** 카메라에 자세를 적용해요. 걸음 출렁임과 손떨림이 여기서 들어가요. */
  apply(cam: THREE.PerspectiveCamera, time: number) {
    Walker.pose(cam, { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, walked: this.walked, moving: this.moving, pace: this.pace }, time, this.shake);
  }

  /**
   * (11/18 추가) 자세 → 카메라. 본 게임의 되감기 테이프도 기록된 자세로 이걸 불러서, 걸음 출렁임·손떨림이 라이브와 똑같아요.
   * (식은 그대로 옮겼어요 — 사용자가 "딱 좋음"으로 확인한 세기)
   * (11/20 추가) y = 발 높이(계단) — 없으면 0
   */
  static pose(
    cam: THREE.PerspectiveCamera,
    p: { x: number; y?: number; z: number; yaw: number; pitch: number; walked: number; moving: number; pace: number },
    time: number,
    s: number,
  ) {
    const step = (p.walked / STRIDE) * Math.PI * 2;
    const hard = 1 + p.pace * 0.7; // 뛰면 더 출렁여요(걷기 값은 그대로)
    const bobY = Math.sin(step) * 0.02 * p.moving * s * hard;
    const bobRoll = Math.sin(step / 2) * 0.007 * p.moving * s * hard;
    // 손떨림: 서로 다른 빠르기의 물결을 겹쳐서 불규칙하게
    const hx = (Math.sin(time * 1.31) + Math.sin(time * 2.87 + 1.3) * 0.5 + Math.sin(time * 6.9 + 0.4) * 0.14) * 0.0038 * s;
    const hy = (Math.sin(time * 1.07 + 2.1) + Math.sin(time * 3.31) * 0.5 + Math.sin(time * 7.7 + 1.9) * 0.14) * 0.0045 * s;
    const hr = Math.sin(time * 0.83 + 0.7) * 0.004 * s;
    cam.position.set(p.x, (p.y ?? 0) + EYE + bobY, p.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(p.pitch + hx, p.yaw + hy, hr + bobRoll);
  }
}
