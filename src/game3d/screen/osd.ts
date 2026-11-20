/**
 * 캠코더 화면 글씨(OSD) — REC ●, 배터리, SP, 테이프 카운터, 깜빡이는 12:00, W–T 줌 막대, 초점 괄호.
 *
 * 3D와 같은 낮은 해상도(640×480)의 투명한 그림 한 장에 그려요. 이 장은 VHS 효과를 지나기 전에
 * 3D 화면 위에 찍혀서(camcorder.ts), 글씨도 테이프에 녹화된 것처럼 같이 번지고 흔들려요.
 * 내용이 바뀐 프레임에만 다시 그려서 폰 부담을 줄여요.
 *
 * 글씨는 영어만(공간·캠코더 글씨는 영어, 한국어 알림은 번지지 않는 HTML 층 — CLAUDE.md 결정 6).
 */
import * as THREE from 'three';
import type { Look } from './camcorder.ts';

/** 화면에 띄울 것. 매 프레임 main.ts가 채워요. */
export interface OsdState {
  look: Look;
  /**
   * 파란 화면에 크게 띄울 글씨.
   * (11/19 추가) LOADING = PLAY ▶를 눌렀는데 방을 아직 다 짓지 못해 기다리는 중(점이 하나씩 늘어나며 깜빡여요 — 멈춘 게 아님을 알려요)
   */
  title: 'PLAY' | 'PAUSE' | 'LOADING' | 'STOP'; // (11/20 7단계) STOP = 끝 화면(글씨는 HTML 끝 화면이 그려요)
  /** 테이프 카운터(초). */
  counter: number;
  zoom: number;
  zoomMax: number;
  /** 조준 대상에 맞음 → 초점 괄호가 모여요. */
  aim: boolean;
  /** 누르고 있기·읽기 진행 0~1. */
  gauge: number;
  /** 잠깐 띄우는 글씨(방 데이터의 osd 행동). */
  text: string;
  /**
   * (11/17 추가) 무엇을 띄울지. cam = 캠코더 글씨(기본), none = 아무것도(인트로, 옛 녹화 같은 전체 화면 영상).
   * 파란 화면(시작 PLAY ▶ / 멈춤 PAUSE)은 look이 menu일 때 늘 그려요.
   */
  mode?: 'cam' | 'none';
  /**
   * (11/20 7단계 추가) 엔딩 타자 글씨: 있으면 캠코더 글씨 대신 화면 가운데에 검은 VCR 글씨 + 깜빡이는 네모 커서(영상 01:46~ 그대로).
   * lines = 줄들(마지막 줄은 앞에서 n글자까지만), sizes = 줄마다 글씨 크기(640×480 기준 px)
   */
  type?: { lines: string[]; sizes: number[]; n: number } | null;
}

/**
 * 자리(화면 너비·높이에 대한 비율). 줌 막대는 폰에서 손가락으로 밀어야 해서
 * main.ts가 같은 자리에 보이지 않는 터치 영역을 둬요.
 */
export const LAYOUT = {
  left: 0.075,
  right: 0.925,
  top: 0.105,
  bottom: 0.885,
  zoom: { x0: 0.135, x1: 0.335 },
};

const RED = '#ff2a1f';
const FONT = 'VCR';
let fontReady: Promise<void> | null = null;

/** 글꼴 VCR OSD Mono를 한 번만 불러와요. */
function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    try {
      const face = new FontFace(FONT, `url(${import.meta.env.BASE_URL}fonts/VCR_OSD_MONO.ttf)`);
      document.fonts.add(await face.load());
    } catch (e) {
      console.warn('OSD 글꼴을 못 불러왔어요. 기본 글꼴로 그려요.', e);
    }
  })();
  return fontReady;
}

export class Osd {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private ready = false;
  private last = '';
  /** 초점 괄호가 모인 정도(0 = 벌어짐, 1 = 모임). */
  private aimK = 0;

  constructor(w: number, h: number) {
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.resize(w, h);
    void loadFont().then(() => { this.ready = true; this.last = ''; });
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose(); // 크기가 바뀌면 GPU 쪽도 새로 만들어요
    this.last = '';
  }

  private dots = 0; // (11/19 추가) LOADING 뒤 점 개수

  /** time = 실제 흐른 시간(초, 깜빡임용), dt = 이번 프레임 길이. */
  update(s: OsdState, time: number, dt: number) {
    this.aimK += ((s.aim ? 1 : 0) - this.aimK) * Math.min(1, dt * 14);
    if (Math.abs(this.aimK - (s.aim ? 1 : 0)) < 0.01) this.aimK = s.aim ? 1 : 0;
    const recOn = time % 1.6 < 1.1;
    const clockOn = Math.floor(time) % 2 === 0;
    const dots = Math.floor(time * 2.5) % 4; // LOADING 뒤의 점 0~3개
    this.dots = dots;
    const key = [
      this.ready, s.look, s.mode, s.title, s.title === 'LOADING' ? dots : 0, recOn, clockOn, Math.floor(s.counter), s.zoom.toFixed(3), s.zoomMax,
      this.aimK.toFixed(2), s.gauge.toFixed(2), s.text, this.canvas.width,
      s.type ? `${s.type.lines.join('/')}#${s.type.n}#${time % 1.06 < 0.53}` : '', // (11/20 7단계) 타자 글씨와 커서 깜빡임
    ].join('|');
    if (key === this.last) return;
    this.last = key;
    this.draw(s, recOn, clockOn, time);
    this.texture.needsUpdate = true;
  }

  // ── 그리기 ─────────────────────────────────────────

  /**
   * (11/20 7단계 추가) 엔딩 타자 글씨: 줄 묶음을 화면 가운데에. 줄마다 다 친 모습 기준으로 가운데 정렬하고, 글자는 왼쪽부터 제자리에 나타나요.
   * 커서(검은 네모)는 마지막 글자 바로 뒤에서 깜빡여요. 줄이 없으면 화면 정가운데에 커서만(하얀 공간에 떠 있는 검은 점)
   */
  private typed(t: NonNullable<OsdState['type']>, k: number, time: number) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const INK = '#141414';
    const sizes = t.lines.map((_, i) => Math.round((t.sizes[i] ?? 26) * k));
    const gaps = sizes.map((s) => s * 1.55);
    const total = gaps.reduce((a, b) => a + b, 0);
    let y = H / 2 - total / 2;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillStyle = INK;
    let cx = W / 2, cy = H / 2, cs = Math.round(26 * k);
    t.lines.forEach((line, i) => {
      const size = sizes[i];
      c.font = `${size}px ${FONT}`;
      const yy = y + gaps[i] / 2;
      const x0 = W / 2 - c.measureText(line).width / 2;
      const shown = i === t.lines.length - 1 ? line.slice(0, t.n) : line;
      // (11/20 2차, 사용자 의견: 글씨가 더 두꺼워야) VCR 글꼴엔 굵은 글씨가 없어서 같은 색 테두리를 둘러 두껍게
      c.lineWidth = Math.max(0.8, size * 0.05); // (11/20 3차, 사용자 의견: 너무 두꺼움) 0.11 → 0.05
      c.lineJoin = 'miter';
      c.strokeStyle = INK;
      c.strokeText(shown, x0, yy);
      c.fillText(shown, x0, yy);
      if (i === t.lines.length - 1) { cx = x0 + c.measureText(shown).width + size * 0.08; cy = yy; cs = size; }
      y += gaps[i];
    });
    if (time % 1.06 < 0.53) {
      const w = cs * 0.55, h = cs * 0.95;
      c.fillRect(t.lines.length ? cx : W / 2 - w / 2, cy - h / 2, w, h);
    }
  }

  private draw(s: OsdState, recOn: boolean, clockOn: boolean, time: number) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height;
    const k = H / 480; // 640×480 기준 크기
    c.clearRect(0, 0, W, H);
    if (!this.ready) return;
    c.lineJoin = 'round';
    c.textBaseline = 'middle';

    const L = LAYOUT.left * W, R = LAYOUT.right * W, T = LAYOUT.top * H, B = LAYOUT.bottom * H;
    const size = Math.round(24 * k);

    if (s.look === 'menu') {
      // 파란 VCR 화면: 가운데에 크게 PLAY ▶ / PAUSE ❚❚
      const big = Math.round(46 * k);
      const label = s.title;
      if (label === 'LOADING') {
        // (11/19 추가) 기다리는 중: LOADING + 점(0~3개).
        // (11/19 6차 변경, 사용자 의견) 화면 정가운데: LOADING 글자가 가로·세로 한가운데에 오고, 점은 그 오른쪽으로 늘어나요(글자는 안 흔들림)
        c.font = `${big}px ${FONT}`;
        const word = c.measureText('LOADING').width;
        this.text('LOADING' + '.'.repeat(this.dots), W / 2 - word / 2, H * 0.5, 'left', big);
        return;
      }
      if (label === 'STOP') return; // (11/20 7단계) 끝 화면은 HTML(end.ts)
      c.font = `${big}px ${FONT}`;
      const tw = c.measureText(label).width;
      const icon = big * 0.8, gap = big * 0.45;
      const x0 = W / 2 - (tw + gap + icon) / 2, y = H * 0.4;
      this.text(label, x0, y, 'left', big);
      if (label === 'PLAY') this.play(x0 + tw + gap, y, icon);
      else this.pause(x0 + tw + gap, y, icon);
      return;
    }
    if (s.mode === 'none') return;
    if (s.type) return this.typed(s.type, k, time);

    // 왼쪽 위: REC ● (테이프를 볼 때는 ◀◀ REW 같은 재생 표시)
    const tape: Partial<Record<Look, string>> = { rew: 'REW', play: 'PLAY', slow: 'SLOW', pause: 'PAUSE', ff: 'FF' };
    const t = tape[s.look];
    if (t) {
      const icon = size * 0.8;
      if (s.look === 'rew') this.rew(L, T, icon);
      else if (s.look === 'ff') this.ff(L, T, icon);
      else if (s.look === 'pause') this.pause(L, T, icon);
      else this.play(L, T, icon);
      this.text(t, L + icon * (s.look === 'rew' || s.look === 'ff' ? 1.8 : 1.15) + size * 0.3, T, 'left', size);
    } else {
      this.text('REC', L, T, 'left', size);
      if (recOn) this.dot(L + c.measureText('REC').width + size * 0.65, T, size * 0.3);
    }

    // 오른쪽 위: 배터리 · SP, 그 아래 테이프 카운터
    c.font = `${size}px ${FONT}`;
    const spW = c.measureText('SP').width;
    this.text('SP', R, T, 'right', size);
    this.battery(R - spW - size * 0.5, T, size, 3);
    this.text(counter(s.counter), R, T + size * 1.25, 'right', size);

    // 오른쪽 아래: 시계를 안 맞춘 캠코더의 깜빡이는 12:00. (11/18 변경) 테이프를 볼 때는 숨겨요(카운터만 — 폰 버튼 줄과 겹치지 않게)
    if (clockOn && !t) this.text('12:00', R, B, 'right', size);

    // 왼쪽 아래: W ━━━━ T 줌 막대. (11/18 변경) 테이프를 볼 때는 안 그려요(재생 중엔 줌을 못 바꿔요 — 그 자리에 폰 버튼 줄이 와요)
    const lw = Math.max(2, Math.round(2 * k));
    if (!t) {
      const zx0 = LAYOUT.zoom.x0 * W, zx1 = LAYOUT.zoom.x1 * W;
      this.text('W', zx0 - size * 0.55, B, 'right', size);
      this.text('T', zx1 + size * 0.55, B, 'left', size);
      const zk = s.zoomMax > 1 ? Math.max(0, Math.min(1, (s.zoom - 1) / (s.zoomMax - 1))) : 0;
      this.box(zx0, B - lw / 2, zx1 - zx0, lw);
      const tick = Math.max(3, Math.round(4 * k));
      this.box(zx0 + (zx1 - zx0 - tick) * zk, B - size * 0.32, tick, size * 0.64);
    }

    // 가운데: 초점 괄호(조준하면 모임) + 누르고 있기·읽기 진행
    this.brackets(W / 2, H / 2, W * 0.12, this.aimK, k);
    if (s.gauge > 0.001) {
      // 흐린 바탕 줄 위로 흰 막대가 차올라요
      const bw = W * 0.12, gy = H / 2 + bw * 0.375 + size * 0.55, gh = Math.max(3, Math.round(3 * k));
      c.fillStyle = 'rgba(0,0,0,0.45)';
      c.fillRect(W / 2 - bw / 2 - 1, gy - 1, bw + 2, gh + 2);
      this.box(W / 2 - bw / 2, gy, bw * s.gauge, gh);
    }

    // 잠깐 띄우는 글씨
    if (s.text) this.text(s.text, W / 2, H * 0.2, 'center', size);
  }

  /** 흰 글씨 + 검은 테두리(캠코더 글씨처럼 어디서나 읽히게). */
  private text(str: string, x: number, y: number, align: CanvasTextAlign, size: number) {
    const c = this.ctx;
    c.font = `${size}px ${FONT}`;
    c.textAlign = align;
    c.lineWidth = Math.max(2, size * 0.16);
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.strokeText(str, x, y);
    c.fillStyle = '#fff';
    c.fillText(str, x, y);
  }

  /** 흰 네모 + 검은 테두리. */
  private box(x: number, y: number, w: number, h: number) {
    const c = this.ctx, e = Math.max(1, h * 0.35);
    c.fillStyle = 'rgba(0,0,0,0.5)';
    c.fillRect(x - e, y - e, w + e * 2, h + e * 2);
    c.fillStyle = '#fff';
    c.fillRect(x, y, w, h);
  }

  private shape(draw: (c: CanvasRenderingContext2D) => void, fill = '#fff') {
    const c = this.ctx;
    c.beginPath();
    draw(c);
    c.lineWidth = Math.max(2, this.canvas.height / 160);
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.stroke();
    c.fillStyle = fill;
    c.fill();
  }

  private dot(x: number, y: number, r: number) {
    this.shape((c) => c.arc(x, y, r, 0, Math.PI * 2), RED);
  }

  /** ▶ (x = 왼쪽 끝, y = 가운데, s = 높이) */
  private play(x: number, y: number, s: number) {
    this.shape((c) => { c.moveTo(x, y - s / 2); c.lineTo(x + s * 0.85, y); c.lineTo(x, y + s / 2); c.closePath(); });
  }

  /** ❚❚ */
  private pause(x: number, y: number, s: number) {
    this.shape((c) => { c.rect(x, y - s / 2, s * 0.3, s); c.rect(x + s * 0.5, y - s / 2, s * 0.3, s); });
  }

  /** ◀◀ */
  private rew(x: number, y: number, s: number) {
    this.shape((c) => {
      for (const o of [0, s * 0.8]) { c.moveTo(x + o + s * 0.8, y - s / 2); c.lineTo(x + o, y); c.lineTo(x + o + s * 0.8, y + s / 2); c.closePath(); }
    });
  }

  /** ▶▶ */
  private ff(x: number, y: number, s: number) {
    this.shape((c) => {
      for (const o of [0, s * 0.8]) { c.moveTo(x + o, y - s / 2); c.lineTo(x + o + s * 0.8, y); c.lineTo(x + o, y + s / 2); c.closePath(); }
    });
  }

  /** 배터리 그림(x = 오른쪽 끝, y = 가운데). bars = 남은 칸(4칸 중). */
  private battery(xr: number, y: number, size: number, bars: number) {
    const c = this.ctx;
    const w = size * 1.5, h = size * 0.62, lw = Math.max(2, size / 12);
    const x = xr - w;
    const nub = size * 0.12;
    c.fillStyle = 'rgba(0,0,0,0.55)';
    c.fillRect(x - nub - lw * 2, y - h / 2 - lw, w + nub + lw * 3, h + lw * 2);
    c.strokeStyle = '#fff';
    c.lineWidth = lw;
    c.strokeRect(x + lw / 2, y - h / 2 + lw / 2, w - lw, h - lw);
    c.fillStyle = '#fff';
    c.fillRect(x - nub, y - h * 0.2, nub, h * 0.4); // 볼록한 끝(왼쪽)
    const inner = w - lw * 4, bw = inner / 4;
    for (let i = 0; i < bars; i++) c.fillRect(x + w - lw * 2 - bw * (i + 1) + bw * 0.12, y - h / 2 + lw * 2, bw * 0.76, h - lw * 4);
  }

  /** 초점 괄호: 네 귀퉁이. k = 모인 정도. */
  private brackets(cx: number, cy: number, w0: number, k: number, px: number) {
    const c = this.ctx;
    const sc = 1.5 - 0.5 * k;
    const w = w0 * sc, h = w0 * 0.75 * sc;
    const a = 0.5 + 0.5 * k;
    const lx = w * 0.22, ly = h * 0.28, lw = Math.max(2, Math.round(2 * px));
    const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
    // 귀퉁이마다 가로·세로 두 막대. 테두리를 먼저 다 그리고 흰 막대를 얹어야 꺾인 곳이 안 끊겨요
    const bars: [number, number, number, number][] = [];
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
      bars.push([sx > 0 ? x : x - lx, sy > 0 ? y : y - lw, lx, lw]);
      bars.push([sx > 0 ? x : x - lw, sy > 0 ? y : y - ly, lw, ly]);
    }
    const e = Math.max(1, lw * 0.35);
    c.globalAlpha = a;
    c.fillStyle = 'rgba(0,0,0,0.5)';
    for (const [x, y, bw, bh] of bars) c.fillRect(x - e, y - e, bw + e * 2, bh + e * 2);
    c.fillStyle = '#fff';
    for (const [x, y, bw, bh] of bars) c.fillRect(x, y, bw, bh);
    c.globalAlpha = 1;
  }
}

/** 테이프 카운터 글씨: 0:00:23 */
function counter(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
