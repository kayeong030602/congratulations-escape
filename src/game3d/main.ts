/**
 * 본 게임(3D) 연결부 — 입력을 받아 세계(world)와 논리(logic)를 매 프레임 돌려요.
 * 주소: http://localhost:5173/  ((11/17 변경) play.html → 첫 화면. play.html은 여기로 넘겨줘요)
 *   ?room=postit  그 방에서 시작(인트로 건너뜀)      ?reset  저장 지우고 처음부터(인트로부터)
 *   ?dev  개발용 표시와 키 — V VHS 끄기/켜기 · L 화면 분위기 바꿔 보기 · X 자동 노출 · B 흔들림 · 1/2 내부 해상도
 *
 * (11/17 변경) 흐름: 파란 VCR 화면(PLAY ▶ + "소리를 켜 주세요, 이어폰 추천") → 화면을 누름(테이프 넣기, 소리 켜짐)
 *   → 최종 영상 0~10.5초를 그대로(WELCOME TO LEVEL 0부터 음악과 함께 → LOADING → 에러) → 3D 하얀 방이 지지직거리며 시작.
 *   브라우저는 화면을 한 번 누르기 전엔 소리를 못 내게 막아서, 누르는 순간을 파란 화면에 두고 타이틀부터 소리와 함께 보여 줘요.
 *   저장이 있거나 ?room=이 있으면 PLAY ▶ 뒤 바로 그 방으로(인트로는 처음 한 번만).
 *   파란 화면을 보는 동안 첫 방을(그리고 그다음 방도) 미리 지어 둬요.
 *
 * 한 프레임의 순서: 입력 → 걷기·카메라 → 세계가 본 것(조준·영역) → 논리 → 소품 맞추기 → 기록 → 그리기(3D 또는 영상 → OSD → VHS)
 *
 * (11/18 추가) 되감기(테이프 보기): R(폰 ◀◀ 버튼)로 시작 → 테이프 재생기(tape.ts)가 재생 위치를 흘리고,
 *   세계는 그 시각의 모습을 그려요(world.tapeShow). 그동안 기록·소품 맞추기는 쉬고, 논리는 시간만 흘러요.
 *   키: R ◀◀ · Space ▶/❚❚ · S 느리게 · F ▶▶ · ← → 한 장씩(멈춤) · Q 녹화 화면으로. 끝(=지금)에 닿아도 녹화 화면으로.
 */
import { AudioEngine } from '../engine/audio.ts';
import { data, rooms } from './data.ts';
import { FAIL_MS, Logic, TAPE_FLAG } from './logic.ts';
import { Recorder } from './recorder.ts';
import { TapePlayer } from './tape.ts';
import { defineTapeSounds } from './tapeSound.ts';
import { defineEndSounds } from './endSound.ts';
import { showEnd } from './end.ts';
import { LOOKS, MONITOR, type Look } from './screen/camcorder.ts';
import { LAYOUT, type OsdState } from './screen/osd.ts';
import { World, type Move } from './world.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage'), canvas = $<HTMLCanvasElement>('screen'), startEl = $('start'), startText = $('start-text');
const INTRO = 'intro/full.mp4'; // 최종 영상 0~10.47초(실사 하얀 방 직전까지). 소리는 'intro.full'(0~11초)
const msgEl = $('msg'), zoomEl = $('zoom'), statEl = $('stat');
const goalEl = $('goal'), goalLines = goalEl.querySelector('.lines')!, goalBoxes = goalEl.querySelector('.boxes')!;
// (11/18 추가) 되감기: 폰 버튼(녹화 중 ◀◀ 하나, 테이프를 볼 때 한 줄)과 PC 키 안내
const rewBtn = $<HTMLButtonElement>('rew'), tapeBar = $('tapebar'), tapeKeys = $('tapekeys');
let goalKey = '';

/** (11/17 추가) 화면 위쪽 안내 문구(logic.goal). 바뀐 때만 다시 그리고, 이미 있던 줄은 그대로 둬요(새 줄만 서서히 나타남). */
function drawGoal(show: boolean) {
  const g = show ? logic.goal : null;
  const n = g?.count ? (logic.counts[g.count] ?? 0) : 0;
  const key = g ? `${g.lines.join('|')}#${n}/${g.of ?? 0}${g.strong ? '!' : ''}` : '';
  if (key === goalKey) return;
  goalKey = key;
  goalEl.hidden = !g;
  if (!g) return;
  goalEl.classList.toggle('strong', !!g.strong); // (11/19 3차 추가) 1분 뒤 힌트: 노랗게 빛나는 글씨
  while (goalLines.children.length > g.lines.length) goalLines.lastChild!.remove();
  g.lines.forEach((t, i) => {
    let sp = goalLines.children[i] as HTMLElement | undefined;
    if (!sp) { sp = document.createElement('span'); goalLines.append(sp); }
    if (sp.textContent !== t) sp.textContent = t;
  });
  goalBoxes.innerHTML = g.of ? Array.from({ length: g.of }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('') : '';
}

const params = new URLSearchParams(location.search);
const dev = params.has('dev');
statEl.hidden = !dev;

if (params.has('reset')) Logic.clearSave();
/** 처음 하는 사람(저장 없음, 방 지정 없음) → 인트로를 보여 줘요. */
const fresh = !params.get('room') && !Logic.loadSave();

// ── (11/20 추가, 폰 점검) 실행할 수 없는 브라우저 ─────────
// 3D 엔진(three.js)은 WebGL2가 있어야 돌아요(iOS 15 이전 등 오래된 폰엔 없음). 전엔 파란 화면도 없이 "화면을 눌러 시작"만 보이고
// 눌러도 아무 일이 없었어요 → 안내를 띄우고 여기서 멈춰요.
if (!(() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })()) {
  stage.classList.add('nogl');
  startEl.querySelector('.sound')?.remove();
  startEl.querySelector('.rotate')?.remove();
  startText.textContent = '이 브라우저에서는 실행 불가';
  for (const p of startEl.querySelectorAll<HTMLElement>('.keys')) p.textContent = '최신 Safari · Chrome으로 열기';
  throw new Error('WebGL2를 쓸 수 없어요');
}
/**
 * 앱을 오가다 폰이 그래픽 메모리를 회수하면(WebGL 컨텍스트 잃음) 화면이 검게 멈춰요. 멈춤 화면으로 두었다가
 * 브라우저가 그래픽을 돌려주면 페이지를 다시 열어 마지막 체크포인트(방 단위 저장)에서 이어 가요.
 */
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); pause(); });
canvas.addEventListener('webglcontextrestored', () => location.reload());

// ── 세계·논리·소리·기록 ─────────────────────────────
const world = new World(canvas);
world.setBakeMode('idle'); // 파란 시작 화면을 보는 동안 첫 방을 빨리 지어 둬요
world.screen.failMs = FAIL_MS;
const clips = world.clips;
const audio = new AudioEngine(data.sounds);
defineTapeSounds(audio);
defineEndSounds(audio); // (11/20 7단계) 엔딩 타자음
const rec = new Recorder();
const tape = new TapePlayer();
const logs: string[] = [];

/**
 * 폰으로 하고 있는가(조작 안내 글씨를 고를 때). 처음엔 기기로, 그다음엔 마지막으로 누른 손가락·마우스로 정해요.
 * (11/17 변경) 폰에서 화면을 톡 치면 브라우저가 "마우스 누름"도 따라 보내서(호환용) PC로 잘못 바뀌던 것 고침:
 * 손가락·마우스는 포인터 사건의 종류(pointerType)로만 가려요.
 */
let touchUI = matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(pointer: fine)').matches);
let lastTouchAt = -1e9;
/** 시작·멈춤 화면의 조작 안내 줄도 같은 판단으로 골라요(play.css의 html.touch). */
const markUI = () => document.documentElement.classList.toggle('touch', touchUI);
markUI();
addEventListener('pointerdown', (e) => {
  const was = touchUI;
  touchUI = e.pointerType !== 'mouse';
  if (touchUI) lastTouchAt = performance.now();
  markUI();
  if (touchUI !== was) layoutTape(); // (11/19 추가) 테이프 모니터 크기·폰 버튼 줄 자리도 기기에 맞게
}, true);
let msgUntil = 0, osdUntil = 0, osdText = '';
const toast = (text: string) => { msgEl.textContent = text; msgUntil = performance.now() + 5000; };
const logic = new Logic(data, rooms, world, audio, {
  log: (m) => { logs.push(m); if (logs.length > 4) logs.shift(); if (dev) console.debug('[g3]', m); },
  toast,
  hint: (text, touch) => toast(touchUI && touch ? touch : text),
  osd: (text, ms) => { osdText = text; osdUntil = performance.now() + ms; },
  event: (e) => {
    if (e.kind === 'room') rec.begin(e.id, logic.state()); // 새 테이프 구간(되감기는 이 방의 처음까지)
    else rec.event(e);
  },
  tapeEnd: () => closeTape(), // 테이프를 보다가 실패·방 이동 → 화면·소리를 라이브로
  // (11/20 7단계) 끝 화면: 3D는 멈추고 파란 화면 위에 기록·출처·방 이름의 뜻(end.ts)
  end: () => {
    phase = 'end';
    endAt = performance.now();
    mouseDown = false;
    keys.clear();
    dropStick();
    if (locked()) document.exitPointerLock();
    showEnd({ playMs: logic.stats.playMs, rewinds: logic.stats.rewinds ?? 0, fails: logic.stats.fails }, (id) => audio.play(id));
  },
});
/**
 * (11/19 추가) 시작·멈춤 화면의 조작 안내 줄에 되감기 키(PC "R 되감기" / 폰 "◀◀ 버튼 되감기")를 넣을지:
 * 되감기가 열린 뒤(플래그 tape — 개발용 ?dev는 어디서나)이고, 되감기를 끈 방이 아닐 때만(사용자 결정).
 * 저장은 Logic을 만들 때 이미 불러와서, 이어 하기의 첫 화면에서도 맞게 보여요.
 */
const markStartKeys = () => startEl.classList.toggle('tape', (dev || logic.flags.has(TAPE_FLAG)) && !logic.tapeOff); // (11/19 6단계) 추격 중처럼 조건으로 끈 때도
markStartKeys();

// ── 흐름: 파란 시작 화면 → 인트로 → 플레이 ───────────
/** start = 파란 VCR 화면(PLAY ▶ 기다림), intro = 인트로 영상, play = 3D, (11/20 7단계) end = 끝 화면. */
let phase: 'start' | 'intro' | 'play' | 'end' = 'start';
/** 걷기·둘러보기·누르기를 받을 수 있는가. */
const canAct = () => phase === 'play' && logic.free;
/** (11/20 추가) 둘러보기만이라도 되는가 — 연출 중에도 되는 때(잠긴 문 빨간 점 열쇠 뒤 안내음성이 나오는 동안) */
const canLook = () => phase === 'play' && logic.canLook;

if (fresh) {
  void clips.prepare(INTRO);
  void audio.load(['intro.full']).catch((e) => console.warn(e));
}

/**
 * PLAY ▶ (테이프 넣기). 이 누름으로 소리가 켜져요.
 * 아이폰은 "누른 그 순간"에 영상을 틀어야 막지 않아서, 영상 재생을 여기서 바로 시작해요(기다리지 않음).
 */
function insert() {
  if (phase !== 'start') return;
  startEl.hidden = true;
  logic.insert();
  if (!fresh) return enterPlay();
  phase = 'intro';
  // 영상이 실제로 움직이기 시작하는 순간에 소리를 같이 시작해요(그 전엔 파란 화면 그대로)
  void clips.play(INTRO, { onStart: () => audio.play('intro.full') }).then(enterPlay);
}

/** 3D로: 3D 하얀 방이 찢어지듯 지지직거리다 잡혀요(실사 하얀 방 지지직 대신). */
function enterPlay() {
  if (phase === 'play') return;
  clips.stop();
  phase = 'play';
  world.glitchIn(fresh ? 1.25 : 0.6); // (11/17 3차 변경) 1.45 → 1.25초(원래 영상의 실사 하얀 방 지지직 길이). 소리 꼬리를 뺐으니 다시 영상 길이로
}

function resume() {
  if (!logic.paused) return;
  startEl.hidden = true;
  logic.setPaused(false);
  clips.resume();
}

function pause() {
  if (phase === 'start' || phase === 'end' || logic.paused) return;
  logic.setPaused(true);
  clips.pause();
  mouseDown = false;
  keys.clear();
  dropStick(); // (11/20 추가)
  startText.textContent = '화면을 눌러 재개';
  startEl.classList.add('paused');
  markStartKeys();
  startEl.hidden = false;
}

// ── 되감기(테이프 보기) ── (11/18 추가) ─────────────
/** 테이프 소리 상태(버튼이 바뀔 때만 소리를 바꿔요). */
let tapeSound = '';
/**
 * (11/18 추가) 처음 테이프를 볼 때 한 번 띄우는 말 — 되감기는 시간을 거스르는 게 아니라 녹화를 돌려 보는 것(사용자 의견).
 * 게임 문구 규칙대로 건조한 평서문.
 */
const TAPE_NOTE = '테이프는 지나간 것을 보여 줄 뿐, 되돌리지 않는다.';
let tapeNoted = false;

/** ◀◀: 테이프 보기 시작. 녹화 중이고, 연출이 진행 중이 아니고, 이 방에서 1초 넘게 찍혔을 때만. */
function openTape(): boolean {
  const seg = rec.current;
  if (phase !== 'play' || tape.active || !seg || seg.len < 1 || seg.room !== logic.room?.id || !world.settled) return false;
  if (!logic.rewind(dev)) return false;
  tape.start(seg);
  logic.transport = tape.transport;
  world.tapeBegin();
  mouseDown = false;
  touchHold = null;
  msgEl.textContent = ''; msgUntil = 0;
  if (!tapeNoted) { tapeNoted = true; toast(TAPE_NOTE); }
  audio.play('tape.clunk');
  tapeSound = '';
  stage.classList.add('tape');
  return true;
}

/** 화면·소리만 라이브로(논리는 부른 쪽이 정리). 논리가 스스로 끝낼 때(실패·방 이동)도 불려요. */
function closeTape() {
  if (!tape.active) return;
  tape.stop();
  world.tapeEnd();
  audio.stop('tape.wind', 80);
  audio.play('tape.clunk');
  audio.muffle('amb', 0, 1, 250);
  tapeSound = '';
  stage.classList.remove('tape');
  clicked = false;
  tapAt = null;
}

/** ■ 또는 테이프 끝(=지금): 녹화 화면으로. */
function stopTape() {
  if (!tape.active) return;
  closeTape();
  logic.stopTape();
}

/** 테이프 버튼(키·폰 버튼 공통). */
function tapeKey(k: 'rew' | 'play' | 'pause' | 'toggle' | 'slow' | 'ff' | 'stop' | 'next' | 'prev') {
  if (!tape.active || logic.paused) return;
  if (k === 'stop') return stopTape();
  if (k === 'next' || k === 'prev') return tape.step(k === 'next' ? 1 : -1);
  if (k === 'toggle') k = tape.transport === 'play' ? 'pause' : 'play';
  tape.press(({ rew: 'REW', play: 'PLAY', pause: 'PAUSE', slow: 'SLOW', ff: 'FF' } as const)[k]);
}

/** 테이프 소리: ◀◀·▶▶ = 감기는 소리(빠를수록 높게), ▶ = 바탕음이 캠코더 스피커로 듣는 녹음처럼, ❚❚ = 거의 조용. */
function tapeAudio() {
  const t = tape.transport;
  const winding = t === 'rew' || t === 'ff';
  if (winding) audio.rate('tape.wind', 0.8 + Math.abs(tape.speed) * 0.045 + (t === 'ff' ? 0.06 : 0));
  if (t === tapeSound) return;
  tapeSound = t;
  if (winding) { if (!audio.playing('tape.wind')) audio.play('tape.wind'); }
  else audio.stop('tape.wind', 90);
  if (winding) audio.muffle('amb', 0.85, 0.35, 150);
  else if (t === 'pause') audio.muffle('amb', 0.9, 0.2, 150);
  else audio.muffle('amb', 0.6, 0.7, 150);
}

/** 시작·멈춤 화면을 누름: 처음이면 PLAY ▶, 멈춤이면 이어서. */
function begin() {
  audio.unlock();
  clips.kick();
  if (phase === 'start') insert();
  else resume();
  // (11/20 추가, 폰 점검) 누른 이 순간에 해 둬야 하는 것들(브라우저가 "사용자가 누른 순간"에만 허락해요)
  clips.bless(); // 저전력 모드·앱 속 브라우저에서도 나중의 옛 녹화 영상이 막히지 않게 영상 재생기를 미리 허락받아 둬요
  world.tapeClip.bless();
  void keepAwake();
  armBack();
  goFullscreen(); // (11/20 추가, 사용자 의견) 안드로이드: 전체 화면으로
}

// ── (11/20 추가, 폰 점검 뒤 사용자 의견) 앱 속 브라우저 안내 · 전체 화면 ──────────
/**
 * 카카오톡·네이버 앱 등의 앱 속 브라우저는 영상·소리·전체 화면을 막는 경우가 있어요(네이버 앱에선 인트로가 안 나오고 바로 게임으로 — 사용자 확인).
 * 그래서 시작 화면 위쪽에 "Safari · Chrome · 삼성 인터넷 권장" + "다른 브라우저로 열기"(사용자 결정: 막지는 않고 권장만).
 *   카카오톡 = 카카오톡이 열어 주는 주소(kakaotalk://web/openExternal)로 기본 브라우저에서 · 안드로이드의 다른 앱 = 크롬으로 여는 intent
 *   · 아이폰의 다른 앱(네이버 등) = 앱 밖으로 여는 방법이 없어서 링크를 복사해 Safari에 붙여넣게
 */
const UA = navigator.userAgent;
const inApp = /KAKAOTALK/i.test(UA) ? 'kakao'
  : /NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|Line\/|DaumApps|everytimeApp|BAND\//i.test(UA) || (/Android/i.test(UA) && /; wv\)/.test(UA)) ? 'other'
  : null;
const isIOS = /iPhone|iPad|iPod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
{
  const box = $('inapp'), btn = $<HTMLButtonElement>('inapp-open');
  for (const t of ['pointerdown', 'click'] as const) box.addEventListener(t, (e) => e.stopPropagation()); // 안내를 눌러도 게임이 시작되지 않게
  box.hidden = !inApp;
  if (inApp !== 'kakao' && isIOS) btn.textContent = '링크 복사';
  btn.addEventListener('click', () => {
    const url = location.href;
    if (inApp === 'kakao') location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    else if (!isIOS) location.href = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=${location.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
    else {
      const done = () => { btn.textContent = '링크 복사됨 · Safari 주소창에 붙여넣기'; };
      (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(done, () => { window.prompt('링크를 복사해 Safari 주소창에 붙여넣기', url); });
    }
  });
}
/**
 * 안드로이드(크롬·삼성 인터넷)는 PLAY·이어서를 누르는 순간 전체 화면으로(주소창·알림줄 없이). 뒤로 가기 한 번이면 전체 화면만 풀려요.
 * 아이폰 사파리는 페이지를 전체 화면으로 만들 수 없어요 — "aA → 도구 막대 가리기" 또는 공유 → "홈 화면에 추가"로 연 아이콘(index.html의 apple-mobile-web-app-capable).
 * PC는 마우스 잠금과 겹쳐서 하지 않아요(F11).
 */
function goFullscreen() {
  if (!touchUI || document.fullscreenElement) return;
  const el = document.documentElement;
  try { void el.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* 지원 안 함(아이폰 사파리 등) */ }
}

// ── (11/20 추가, 폰 점검) 화면 꺼짐 막기 · 실수로 뒤로 가기 ──────────
/**
 * 인트로·테이프·엔딩 타자처럼 손을 안 대고 보는 동안 폰 화면이 어두워지거나 잠기지 않게(Screen Wake Lock).
 * 탭을 벗어나면 브라우저가 저절로 풀어서, 다시 누를 때(begin) 또 걸어요. 지원 안 하는 브라우저(옛 iOS·일부 앱 속 브라우저)는 그냥 지나가요.
 */
let wake: { release(): Promise<void> } | null = null;
async function keepAwake() {
  const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> } };
  if (wake || !nav.wakeLock || document.hidden) return;
  try {
    const w = await nav.wakeLock.request('screen');
    wake = w;
    w.addEventListener('release', () => { if (wake === w) wake = null; });
  } catch { /* 배터리 절약 모드 등으로 거절 — 그냥 둬요 */ }
}
/**
 * 화면 왼쪽 가장자리를 밀거나(아이폰 사파리) 뒤로 버튼(안드로이드)을 누르면 페이지를 떠나 게임이 꺼졌어요.
 * PLAY를 누를 때 기록 한 칸을 넣어 두고, 뒤로 가기가 그 칸을 빼면 멈춤 화면만 띄워요. 멈춤 화면에서 한 번 더 뒤로 가면 진짜로 나가요
 * (이어서 하면 다시 한 칸 넣어요). 진행은 방마다 저장돼 있어요.
 */
let backArmed = false;
function armBack() {
  if (backArmed || phase === 'end') return;
  try { history.pushState({ g3: 1 }, ''); backArmed = true; } catch { /* 막힌 환경 */ }
}
addEventListener('popstate', () => {
  backArmed = false;
  pause();
  if (locked()) document.exitPointerLock(); // PC(마우스 뒤로 버튼 등): 마우스도 풀어 줘요
});

// ── 입력 ────────────────────────────────────────────
const keys = new Set<string>();
const stick = { id: -1, x0: 0, y0: 0, fwd: 0, side: 0, run: false };
const look = { id: -1, x: 0, y: 0 };
/** 손가락으로 누르고 있는 대상(누르고 있기). at = 화면의 그 자리(-1~1). */
let touchHold: { id: number; at: [number, number] } | null = null;
let tap: { id: number; x: number; y: number; t: number } | null = null;
let tapAt: [number, number] | null = null; // 이번 프레임에 톡 누른 자리
let mouseDown = false;
let clicked = false;
/** 개발용: L 키로 화면 분위기를 직접 골라 봄(되감기 화면은 되감기 단계 전까지 이걸로만 볼 수 있어요). */
let devLook: Look | null = null;

const locked = () => document.pointerLockElement === canvas;
/** 마우스를 화면에 잠가요(브라우저가 거절해도 오류를 내지 않게). */
const lockMouse = () => { try { (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* 지원 안 함 */ } };

// (11/17 변경) 시작은 click에서: 아이폰은 손가락을 "대는" 순간(pointerdown)을 소리·영상 허락으로 쳐 주지 않아요
startEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  touchUI = e.pointerType !== 'mouse';
});
startEl.addEventListener('click', (e) => {
  e.stopPropagation();
  begin();
  if (!touchUI) lockMouse();
});
// (11/20 추가, 폰 점검) 시작·멈춤 화면일 때 4:3 화면 밖 검은 자리를 눌러도 시작·이어서(세로로 든 폰은 화면이 작아서)
document.addEventListener('click', (e) => {
  if (startEl.hidden || phase === 'end' || (e.target as Element | null)?.closest?.('#end')) return;
  begin();
  if (!touchUI) lockMouse();
});
// 전화·잠금 화면 뒤에 소리가 멈춰 있으면 다음 누름에서 다시 켜요
addEventListener('pointerup', () => audio.unlock());
addEventListener('touchend', () => audio.unlock(), { passive: true });
document.addEventListener('pointerlockchange', () => {
  // Esc로 마우스 잠금이 풀리면 일시정지
  if (!locked() && matchMedia('(pointer: fine)').matches) pause();
});
document.addEventListener('visibilitychange', () => {
  // (11/20 2차 추가) 끝 화면엔 멈춤이 없어서: 다른 앱으로 가면 끝 화면 노래(Bit Shift)도 멈추고, 돌아오면 이어서
  if (phase === 'end') { if (document.hidden) audio.suspend(); else audio.resume(); return; }
  if (document.hidden) pause();
});

document.addEventListener('mousemove', (e) => {
  if (!locked() || !canLook()) return;
  const s = 0.0022 / world.zoomCur; // 줌을 당기면 시선이 천천히 움직여요. 사용자가 확인한 감도
  world.walker.turn(e.movementX * s, e.movementY * s);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (performance.now() - lastTouchAt < 1000) return; // 손가락으로 톡 친 뒤 따라오는 가짜 마우스 누름은 무시(터치 쪽에서 이미 처리)
  if (!locked()) { lockMouse(); return; } // 잠그는 첫 클릭은 누르기로 치지 않아요
  mouseDown = true;
  clicked = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('wheel', (e) => {
  if (canAct()) world.zoom *= Math.exp(-e.deltaY * 0.0015);
}, { passive: true });
addEventListener('keydown', (e) => {
  keys.add(e.code);
  // (11/18 추가) 되감기 키
  if (phase === 'play' && !logic.paused && !e.repeat) {
    if (tape.active) {
      const k = ({ KeyR: 'rew', Space: 'toggle', KeyS: 'slow', KeyF: 'ff', KeyQ: 'stop', ArrowRight: 'next', ArrowLeft: 'prev' } as const)[e.code as string];
      if (k) { e.preventDefault(); tapeKey(k); }
    } else if (e.code === 'KeyR' && canAct()) openTape();
  }
  if (tape.active && (e.code === 'ArrowRight' || e.code === 'ArrowLeft') && e.repeat) tapeKey(e.code === 'ArrowRight' ? 'next' : 'prev'); // 꾹 누르면 연달아
  if (canAct() && (e.code === 'Equal' || e.code === 'NumpadAdd')) world.zoom *= 1.25;
  if (canAct() && (e.code === 'Minus' || e.code === 'NumpadSubtract')) world.zoom /= 1.25;
  if (!dev) return;
  if (e.code === 'KeyV') world.screen.raw = !world.screen.raw;
  if (e.code === 'KeyX') world.screen.ae = !world.screen.ae;
  if (e.code === 'KeyL') {
    // live → play → slow → pause → rew → ff → fail → (원래대로)
    const list: Look[] = LOOKS.filter((l) => l !== 'menu');
    const i = devLook ? list.indexOf(devLook) + 1 : 1;
    devLook = i < list.length ? list[i] : null;
  }
  if (e.code === 'KeyB') world.walker.shake = world.walker.shake ? 0 : 1;
  if (e.code === 'Digit1') world.setRes(480);
  if (e.code === 'Digit2') world.setRes(720);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseDown = false; });

// 터치: 왼쪽 절반 = 걷기, 오른쪽 절반 = 둘러보기, 톡 = 그 자리를 누르기, 대상을 꾹 = 누르고 있기
// (11/20 변경, 폰 점검) 4:3 화면(stage) 안에서만 받던 것을 창 전체로: 가로로 든 폰은 엄지가 양옆 검은 띠에,
//   세로로 든 폰은 아래쪽 검은 자리에 놓이는데 거기선 반응이 없었어요. 왼쪽·오른쪽은 창의 절반으로 나눠요(화면이 가운데라 전과 같은 선).
//   검은 자리를 톡 치는 건 아무것도 누르지 않아요(걷던 엄지를 떼다가 실수로 손자국 오답이 나지 않게). 꾹 누르기도 화면 안에서만.
const toScreen = (e: PointerEvent): [number, number] => {
  const r = stage.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
};
const onStage = (e: PointerEvent) => {
  const r = stage.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};
/** (11/20 추가, 사용자 결정) 걷기 막대 표시: 왼쪽 엄지를 댄 자리에 흐린 동그라미 + 미는 쪽 점(번지지 않는 층, 떼면 사라짐). */
const stickEl = $('stick'), stickDot = stickEl.querySelector('i')!;
const STICK_R = 50; // 끝까지 미는 거리(px) — 아래 걷기 계산과 같은 값
function drawStick(dx = 0, dy = 0) {
  const d = Math.hypot(dx, dy), k = d > STICK_R ? STICK_R / d : 1;
  stickDot.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  stickEl.classList.toggle('run', stick.run);
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || phase === 'end') return;
  touchUI = true;
  const inside = onStage(e);
  if (tape.active && !logic.paused) { if (inside) tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; return; } // 테이프: 톡 = 테이프 대상 누르기만
  if (!canAct()) {
    // (11/20 추가) 연출 중이어도 둘러보기만 되는 때: 화면 어디를 밀어도 둘러보기
    if (canLook() && look.id < 0) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
    return;
  }
  if (inside) {
    const at = toScreen(e);
    const aimed = world.sense(logic.targets(), at).aim;
    if (aimed && logic.targets().find((t) => t.id === aimed)?.on === 'hold' && !touchHold) {
      touchHold = { id: e.pointerId, at };
      return;
    }
    tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }
  if (e.clientX < innerWidth / 2 && stick.id < 0) {
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, fwd: 0, side: 0, run: false });
    Object.assign(stickEl.style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
    drawStick();
    stickEl.hidden = false;
  } else if (look.id < 0) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
});
document.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    const dx = e.clientX - stick.x0, dy = stick.y0 - e.clientY;
    stick.side = Math.max(-1, Math.min(1, dx / STICK_R));
    stick.fwd = Math.max(-1, Math.min(1, dy / STICK_R));
    stick.run = Math.hypot(dx, dy) > 85; // 끝까지 밀면 뛰어요
    drawStick(dx, -dy);
  } else if (e.pointerId === look.id) {
    if (canLook()) world.walker.turn(((e.clientX - look.x) * 0.005) / world.zoomCur, ((e.clientY - look.y) * 0.005) / world.zoomCur); // (11/20) 연출로 걷기 시작하면 멈춤
    look.x = e.clientX; look.y = e.clientY;
  }
});
const lift = (e: PointerEvent) => {
  if (tap && e.pointerId === tap.id) {
    if (e.type === 'pointerup' && performance.now() - tap.t < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10) {
      tapAt = toScreen(e);
      clicked = true;
    }
    tap = null;
  }
  if (touchHold && e.pointerId === touchHold.id) touchHold = null;
  if (e.pointerId === stick.id) { Object.assign(stick, { id: -1, fwd: 0, side: 0, run: false }); stickEl.hidden = true; }
  if (e.pointerId === look.id) look.id = -1;
};
document.addEventListener('pointerup', lift);
document.addEventListener('pointercancel', lift);
document.addEventListener('gesturestart', (e) => e.preventDefault()); // (11/20 추가) 사파리 두 손가락 확대 막기(touch-action과 같이)
/** 연출이 시작되거나 멈춤 화면이 되면 걷기 막대를 놓은 것으로(엄지를 대고 있어도 동그라미는 숨김). */
function dropStick() {
  Object.assign(stick, { id: -1, fwd: 0, side: 0, run: false });
  look.id = -1;
  stickEl.hidden = true;
}

// 줌 막대를 손가락(또는 마우스)으로 밀기. 막대는 화면에 찍힌 그림이라, 같은 자리에 보이지 않는 터치 영역을 둬요
const Z = LAYOUT.zoom;
Object.assign(zoomEl.style, {
  left: `${(Z.x0 - 0.07) * 100}%`,
  width: `${(Z.x1 - Z.x0 + 0.14) * 100}%`,
  top: `${(LAYOUT.bottom - 0.07) * 100}%`,
  height: '14%',
});
const zoomDrag = (e: PointerEvent) => {
  if (!canAct()) return;
  const r = stage.getBoundingClientRect();
  const k = Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width - Z.x0) / (Z.x1 - Z.x0)));
  world.zoom = 1 + k * (world.zoomMax - 1);
};
zoomEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  zoomDrag(e);
  try { zoomEl.setPointerCapture(e.pointerId); } catch { /* 손가락이 이미 떨어졌으면 무시 */ }
});
zoomEl.addEventListener('pointermove', (e) => { if (zoomEl.hasPointerCapture(e.pointerId)) zoomDrag(e); });

// (11/18 추가) 폰 되감기 버튼. 누름은 화면(걷기·둘러보기)으로 새지 않게 막아요
for (const el of [rewBtn, tapeBar]) el.addEventListener('pointerdown', (e) => { e.stopPropagation(); touchUI = e.pointerType !== 'mouse'; });
rewBtn.addEventListener('click', (e) => { e.stopPropagation(); openTape(); });
tapeBar.addEventListener('click', (e) => {
  e.stopPropagation();
  const k = (e.target as HTMLElement).closest('button')?.dataset.k;
  if (k) tapeKey(k as Parameters<typeof tapeKey>[0]);
});

function move(): Move {
  const k = (a: string, b: string) => (keys.has(a) || keys.has(b) ? 1 : 0);
  return {
    fwd: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown') + stick.fwd,
    side: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft') + stick.side,
    run: keys.has('ShiftLeft') || keys.has('ShiftRight') || stick.run,
  };
}

// ── 화면 크기 ───────────────────────────────────────
function fit() {
  const w = Math.min(innerWidth, (innerHeight * 4) / 3);
  stage.style.width = `${w}px`;
  stage.style.height = `${(w * 3) / 4}px`;
  // 글씨 크기의 기준 = 4:3 화면 높이의 1%. (11/17 변경) 창 높이(vh)로 정하면 세로로 든 폰에서 화면은 작은데 글씨만 커져요
  stage.style.setProperty('--u', `${(w * 3) / 400}px`);
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  world.setSize(Math.round(w * dpr), Math.round(((w * 3) / 4) * dpr));
  layoutTape();
}

/**
 * (11/19 추가) 테이프 모니터 크기와 폰 버튼 줄 자리(사용자 결정: 폰은 90%, PC는 그대로 84%).
 * 폰(손가락)은 그림이 커져 아래 테두리가 얇아지니, 버튼 줄을 4:3 화면 밖 검은 자리로 옮겨요(그림을 안 가리고 버튼도 커져요):
 *   세로 화면 = 화면 아래(bar-below), 가로 화면 = 화면 오른쪽에 세로로(bar-side).
 * 검은 자리가 모자라면(4:3에 가까운 태블릿 가로 화면 등) 전처럼 84% + 아래 테두리 위. 크기는 play.css가 --below·--side로 정해요.
 */
function layoutTape() {
  const w = Math.min(innerWidth, (innerHeight * 4) / 3), h = (w * 3) / 4;
  const below = (innerHeight - h) / 2, side = (innerWidth - w) / 2;
  const at = !touchUI ? '' : below >= 64 ? 'below' : side >= 76 ? 'side' : '';
  stage.classList.toggle('bar-below', at === 'below');
  stage.classList.toggle('bar-side', at === 'side');
  stage.style.setProperty('--below', `${below}px`);
  stage.style.setProperty('--side', `${side}px`);
  world.screen.setMonitor(at ? MONITOR.phone : MONITOR.pc);
}
addEventListener('resize', fit);
fit();

// ── 되감기 표시(번지지 않는 HTML) ── (11/18 추가) ────
let tapeUIKey = '';
/** 폰: 녹화 중 ◀◀ 버튼(되감기가 열린 뒤), 테이프를 볼 때 버튼 한 줄(지금 버튼은 밝게). PC: 테이프를 볼 때 키 안내 한 줄. */
function drawTapeUI() {
  const live = phase === 'play' && !logic.paused && logic.flags.has(TAPE_FLAG) && !logic.room?.tape?.off; // (11/19 6단계) 추격 중(offWhen)엔 버튼은 보이되 흐리게(canRewind가 막음)
  const showRew = touchUI && live && !tape.active && (logic.mode === 'live' || logic.mode === 'holding');
  const ready = showRew && logic.canRewind() && world.settled;
  const key = [showRew, ready, tape.active && !logic.paused, touchUI, tape.active ? tape.transport : ''].join('|');
  if (key === tapeUIKey) return;
  tapeUIKey = key;
  rewBtn.hidden = !showRew;
  rewBtn.classList.toggle('off', !ready);
  const bar = tape.active && !logic.paused;
  tapeBar.hidden = !(bar && touchUI);
  tapeKeys.hidden = !(bar && !touchUI);
  for (const b of tapeBar.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.k === tape.transport);
}

// ── 돌리기 ──────────────────────────────────────────
let aimed: string | null = null;
const earDir = world.camera.position.clone(); // (11/19 6단계) 입체 음향용 바라보는 쪽(매 프레임 새로 만들지 않게)
let bakeMode: 'idle' | 'video' | 'play' = 'idle';
let lastLook: Look = 'live';

/** (11/20 7단계) 끝 화면이 뜬 시각. */
let endAt = 0;

function step(dt: number) {
  // (11/20 추가, 폰 점검) 끝 화면이 다 덮은 뒤(나타나는 0.9초 + 여유)엔 뒤에서 3D·화면 효과를 그리지 않아요(배터리·발열)
  if (phase === 'end' && performance.now() - endAt > 1500) return;
  const playing = phase === 'play' && !logic.paused;
  if (!logic.paused) clips.tick(dt);
  // (11/18 추가) 테이프를 보는 중: 재생 위치를 흘리고(끝에 닿으면 녹화 화면으로) 그 시각의 모습을 세계에 줘요
  let view = null as ReturnType<TapePlayer['view']>;
  if (tape.active) {
    if (logic.mode !== 'tape') closeTape(); // 혹시 논리가 먼저 나갔으면
    else if (playing && tape.tick(dt) === 'end') stopTape();
  }
  if (tape.active) {
    logic.transport = tape.transport;
    view = tape.view();
    if (view) {
      if (!playing) view.speed = 0; // 멈춤 화면에선 끼어든 영상도 멈춰요
      world.tapeShow(view);
    }
    tapeAudio();
  }
  // (11/20 4차) 끝 화면이 나타나는 동안에도 시간을 흘려요(걷기는 없음) — 크레딧 끝의 지지직이 파란 화면 뒤에서 이어서 걷히게
  world.tick(playing || phase === 'end' ? dt : 0, playing && logic.free ? move() : null);
  // (11/19 6단계 추가) 입체 음향: 듣는 자리 = 캠코더(테이프를 볼 땐 테이프 속 캠코더)
  {
    const c = world.camera, f = c.getWorldDirection(earDir);
    audio.listen(c.position.x, c.position.y, c.position.z, f.x, f.y, f.z);
  }

  if (playing) {
    let at = touchHold?.at ?? tapAt;
    // (11/18 추가) 테이프를 볼 때는 그림이 모니터 안에 작게 있어서, 누른 자리를 그림 안 자리로 바꿔요(볼록한 모양은 무시 — 테이프 대상은 넉넉해요)
    const mon = world.screen.monitor, shape = world.screen.monitorShape;
    if (at && mon > 0) {
      const k = mon * mon * (3 - 2 * mon), s = 1 - (1 - shape.scale) * k;
      at = [at[0] / s, (at[1] - 2 * shape.lift * k) / s];
    }
    logic.tapeTest = view ? view.test : null; // (11/20 추가) 테이프 대상은 "그 시각의 상태"로도 걸러요(계단 0-3 녹화를 보고 0-4를 통과하는 구멍 막기)
    logic.tapeSpeed = view ? view.speed : 0; // (11/20 2차) 빨리 감아도 본 걸로(지나간 테이프 시간으로 세요)
    const s = world.sense(logic.targets(), at);
    aimed = s.aim;
    logic.update(dt, { aim: s.aim, zones: s.zones, zoom: view ? view.pose.zoom : world.zoomCur, press: mouseDown || !!touchHold, click: clicked, seen: s.seen });
    if (!tape.active) world.sync(logic.test); // 테이프를 보는 동안 라이브 모습은 그대로 둬요
    // 기록: 녹화 중(걷는 중·연출 중·누르고 있는 중)에만. 테이프를 보는 동안·씹힘 중엔 쉬어요
    if (logic.mode !== 'tape' && logic.mode !== 'failing') {
      const w = world.walker;
      rec.tick(dt, { x: w.x, z: w.z, y: w.y, yaw: w.yaw, pitch: w.pitch, zoom: world.zoomCur }); // (11/20) 발 높이도(계단)
    }
  }
  clicked = false;
  tapAt = null;

  const now = performance.now();
  if (msgUntil && now > msgUntil) { msgEl.textContent = ''; msgUntil = 0; }
  if (osdUntil && now > osdUntil) { osdText = ''; osdUntil = 0; }
  drawGoal(phase === 'play' && !logic.paused && !tape.active && !world.clips.active && !logic.typed); // (11/20 7단계) 엔딩 타자 글씨 중에도 숨겨요 // (11/19 3차 추가) 옛 녹화 같은 전체 화면 영상 중엔 숨겨요
  drawTapeUI();

  // 화면 분위기: 시작 전·멈춤 = 파란 화면(영상이 아직 안 움직이거나 첫 방을 짓는 중에도 파란 화면 그대로),
  // 실패 = 테이프 씹힘, 그 밖엔 녹화 중(되감기는 되감기 단계에서 붙여요)
  const waiting = phase === 'start' || (phase === 'intro' && !clips.active) || (phase === 'play' && !world.room);
  // 뒤에서 방 짓는 빠르기: 파란 화면이면 빨리, 인트로 영상 중엔 조금씩(영상이 안 끊기게), 게임 중엔 보통
  const pace = waiting ? 'idle' : phase === 'intro' ? 'video' : 'play';
  if (pace !== bakeMode) world.setBakeMode((bakeMode = pace));
  const look: Look = logic.paused || waiting || phase === 'end' ? 'menu'
    : phase === 'play' && logic.mode === 'failing' ? 'fail'
    : phase === 'play' && tape.active ? tape.transport // (11/18 추가) ◀◀ REW / ▶ PLAY / ▶ SLOW / ❚❚ PAUSE / ▶▶ FF
    : phase === 'play' ? devLook ?? 'live' : 'live';
  // 캠코더 글씨: 인트로·전체 화면 영상엔 없음, 3D에선 REC ● 등(파란 화면의 PLAY ▶ / PAUSE는 look이 menu면 늘 그려요)
  const mode: OsdState['mode'] = phase === 'intro' || clips.active ? 'none' : 'cam';
  const aim = !!aimed && (canAct() || (tape.active && !logic.paused));
  world.render({
    vhs: phase === 'play' && logic.room ? logic.vhs : 0.25,
    look,
    dt,
    aim,
    osd: {
      look,
      mode,
      // (11/19 추가) PLAY ▶를 눌렀는데 아직 준비 중(방 짓기·소리 받기, 인트로 영상 받기)이면 LOADING...(멈춘 게 아님을 알려요)
      title: phase === 'end' ? 'STOP' : logic.paused ? 'PAUSE' : phase !== 'start' && waiting ? 'LOADING' : 'PLAY',
      // (11/18 변경) 테이프를 볼 때는 재생 위치(거꾸로 돌아가요)
      counter: tape.active ? Math.max(0, logic.tapeSec - (tape.len - tape.head)) : logic.tapeSec,
      zoom: view ? view.pose.zoom : world.zoomCur,
      zoomMax: world.zoomMax,
      aim,
      gauge: Math.max(logic.holdRatio, logic.dwellRatio),
      text: osdText,
      type: logic.typed, // (11/20 7단계) 엔딩 타자 글씨
    },
  });
  lastLook = look;
}

let last = performance.now();
let fps = 0;
let statAt = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  step(dt);
  if (dev && now > statAt) {
    statAt = now + 400;
    const w = world.walker;
    const ae = world.screen.readExposure(world.renderer);
    statEl.textContent =
      `${fps.toFixed(0)}fps · 내부 ${(world.resH * 4) / 3}×${world.resH} · 삼각형 ${world.stats.tris} · 그리기 ${world.stats.calls}회 · 굽기 ${world.stats.bakeMs}ms\n` +
      `${phase}${clips.active ? ' (영상)' : ''} · 화면 ${lastLook}${world.screen.raw ? ' (VHS 끔)' : ''} · 평균 밝기 ${ae.adapted.toFixed(3)} · 노출 ${ae.ev.toFixed(2)}배${world.screen.ae ? '' : ' (자동 노출 끔)'}\n` +
      `${logic.room?.title ?? '-'} · ${logic.mode}${logic.paused ? ' (멈춤)' : ''} · 위치 ${w.x.toFixed(2)}, ${w.z.toFixed(2)}${w.y ? ` · 높이 ${w.y.toFixed(2)}` : ''} · 줌 ${world.zoomCur.toFixed(2)} · 조준 ${aimed ?? '-'}\n` +
      // (11/20) 계단참 루프: 몇 번째 바퀴
      `${'stair.floor' in logic.counts ? `계단 0-${logic.counts['stair.floor']} · ` : ''}` +
      // (11/19 6단계) 잠긴 문 추격: 켜진 불 칸 수와 "뒤를 보는 중"(빨리 흐름) 여부
      `${'lights' in logic.counts ? `불 ${logic.counts.lights}칸 · ${logic.fast ? '뒤를 봄(빨리)' : '앞을 봄'} · ` : ''}` +
      `플래그 ${[...logic.flags].join(' ') || '-'} · 메모 ${logic.notes.size} · 테이프 ${rec.seconds.toFixed(0)}초(${rec.segments.length}구간)` +
      `${tape.active ? ` · ▶ ${tape.transport} ${tape.head.toFixed(1)}/${tape.len.toFixed(1)}초 ×${tape.speed.toFixed(1)}` : ` · 되감기 ${logic.canRewind(dev) && world.settled ? '가능' : '불가'}`}\n` +
      logs.join('\n');
  }
  requestAnimationFrame(loop);
}

// 타이틀을 보는 동안 첫 방을 미리 지어 둬요
// (11/20 추가) 개발 미리보기에서만: ?spawn=자리 &flags=플래그,… — 예) 잠긴 문 바로 시험:
//   ?room=warm&spawn=hall&flags=warm.open,warm.played,warm.told,warm.solved,warm.exit,warm.inhall
const devStart = import.meta.env.DEV && params.get('room')
  ? {
    spawn: params.get('spawn') ?? undefined, flags: params.get('flags')?.split(',').filter(Boolean),
    // (11/20 7단계) &counts=이름:값,… — 예) 계단 마지막 바퀴(엔딩 바로 시험): ?room=stairs&spawn=top&counts=stair.floor:5
    counts: Object.fromEntries((params.get('counts') ?? '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split(':'); return [k, Number(v)]; })),
  }
  : undefined;
void logic.start(params.get('room') ?? undefined, devStart).catch((e) => {
  console.error(e);
  msgEl.textContent = '방을 불러오지 못함 · 새로 고침 필요';
});
requestAnimationFrame(loop);

// 개발용: 콘솔·자동 시험에서 쓰는 손잡이
Object.assign(window, {
  g3: {
    logic, world, rec, keys, step, begin, pause, audio,
    tape, openTape, stopTape, tapeKey, // (11/18 추가) 되감기 시험용
    phase: () => phase,
    press: (on: boolean) => { mouseDown = on; if (on) clicked = true; },
    tapAt: (x: number, y: number) => { tapAt = [x, y]; clicked = true; },
  },
});
