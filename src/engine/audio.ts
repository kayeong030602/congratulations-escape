/**
 * 소리 엔진 (Web Audio). 영상과 완전히 따로 돌아요.
 * 묶음(bus) 4개: amb 바탕음 / sfx 효과음 / voice 안내음성 / music 음악.
 * 브라우저 규칙상 첫 클릭 전에는 소리가 안 나요 → unlock()을 클릭 때마다 불러요.
 */
import type { Sound, SoundId } from '../data/schema.ts';
import { BASE } from './assets.ts';

type Bus = Sound['bus'];
/** (11/19 6단계 추가) pos·behind = 그 자리에서 나는 소리(입체 음향): 등 뒤일수록 먹먹하게 거르는 거르개 */
type Live = { src: AudioBufferSourceNode; gain: GainNode; bus: Bus; pos?: [number, number, number]; behind?: BiquadFilterNode };

export class AudioEngine {
  private ctx = new AudioContext();
  private bus: Record<Bus, GainNode>;
  /** (11/18 추가) 묶음마다 먹먹하게 만드는 거르개(평소엔 20kHz라 그대로 들려요). */
  private filt: Record<Bus, BiquadFilterNode>;
  private readonly level: Record<Bus, number> = { amb: 0.8, sfx: 1, voice: 1, music: 0.7 };
  private buf = new Map<SoundId, AudioBuffer>();
  private live = new Map<SoundId, Live>();
  private amb: SoundId | null = null;
  private menu = false;

  constructor(private defs: Record<SoundId, Sound>) {
    const filt = {} as Record<Bus, BiquadFilterNode>;
    const mk = (b: Bus) => {
      const g = this.ctx.createGain();
      g.gain.value = this.level[b];
      const f = (filt[b] = this.ctx.createBiquadFilter());
      f.type = 'lowpass';
      f.frequency.value = 20000;
      f.Q.value = 0.7;
      g.connect(f).connect(this.ctx.destination);
      return g;
    };
    this.bus = { amb: mk('amb'), sfx: mk('sfx'), voice: mk('voice'), music: mk('music') };
    this.filt = filt;
  }

  /**
   * (11/18 추가) 묶음 소리를 먹먹하고 작게. k = 0 그대로 ~ 1 물속처럼(높은 소리가 빠짐), level = 볼륨 배율.
   * 테이프를 볼 때(바탕음이 캠코더 스피커로 듣는 녹음처럼), 계단의 이상한 순간(험이 물속처럼 일그러짐)에 써요.
   */
  muffle(bus: Bus, k: number, level = 1, ms = 200) {
    const now = this.ctx.currentTime, end = now + ms / 1000;
    const f = this.filt[bus].frequency;
    f.cancelScheduledValues(now);
    f.setValueAtTime(f.value, now);
    f.exponentialRampToValueAtTime(20000 * Math.pow(700 / 20000, Math.max(0, Math.min(1, k))), end);
    const g = this.bus[bus].gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(this.level[bus] * level, end);
  }

  /** (11/18 추가) 코드로 만든 소리를 등록해요(테이프 감는 소리처럼 파일이 필요 없는 것). */
  define(id: SoundId, def: Omit<Sound, 'src'>, make: (ctx: BaseAudioContext) => AudioBuffer) {
    this.defs[id] = { src: '', ...def };
    if (!this.buf.has(id)) this.buf.set(id, make(this.ctx));
  }

  /** (11/18 추가) 틀고 있는 소리의 빠르기(음높이도 같이 바뀌어요). */
  rate(id: SoundId, r: number) {
    const e = this.live.get(id);
    if (e) e.src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.05);
  }

  /** (11/18 추가) 이 소리를 지금 틀고 있는가. */
  playing(id: SoundId): boolean { return this.live.has(id); }

  private primed = false;

  /**
   * 소리 켜기. 화면을 누르는 처리(클릭·손가락을 뗄 때) 안에서 불러야 해요.
   * (11/17 변경) 아이폰 사파리에서 소리가 안 나던 것 고침:
   *  - 손가락을 "대는" 순간(pointerdown)은 아이폰이 소리 허락으로 쳐 주지 않아요 → 부르는 쪽이 click·pointerup에서 불러요
   *  - 처음 한 번은 아주 짧은 무음을 틀어 소리 길을 확실히 열어요(옛 iOS 방식)
   *  - 무음(벨소리 끔) 스위치가 켜져 있어도 소리가 나게 "재생" 종류로 알려요(iOS 17+의 navigator.audioSession)
   *  - 전화·잠금 화면 뒤 멈춘(interrupted) 상태도 다시 켜요
   */
  unlock() {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    try { if (nav.audioSession && nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback'; } catch { /* 지원 안 하면 그냥 둬요 */ }
    if (this.menu) return;
    if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    if (!this.primed) {
      this.primed = true;
      const src = this.ctx.createBufferSource();
      src.buffer = this.ctx.createBuffer(1, 1, 22050);
      src.connect(this.ctx.destination);
      src.start(0);
    }
  }

  /**
   * (11/20 변경, 폰 점검) 와이파이가 불안할 때: 전엔 소리 하나만 못 받아도 방 전체가 "불러오지 못함"으로 멈췄어요.
   * 이제 두 번 더(0.7초·1.4초 뒤) 받아 보고, 그래도 안 되면 그 소리만 빼고 계속해요(틀 때 "준비 안 된 소리" 경고만).
   * 같은 소리를 동시에 두 번 받지 않아요(다음 방 미리 받기와 방 들어가기가 겹칠 때).
   */
  private loading = new Map<SoundId, Promise<void>>();

  async load(ids: Iterable<SoundId>) {
    await Promise.all(
      [...new Set(ids)].filter((id) => !this.buf.has(id)).map((id) => {
        const d = this.defs[id];
        if (!d) throw new Error(`소리 정의가 없어요: ${id}`);
        let p = this.loading.get(id);
        if (!p) {
          p = (async () => {
            for (let tryNo = 0; tryNo < 3; tryNo++) {
              try {
                if (tryNo) await new Promise((res) => setTimeout(res, 700 * tryNo));
                const r = await fetch(BASE + d.src);
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                this.buf.set(id, await this.ctx.decodeAudioData(await r.arrayBuffer()));
                return;
              } catch (e) {
                if (tryNo === 2) console.warn(`소리를 못 받았어요(빼고 계속): ${d.src}`, e);
              }
            }
          })().finally(() => this.loading.delete(id));
          this.loading.set(id, p);
        }
        return p;
      }),
    );
  }

  /** 소리 길이(초). 타이머·기다리기에 써요. */
  duration(id: SoundId): number {
    return this.buf.get(id)?.duration ?? 0;
  }

  /**
   * (11/19 6단계 추가) 듣는 사람(캠코더)의 자리와 바라보는 쪽. 매 프레임 불러요.
   * 입체 음향 소리는 브라우저의 머리 모양 계산(HRTF)으로 좌우·앞뒤를 내고, 거기에 더해 등 뒤에 있을수록 높은 소리를 걸러
   * 먹먹하게 해요(이어폰이 없거나 폰 스피커 하나여도 "돌아보면 또렷해짐"이 들리게 — 쉬운 방법을 같이 씀).
   */
  listen(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    this.ear = [x, y, z, fx, fz];
    const L = this.ctx.listener as AudioListener & { positionX?: AudioParam };
    const t = this.ctx.currentTime;
    try {
      if (L.positionX) {
        L.positionX.setTargetAtTime(x, t, 0.02); L.positionY!.setTargetAtTime(y, t, 0.02); L.positionZ!.setTargetAtTime(z, t, 0.02);
        L.forwardX!.setTargetAtTime(fx, t, 0.02); L.forwardY!.setTargetAtTime(fy, t, 0.02); L.forwardZ!.setTargetAtTime(fz, t, 0.02);
        L.upX!.value = 0; L.upY!.value = 1; L.upZ!.value = 0;
      } else {
        L.setPosition(x, y, z);
        L.setOrientation(fx, fy, fz, 0, 1, 0);
      }
    } catch { /* 옛 브라우저 */ }
    for (const e of this.live.values()) if (e.behind && e.pos) e.behind.frequency.setTargetAtTime(this.behindHz(e.pos), t, 0.05);
  }

  private ear: [number, number, number, number, number] = [0, 1.5, 0, 0, -1];

  /** 소리가 등 뒤일수록 낮은 거르개 값(앞 = 18kHz 그대로, 바로 뒤 = 900Hz). */
  private behindHz(p: [number, number, number]): number {
    const [x, , z, fx, fz] = this.ear;
    const dx = p[0] - x, dz = p[2] - z, d = Math.hypot(dx, dz) || 1, f = Math.hypot(fx, fz) || 1;
    const front = (dx * fx + dz * fz) / (d * f); // 1 = 앞, -1 = 뒤
    const back = Math.max(0, Math.min(1, (0.25 - front) / 1.1));
    return 18000 * Math.pow(900 / 18000, back);
  }

  play(id: SoundId, fadeInMs = 0, at?: [number, number, number]): { duration: number } {
    const d = this.defs[id];
    const b = this.buf.get(id);
    if (!d || !b) {
      console.warn(`[audio] 준비 안 된 소리: ${id}`);
      return { duration: 0 };
    }
    this.stop(id);
    const src = this.ctx.createBufferSource();
    src.buffer = b;
    src.loop = !!d.loop;
    const gain = this.ctx.createGain();
    const vol = d.gain ?? 1;
    const now = this.ctx.currentTime;
    if (fadeInMs) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + fadeInMs / 1000);
    } else gain.gain.value = vol;
    let behind: BiquadFilterNode | undefined;
    if (at) {
      // (11/19 6단계 추가) 입체 음향: 거르개(등 뒤일수록 먹먹) → 머리 모양 계산(HRTF, 좌우·앞뒤·거리)
      behind = this.ctx.createBiquadFilter();
      behind.type = 'lowpass';
      behind.Q.value = 0.5;
      behind.frequency.value = this.behindHz(at);
      const pan = this.ctx.createPanner();
      try { pan.panningModel = 'HRTF'; } catch { /* 지원 안 하면 기본(좌우만) */ }
      pan.distanceModel = 'inverse';
      pan.refDistance = 1.6;
      pan.rolloffFactor = 1.1;
      try {
        if (pan.positionX) { pan.positionX.value = at[0]; pan.positionY.value = at[1]; pan.positionZ.value = at[2]; }
        else pan.setPosition(at[0], at[1], at[2]);
      } catch { /* 옛 브라우저 */ }
      src.connect(gain).connect(behind).connect(pan).connect(this.bus[d.bus]);
    } else src.connect(gain).connect(this.bus[d.bus]);
    src.start();
    const entry: Live = { src, gain, bus: d.bus, pos: at, behind };
    this.live.set(id, entry);
    src.onended = () => {
      if (this.live.get(id) === entry) this.live.delete(id);
    };
    return { duration: b.duration };
  }

  /** (11/19 추가) slow = 테이프가 늘어지듯 음이 낮아지며 느려지다 멈춰요(fadeMs 동안 — 따뜻한 방을 풀 때 음악·웃음소리). */
  stop(id: SoundId, fadeMs = 0, slow = false) {
    const e = this.live.get(id);
    if (!e) return;
    this.live.delete(id);
    const now = this.ctx.currentTime;
    if (slow && fadeMs) {
      const end = now + fadeMs / 1000;
      const r = e.src.playbackRate;
      r.cancelScheduledValues(now);
      r.setValueAtTime(r.value, now);
      r.exponentialRampToValueAtTime(0.14, end);
      const g = e.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.setValueAtTime(g.value, now + (fadeMs / 1000) * 0.4); // 앞부분은 크기 그대로 늘어지다가
      g.linearRampToValueAtTime(0, end);
      e.src.stop(end + 0.02);
    } else if (fadeMs) {
      e.gain.gain.setValueAtTime(e.gain.gain.value, now);
      e.gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      e.src.stop(now + fadeMs / 1000 + 0.02);
    } else e.src.stop();
  }

  stopBus(bus: Bus, fadeMs = 0) {
    for (const [id, e] of this.live) if (e.bus === bus) this.stop(id, fadeMs);
  }

  /** 방 바탕음 바꾸기. 같은 소리면 끊지 않고 그대로 이어요. */
  setAmb(id: SoundId | undefined) {
    if ((id ?? null) === this.amb) return;
    if (this.amb) this.stop(this.amb, 800);
    this.amb = id ?? null;
    if (id) this.play(id, 800);
  }

  /** 일시정지 메뉴: 모든 소리의 시간이 멈춰요. */
  suspend() {
    this.menu = true;
    void this.ctx.suspend();
  }

  resume() {
    this.menu = false;
    void this.ctx.resume();
  }
}
