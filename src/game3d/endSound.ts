/**
 * (11/20 7단계 추가) 엔딩 타자음을 코드로 만들어요(소리 파일·다운로드·비용 없음).
 * 영화 엔딩(build_ending_e3_v2.py)의 타자음과 같은 방식: 비트를 깎은 8비트 네모파 "삑" + 짧은 딸깍.
 *   type.0~5   = 글자 하나(음 높이·모양이 조금씩 다름)
 *   type.space = 빈칸(딸깍만)
 *   type.done  = 한 줄 끝(올라가는 두 음)
 *   type.clear = 글씨를 지울 때(내려가는 휙 + 짧은 지지직)
 */
import type { AudioEngine } from '../engine/audio.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** 8비트 삑: f0에서 시작(kind: tone 그대로 / arp 반쯤에서 한 칸 뜀 / sweep 미끄러짐), 비트 깎기 */
function blip(sr: number, f0: number, dur: number, kind: 'tone' | 'arp' | 'sweep', up: number): Float32Array {
  const n = Math.round(sr * dur), out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = kind === 'arp' ? (t < dur / 2 ? f0 : f0 * up) : kind === 'sweep' ? f0 * Math.pow(up, t / dur) : f0;
    ph += (2 * Math.PI * f) / sr;
    const sq = Math.sign(Math.sin(ph)) * 0.6 + 0.4 * Math.sin(ph);
    const env = Math.min(1, t / 0.002) * Math.exp(-t / (dur * 0.55));
    out[i] = Math.round(sq * env * 32) / 32;
  }
  return out;
}

/** 딸깍: 높은 잡음을 아주 짧게 */
function tick(sr: number, seed: number): Float32Array {
  const n = Math.round(sr * 0.008), out = new Float32Array(n), r = rng(seed);
  let lp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    lp += (r() - lp) * 0.6;
    const hi = lp - prev; prev = lp;
    out[i] = hi * Math.exp(-i / sr / 0.0018);
  }
  return out;
}

/**
 * (11/20 추가, 폰 점검 뒤 사용자 의견: 타자음이 빨라서 경박하고 귀가 아픔 → 고음을 깎아 먹먹하게)
 * 높은 소리 거르개(2.4kHz, 두 번 겹쳐 가파르게): 네모파의 날카로운 배음만 깎이고 음 높이(880~1760Hz)는 그대로 들려요.
 */
const LOWPASS_HZ = 2400;
function lowpass(d: Float32Array, sr: number, hz: number) {
  const w = (2 * Math.PI * hz) / sr, a = Math.sin(w) / (2 * Math.SQRT1_2), c = Math.cos(w);
  const b0 = (1 - c) / 2 / (1 + a), b1 = (1 - c) / (1 + a), a1 = (-2 * c) / (1 + a), a2 = (1 - a) / (1 + a);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < d.length; i++) {
    const x = d[i], y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; d[i] = y;
  }
}

function mix(ctx: BaseAudioContext, parts: [Float32Array, number, number][]): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(...parts.map(([p, at]) => Math.round(at * sr) + p.length)) + Math.round(sr * 0.004); // 거르개 꼬리 자리
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  for (const [p, at, g] of parts) { const o = Math.round(at * sr); for (let i = 0; i < p.length; i++) d[o + i] += p[i] * g; }
  lowpass(d, sr, LOWPASS_HZ);
  lowpass(d, sr, LOWPASS_HZ);
  for (let i = 0; i < len; i++) d[i] = Math.tanh(d[i] * 1.1) / 1.1;
  return buf;
}

/** (11/20 변경, 같은 의견) 타자음 크기 ~~0.5~~ → 0.36(약 3dB 작게) */
const TYPE_GAIN = 0.36;

const NOTES = [880, 988, 1175, 1319, 1568, 1760];
const KINDS: ['tone' | 'arp' | 'sweep', number][] = [['tone', 1], ['arp', 1.5], ['tone', 1], ['sweep', 2.4], ['arp', 0.75], ['tone', 1]];

export function defineEndSounds(audio: AudioEngine) {
  NOTES.forEach((f, i) => {
    audio.define(`type.${i}`, { bus: 'sfx', gain: TYPE_GAIN }, (ctx) => {
      const sr = ctx.sampleRate, [kind, up] = KINDS[i];
      return mix(ctx, [[blip(sr, f, 0.034, kind, up), 0, 0.32], [tick(sr, 11 + i), 0, 0.18]]);
    });
  });
  audio.define('type.space', { bus: 'sfx', gain: TYPE_GAIN }, (ctx) => mix(ctx, [[tick(ctx.sampleRate, 5), 0, 0.25]]));
  audio.define('type.done', { bus: 'sfx', gain: TYPE_GAIN }, (ctx) => {
    const sr = ctx.sampleRate;
    return mix(ctx, [[blip(sr, 1319, 0.045, 'tone', 1), 0.06, 0.2], [blip(sr, 1976, 0.06, 'tone', 1), 0.105, 0.2]]);
  });
  audio.define('type.clear', { bus: 'sfx', gain: TYPE_GAIN }, (ctx) => {
    const sr = ctx.sampleRate, n = Math.round(sr * 0.08), nz = new Float32Array(n), r = rng(9);
    let lp = 0, prev = 0;
    for (let i = 0; i < n; i++) { lp += (r() - lp) * 0.5; nz[i] = (lp - prev) * Math.exp(-i / sr / 0.03); prev = lp; }
    return mix(ctx, [[blip(sr, 2600, 0.12, 'sweep', 0.42), 0, 0.18], [nz, 0, 0.12]]);
  });
}
