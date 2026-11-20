/**
 * 시작점. 엔진 부품을 이어 붙이고, 시험용 표시(오른쪽 칸)를 그려요.
 *
 * 주소 뒤에 붙일 수 있는 것(개발용):
 *   ?room=postit   그 방에서 새로 시작
 *   ?reset         저장을 지우고 처음부터
 *   ?nopause       창을 벗어나도 자동 일시정지 안 함
 */
import { game as data, rooms } from './data/game.ts';
import type { LookDir } from './data/schema.ts';
import { AudioEngine } from './engine/audio.ts';
import { Game } from './engine/game.ts';
import { bindInput } from './engine/input.ts';
import type { TransportEvent } from './engine/machine.ts';
import { Player } from './engine/player.ts';
import { Canvas2DRenderer } from './engine/renderer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('screen');
const statusEl = $('status');
const buttonsEl = $('buttons');
const logEl = $('log');
const params = new URLSearchParams(location.search);

const logs: string[] = [];
const log = (msg: string) => {
  logs.unshift(msg);
  logs.length = Math.min(logs.length, 14);
  logEl.textContent = logs.join('\n');
};

let loading = '';
const player = new Player();
const audio = new AudioEngine(data.sounds);
const renderer = new Canvas2DRenderer(canvas); // 다음 단계: WebGL VHS 셰이더 렌더러로 교체
const game = new Game(data, rooms, player, audio, {
  change: () => (dirty = true),
  loading: (d, t) => { loading = d < t ? `LOADING... ${d}/${t}` : ''; dirty = true; },
  log,
  osd: (text) => log(`OSD: ${text}`),
});

bindInput(canvas, game, audio);

// ── 시험용 표시 ──────────────────────────────────────
let dirty = true;
let buttonsKey = '';

const LOOK_LABEL: Record<LookDir, string> = { left: '← 왼쪽', right: '오른쪽 →', up: '↑ 위', down: '↓ 아래', back: '↶ 뒤돌아보기' };
const TAPE_BTNS: [string, TransportEvent][] = [['◀◀', 'REW'], ['▶', 'PLAY'], ['▶ 1/4', 'SLOW'], ['⏸', 'PAUSE'], ['한 프레임 ▷', 'STEP'], ['▶▶', 'FF']];

function button(label: string, fn: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { audio.unlock(); fn(); };
  buttonsEl.append(b);
}

function drawDev() {
  if (!game.room) return void (statusEl.textContent = loading || 'LOADING...');
  const timers = Object.entries(game.timeLeft()).map(([id, s]) => `${id} ${s.toFixed(1)}초`).join(', ');
  const tape = game.tapeInfo();
  statusEl.textContent = [
    loading,
    `게임 흐름  ${game.app}`,
    `캠코더    ${game.mode}${game.mode === 'tape' ? ` / ${game.transport}` : ''}`,
    `방 / 시점  ${game.room.title} / ${game.viewId}`,
    `줌        ${game.zoom.toFixed(2)}배 (최대 ${game.view.zoomMax ?? 1})`,
    timers && `타이머    ${timers}`,
    game.mode === 'tape' && `테이프    ${tape.pos.toFixed(2)} / ${tape.total.toFixed(2)}초`,
    `플래그    ${[...game.flags].join(', ') || '-'}`,
    `개수      ${Object.entries(game.counts).map(([k, v]) => `${k}=${v}`).join(', ') || '-'}`,
    `가방      ${[...game.items].join(', ') || '-'}`,
    `메모      ${game.notes.size}개`,
    `실패 ${game.stats.fails} · 따름 ${game.stats.obeyed} · ${(game.stats.playMs / 1000).toFixed(0)}초`,
  ].filter(Boolean).join('\n');

  // 버튼은 구성이 바뀔 때만 다시 만들어요(누르는 도중 사라지지 않게)
  const looks = game.looks();
  const key = `${game.mode}|${looks.join()}|${game.paused}`;
  if (key === buttonsKey) return;
  buttonsKey = key;
  buttonsEl.replaceChildren();
  for (const d of looks) button(LOOK_LABEL[d], () => game.look(d));
  if (game.mode === 'live') {
    button('줌 +', () => game.setZoom(game.zoom * 1.3));
    button('줌 −', () => game.setZoom(game.zoom / 1.3));
    if (game.room.tape) button('◀◀ 되감기', () => void game.rewind());
  }
  if (game.mode === 'tape') {
    for (const [label, ev] of TAPE_BTNS) button(label, () => void game.tapeBtn(ev));
    button('■ 돌아가기', () => game.tapeStop());
  }
  button(game.paused ? '계속' : '일시정지', () => game.setPaused(!game.paused));
  button('클릭 영역', () => (game.showSpots = !game.showSpots));
  button('처음부터', () => { Game.clearSave(); location.search = ''; });
}

// ── 돌리기 ──────────────────────────────────────────
function loop(now: number) {
  renderer.draw(game.frame(now));
  if (dirty) { dirty = false; drawDev(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => { if (dirty) { dirty = false; drawDev(); } }, 250); // 창이 가려져 있어도 표시는 갱신

if (!params.has('nopause')) {
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.setPaused(true); });
}

if (params.has('reset')) Game.clearSave();
game.start(params.get('room') ?? undefined).catch((e) => {
  console.error(e);
  statusEl.textContent = `시작하지 못했어요: ${e instanceof Error ? e.message : e}`;
});

// 개발용: 콘솔에서 game 으로 들여다볼 수 있게
Object.assign(window, { game });
