/**
 * 조작 입력: 마우스·터치·키보드를 게임 조작으로 바꿔요.
 *
 * 마우스/터치  누르기 = 클릭 영역 / 누르고 있기 / 끌기 = 둘러보기(빠르게 휙 = 뒤돌아보기) / 휠 = 줌
 * 키보드      방향키·WASD 둘러보기(S = 뒤돌아보기), +/- 줌, R 되감기(다시 누르면 돌아오기)
 *            테이프 중: ← 되감기, → 빨리 감기, Space 재생/멈춤, L 느리게, . 한 프레임
 *            P 또는 Esc 일시정지, H 클릭 영역 보기(개발용)
 */
import type { LookDir } from '../data/schema.ts';
import type { AudioEngine } from './audio.ts';
import type { Game } from './game.ts';
import type { Vec } from './renderer.ts';

const DRAG = 0.08; // 화면 너비의 8% 넘게 끌면 둘러보기
const FLICK = 2.2; // 1초에 화면 2.2개 속도보다 빠르면 '휙'

export function bindInput(el: HTMLElement, game: Game, audio: AudioEngine) {
  const norm = (e: PointerEvent | WheelEvent): Vec => {
    const r = el.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  let down: { p: Vec; t: number; hold: boolean } | null = null;

  el.addEventListener('pointerdown', (e) => {
    audio.unlock();
    const p = norm(e);
    down = { p, t: performance.now(), hold: game.holdStart(p) };
    el.setPointerCapture(e.pointerId);
  });

  el.addEventListener('pointerup', (e) => {
    if (!down) return;
    const { p: p0, t, hold } = down;
    down = null;
    if (hold) return game.holdEnd();
    const p = norm(e);
    const dx = p[0] - p0[0];
    const dy = p[1] - p0[1];
    const dist = Math.hypot(dx, dy);
    if (dist < DRAG) return game.click(p);
    // 끌기: 화면을 잡아끄는 느낌 → 왼쪽으로 끌면 오른쪽을 봐요
    const speed = dist / Math.max(0.001, (performance.now() - t) / 1000);
    const dir: LookDir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'right' : 'left') : dy < 0 ? 'down' : 'up';
    if (speed > FLICK && Math.abs(dx) > Math.abs(dy) && game.look('back')) return;
    game.look(dir);
  });

  el.addEventListener('pointercancel', () => {
    if (down?.hold) game.holdEnd();
    down = null;
  });

  el.addEventListener('pointermove', (e) => {
    el.style.cursor = game.spotAt(norm(e)) ? 'pointer' : 'default';
  });

  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    game.setZoom(game.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), norm(e));
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.repeat && !['+', '=', '-', '.'].includes(e.key)) return;
    audio.unlock();
    const k = e.key.toLowerCase();

    if (k === 'p' || k === 'escape') return game.setPaused(!game.paused);
    if (k === 'h') return void (game.showSpots = !game.showSpots);

    if (game.mode === 'tape') {
      if (k === 'r') return game.tapeStop();
      if (k === 'arrowleft' || k === 'a') return void game.tapeBtn('REW');
      if (k === 'arrowright' || k === 'd') return void game.tapeBtn('FF');
      if (k === ' ') { e.preventDefault(); return void game.tapeBtn(game.transport === 'play' ? 'PAUSE' : 'PLAY'); }
      if (k === 'l') return void game.tapeBtn('SLOW');
      if (k === '.') return void game.tapeBtn('STEP');
      return;
    }

    if (k === 'r') return void game.rewind();
    if (k === '+' || k === '=') return game.setZoom(game.zoom * 1.15);
    if (k === '-') return game.setZoom(game.zoom / 1.15);
    const dir: LookDir | null =
      k === 'arrowleft' || k === 'a' ? 'left'
      : k === 'arrowright' || k === 'd' ? 'right'
      : k === 'arrowup' || k === 'w' ? 'up'
      : k === 'arrowdown' ? 'down'
      : k === 's' ? 'back' : null;
    if (!dir) return;
    e.preventDefault();
    // ↓에 볼 곳이 없으면 뒤돌아보기로
    if (!game.look(dir) && dir === 'down') game.look('back');
  });
}
