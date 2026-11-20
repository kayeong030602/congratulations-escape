/**
 * (11/18 추가) 테이프 소리를 코드로 만들어요(소리 파일·다운로드·비용 없음).
 *   tape.wind  = ◀◀·▶▶ 때 테이프가 감기는 소리(모터가 윙 도는 소리 + 테이프가 쉭쉭 스치는 잡음, 2초 반복)
 *   tape.clunk = 테이프 보기로 들어가고 나올 때 기계가 철컥 맞물리는 소리
 * 들어 보고 마음에 안 들면 같은 이름을 파일 소리(public/media/sound/)로 바꾸면 돼요(data.ts의 sounds에 적으면 이걸 대신해요).
 */
import type { AudioEngine } from '../engine/audio.ts';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** 테이프 감는 소리(이음매 없이 반복). */
function wind(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, L = Math.round(sr * 2), X = Math.round(sr * 0.08);
  const raw = new Float32Array(L + X);
  const rnd = rng(7);
  let lp = 0, prev = 0, ph1 = 0, ph2 = 0, ph3 = 0;
  for (let i = 0; i < raw.length; i++) {
    const t = i / sr;
    lp += (rnd() - lp) * 0.2; // 잡음을 조금 부드럽게
    const hiss = lp - prev; // 낮은 웅웅거림은 빼고 쉭쉭만
    prev = lp;
    const wob = 1 + 0.006 * Math.sin(2 * Math.PI * 3 * t); // 모터가 살짝 흔들림
    ph1 += (2 * Math.PI * 520 * wob) / sr;
    ph2 += (2 * Math.PI * 1040 * wob) / sr;
    ph3 += (2 * Math.PI * 2290) / sr;
    const motor = Math.sin(ph1) * 0.07 + Math.sin(ph2) * 0.035 + Math.sin(ph3) * 0.012;
    const flutter = 0.7 + 0.3 * Math.sin(2 * Math.PI * 6 * t); // 테이프가 스치는 결
    raw[i] = (hiss * 1.5 * flutter + motor) * 0.55;
  }
  const buf = ctx.createBuffer(1, L, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < L; i++) d[i] = raw[i];
  for (let i = 0; i < X; i++) { const k = i / X; d[i] = raw[i] * k + raw[L + i] * (1 - k); } // 끝을 처음에 겹쳐 섞어 이음매를 없애요
  return buf;
}

/** 철컥: 낮은 쿵 + 짧은 딸깍 + 잠깐의 덜그럭. */
function clunk(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, L = Math.round(sr * 0.28);
  const buf = ctx.createBuffer(1, L, sr);
  const d = buf.getChannelData(0);
  const rnd = rng(31);
  let lp = 0;
  for (let i = 0; i < L; i++) {
    const t = i / sr;
    lp += (rnd() - lp) * 0.08;
    const thump = Math.sin(2 * Math.PI * 78 * t) * Math.exp(-t * 26) * 0.55;
    const click = rnd() * Math.exp(-t * 520) * 0.5;
    const rattle = lp * Math.exp(-Math.max(0, t - 0.03) * 45) * (t > 0.03 ? 0.9 : 0);
    d[i] = thump + click + rattle;
  }
  return buf;
}

/** 소리 엔진에 테이프 소리 두 개를 등록해요. */
export function defineTapeSounds(audio: AudioEngine) {
  audio.define('tape.wind', { bus: 'sfx', loop: true, gain: 0.32 }, wind);
  audio.define('tape.clunk', { bus: 'sfx', gain: 0.7 }, clunk);
}
