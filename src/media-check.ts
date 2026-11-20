/**
 * 소재 확인 화면 (개발용, /media.html).
 * - 뽑은 소재를 4:3 화면에서 하나씩 보고 들어요.
 * - 테이프 소재에서는 설계한 되감기 방식(앞으로 파일 ↔ 거꾸로 파일 바꿔 끼우기)을 직접 시험해요.
 */

type Entry = { file: string; kind: 'still' | 'loop' | 'clip' | 'tape' | 'audio'; bytes: number; dur?: number };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const vA = $<HTMLVideoElement>('vA');
const vB = $<HTMLVideoElement>('vB');
const img = $<HTMLImageElement>('img');
const info = $('info');
const list = $('list');
const transport = $('transport');
const osdState = $('osdState');
const osdCounter = $('osdCounter');

const media = (f: string) => `${import.meta.env.BASE_URL}media/${f}`;
const kb = (b: number) => (b / 1024 < 1024 ? `${Math.round(b / 1024)}KB` : `${(b / 1024 / 1024).toFixed(1)}MB`);

let audio: HTMLAudioElement | null = null;
let front = vA; // 지금 보이는 영상
let back = vB; // 다음 걸 미리 올려 두는 영상

function show(el: HTMLElement | null) {
  for (const e of [vA, vB, img]) e.classList.toggle('on', e === el);
}

function stopAll() {
  for (const v of [vA, vB]) { v.pause(); v.removeAttribute('src'); v.load(); }
  audio?.pause();
  audio = null;
  transport.hidden = true;
  shakeBar.hidden = true;
  tape = null;
  osdState.textContent = 'REC ●';
}

/** 뒤쪽 영상에 파일을 올리고, 원하는 위치의 프레임이 준비되면 앞뒤를 바꿔요(검은 화면 없이). */
function swapTo(src: string, at: number, rate: number, loop = false): Promise<void> {
  return new Promise((resolve) => {
    const v = back;
    const ready = () => {
      v.playbackRate = rate;
      v.play().catch(() => {});
      show(v);
      front.pause();
      [front, back] = [v, front];
      resolve();
    };
    v.loop = loop;
    if (v.getAttribute('src') !== src) {
      v.src = src;
      v.addEventListener('loadeddata', () => { v.currentTime = at; v.addEventListener('seeked', ready, { once: true }); }, { once: true });
    } else {
      v.currentTime = at;
      v.addEventListener('seeked', ready, { once: true });
    }
  });
}

// ── 테이프(되감기) 시험 ─────────────────────────────
let tape: { fwd: string; rev: string; dur: number; dir: 'fwd' | 'rev' } | null = null;

/** 지금 보고 있는 위치를 '앞으로 파일 기준 초'로 */
function tapePos(): number {
  if (!tape) return 0;
  return tape.dir === 'fwd' ? front.currentTime : tape.dur - front.currentTime;
}

async function tapeDo(t: string) {
  if (!tape) return;
  const pos = tapePos();
  for (const b of transport.querySelectorAll('button')) b.classList.toggle('active', b.dataset.t === t);
  osdState.textContent = { rew: '◀◀', play: 'PLAY ▶', slow: 'SLOW ▶', pause: 'PAUSE ⏸', step: 'PAUSE ⏸' }[t] ?? '';

  if (t === 'rew') {
    // 거꾸로 파일에서 같은 순간 = 전체 길이 − 지금 위치
    tape.dir = 'rev';
    await swapTo(tape.rev, Math.max(0, tape.dur - pos), 3);
  } else if (t === 'play' || t === 'slow') {
    const rate = t === 'play' ? 1 : 0.25;
    if (tape.dir === 'fwd') { front.playbackRate = rate; front.play(); return; }
    tape.dir = 'fwd';
    await swapTo(tape.fwd, pos, rate);
  } else if (t === 'pause' || t === 'step') {
    if (tape.dir === 'rev') { tape.dir = 'fwd'; await swapTo(tape.fwd, pos, 1); }
    front.pause();
    if (t === 'step') front.currentTime = Math.min(tape.dur, front.currentTime + 1 / 30);
  }
}

transport.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('button')?.dataset.t;
  if (t) tapeDo(t);
});

// ── 정지 이미지 손떨림 미리보기 ─────────────────────
// 실제 게임에서는 셰이더가 하지만, 느낌을 미리 보려고 같은 움직임을 간단히 흉내 내요.
// 느린 흔들림 + 빠른 잔떨림 + 아주 약한 기울어짐. 가장자리가 안 보이게 3% 확대해 둬요.
const shakeBar = $('shakeBar');
const shakeBtn = $('shakeBtn');
let shakeOn = true;
shakeBtn.onclick = () => {
  shakeOn = !shakeOn;
  shakeBtn.textContent = shakeOn ? '손떨림 켜짐' : '손떨림 꺼짐';
  shakeBtn.classList.toggle('active', shakeOn);
};

function shake(ms: number) {
  if (!shakeOn) { img.style.transform = ''; return; }
  const t = ms / 1000;
  const x = 0.45 * Math.sin(t * 0.83 + 1.3) + 0.25 * Math.sin(t * 2.17) + 0.07 * Math.sin(t * 7.3);
  const y = 0.4 * Math.sin(t * 0.67) + 0.22 * Math.sin(t * 1.93 + 0.7) + 0.07 * Math.sin(t * 8.1 + 2);
  const r = 0.18 * Math.sin(t * 0.51 + 0.4) + 0.06 * Math.sin(t * 3.1);
  const s = 1.03 + 0.004 * Math.sin(t * 0.37);
  img.style.transform = `translate(${x.toFixed(3)}%, ${y.toFixed(3)}%) rotate(${r.toFixed(3)}deg) scale(${s.toFixed(4)})`;
}

// 테이프 카운터 표시 + 끝에 닿았을 때 처리
function tick(ms: number) {
  shake(ms);
  const sec = tape ? tapePos() : front.currentTime || 0;
  const s = Math.floor(sec);
  const f = Math.floor((sec - s) * 30);
  osdCounter.textContent = `0:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  if (tape && tape.dir === 'rev' && front.ended) tapeDo('pause'); // 맨 앞에 닿음 → 멈춤
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// ── 목록 ───────────────────────────────────────────
async function open(e: Entry) {
  stopAll();
  const src = media(e.file);
  const what = { still: '정지 이미지', loop: '반복 클립', clip: '한 번 재생 클립', tape: '테이프', audio: '소리' }[e.kind];
  info.textContent = `${e.file} — ${what}, ${kb(e.bytes)}${e.dur ? `, ${e.dur}초` : ''}`;

  if (e.kind === 'still') {
    img.src = src;
    show(img);
    shakeBar.hidden = false;
  } else if (e.kind === 'audio') {
    show(null);
    audio = new Audio(src);
    audio.play();
  } else if (e.kind === 'tape') {
    tape = { fwd: src, rev: src.replace(/\.mp4$/, '.rev.mp4'), dur: e.dur ?? 0, dir: 'fwd' };
    transport.hidden = false;
    info.textContent += ' — ◀◀ ▶ 1/4 ⏸ 로 되감기 방식을 시험해요';
    await swapTo(tape.fwd, 0, 1);
    tapeDo('play');
  } else {
    await swapTo(src, 0, 1, e.kind === 'loop');
    if (e.kind === 'clip') front.addEventListener('ended', () => (info.textContent += ' (끝)'), { once: true });
  }
}

async function init() {
  const entries: Entry[] = await (await fetch(media('manifest.json'))).json();
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.file.endsWith('.rev.mp4')) continue; // 거꾸로 파일은 테이프 안에서만
    const g = e.file.split('/')[0];
    groups.set(g, [...(groups.get(g) ?? []), e]);
  }
  for (const [g, items] of groups) {
    const h = document.createElement('h2');
    h.textContent = g;
    list.append(h);
    for (const e of items) {
      const b = document.createElement('button');
      b.innerHTML = `<span>${e.file.split('/').slice(1).join('/')}</span><small>${e.kind}</small>`;
      b.onclick = () => {
        list.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        open(e);
      };
      list.append(b);
    }
  }
  const total = document.createElement('p');
  total.className = 'total';
  total.textContent = `${entries.length}개 파일, 합계 ${kb(entries.reduce((s, e) => s + e.bytes, 0))}`;
  list.append(total);
}

init();
