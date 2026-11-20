/**
 * 화면 그리기.
 *
 * 엔진은 매 프레임 "무엇을 어떻게 보여 줄지"를 Frame 하나로 정리해서 렌더러에 넘겨요.
 * 지금은 임시 렌더러(Canvas2DRenderer)로 그려요. 다음 단계에서 같은 Frame을 받는
 * WebGL VHS 셰이더 렌더러로 바꿔 끼우면 돼요(Renderer 인터페이스만 지키면 됨).
 */
import type { Shape } from '../data/schema.ts';

export type Src = HTMLVideoElement | HTMLImageElement;
export type Vec = [number, number];

export interface Frame {
  /** 지금 보여 줄 것 / 직전 것(전환 중일 때만). */
  cur: Src | null;
  old: Src | null;
  /** 전환 진행 0→1. */
  mix: number;
  /** cut 바로 / fade 겹쳐 넘기기 / whip 휙 번지며 넘기기(dir 방향). */
  kind: 'cut' | 'fade' | 'whip';
  dir: Vec;
  /** 줌 배율(1~)과 화면 가운데가 가리키는 이미지 좌표(0~1). */
  zoom: number;
  focus: Vec;
  /** 손떨림 세기 0~1 (정지 이미지일 때 1, 영상은 원래 흔들리니까 0). */
  shake: number;
  /** VHS 노이즈 세기 0~1 (긴장할수록 큼). */
  vhs: number;
  /** 화면 분위기. */
  look: 'live' | 'tape-rew' | 'tape-play' | 'tape-pause' | 'fail' | 'menu';
  /** 누르고 있기 진행 0~1 (아니면 0). */
  hold: number;
  /** 초. 흔들림·노이즈 애니메이션용. */
  time: number;
  /** 개발용: 클릭 영역 테두리. */
  debug?: Shape[];
}

export interface Renderer {
  draw(f: Frame): void;
}

// ── 좌표 변환 (엔진과 렌더러가 같이 써요) ───────────────

/** 손떨림으로 가장자리가 드러나지 않게 늘 3% 확대해서 그려요. */
export const OVERSCAN = 1.03;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 화면 밖이 보이지 않게 focus를 가둬요. */
export function clampFocus(f: Vec, zoom: number): Vec {
  const h = 0.5 / (zoom * OVERSCAN);
  return [clamp(f[0], h, 1 - h), clamp(f[1], h, 1 - h)];
}

/** 화면 좌표(0~1) → 이미지 좌표(0~1). 클릭 판정에 써요. */
export function toImage(p: Vec, zoom: number, focus: Vec): Vec {
  const z = zoom * OVERSCAN;
  return [focus[0] + (p[0] - 0.5) / z, focus[1] + (p[1] - 0.5) / z];
}

/** 이미지 좌표 → 화면 좌표. */
export function toScreen(q: Vec, zoom: number, focus: Vec): Vec {
  const z = zoom * OVERSCAN;
  return [(q[0] - focus[0]) * z + 0.5, (q[1] - focus[1]) * z + 0.5];
}

// ── 임시 렌더러 (셰이더 자리) ─────────────────────────

const ease = (t: number) => t * t * (3 - 2 * t);

export class Canvas2DRenderer implements Renderer {
  private ctx: CanvasRenderingContext2D;
  private W = 960;
  private H = 720;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = this.W;
    canvas.height = this.H;
    this.ctx = canvas.getContext('2d')!;
  }

  draw(f: Frame) {
    const { ctx, W, H } = this;
    ctx.globalAlpha = 1;
    ctx.fillStyle = f.look === 'menu' ? '#0E13B0' : '#000';
    ctx.fillRect(0, 0, W, H);
    if (f.look === 'menu') return;

    // 손떨림: 느린 흔들림 + 빠른 잔떨림
    const t = f.time;
    const sx = f.shake * (0.0045 * Math.sin(t * 0.83 + 1.3) + 0.0025 * Math.sin(t * 2.17) + 0.0007 * Math.sin(t * 7.3));
    const sy = f.shake * (0.004 * Math.sin(t * 0.67) + 0.0022 * Math.sin(t * 1.93 + 0.7) + 0.0007 * Math.sin(t * 8.1 + 2));

    const moving = f.old && f.mix < 1;
    const e = ease(f.mix);
    if (moving && f.kind === 'whip') {
      // 휩팬: 직전 화면이 밀려 나가고 새 화면이 밀려 들어와요 (셰이더에선 번짐을 더함)
      this.blit(f.old!, f, sx, sy, 1, -f.dir[0] * e, -f.dir[1] * e);
      if (f.cur) this.blit(f.cur, f, sx, sy, 1, f.dir[0] * (1 - e), f.dir[1] * (1 - e));
    } else {
      if (moving) this.blit(f.old!, f, sx, sy, 1, 0, 0);
      if (f.cur) this.blit(f.cur, f, sx, sy, moving ? f.mix : 1, 0, 0);
    }
    ctx.globalAlpha = 1;

    this.noise(f);

    if (f.hold > 0) {
      ctx.strokeStyle = ctx.fillStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(W * 0.35, H * 0.9, W * 0.3, 10);
      ctx.fillRect(W * 0.35, H * 0.9, W * 0.3 * f.hold, 10);
    }

    if (f.debug) {
      ctx.strokeStyle = '#ff0';
      ctx.lineWidth = 2;
      for (const s of f.debug) {
        const pts: Vec[] = 'rect' in s
          ? [[s.rect[0], s.rect[1]], [s.rect[0] + s.rect[2], s.rect[1]], [s.rect[0] + s.rect[2], s.rect[1] + s.rect[3]], [s.rect[0], s.rect[1] + s.rect[3]]]
          : s.poly;
        ctx.beginPath();
        pts.forEach((q, i) => {
          const p = toScreen(q, f.zoom, f.focus);
          if (i) ctx.lineTo(p[0] * W, p[1] * H);
          else ctx.moveTo(p[0] * W, p[1] * H);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
  }

  private blit(s: Src, f: Frame, sx: number, sy: number, alpha: number, ox: number, oy: number) {
    const w = s instanceof HTMLVideoElement ? s.videoWidth : s.naturalWidth;
    const h = s instanceof HTMLVideoElement ? s.videoHeight : s.naturalHeight;
    if (!w) return;
    const z = f.zoom * OVERSCAN;
    const half = 0.5 / z;
    const cx = clamp(f.focus[0] + sx, half, 1 - half);
    const cy = clamp(f.focus[1] + sy, half, 1 - half);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(s, (cx - half) * w, (cy - half) * h, w / z, h / z, ox * this.W, oy * this.H, this.W, this.H);
  }

  /** 임시 노이즈. 진짜 VHS 느낌은 셰이더에서 만들어요. */
  private noise(f: Frame) {
    const { ctx, W, H } = this;
    const n = Math.round(f.vhs * 14) + (f.look === 'fail' ? 220 : 0);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 20 + Math.random() * 140, 2);

    if (f.look === 'tape-rew') {
      // 되감기 줄무늬
      for (let i = 0; i < 3; i++) {
        const y = ((f.time * 0.9 + i / 3) % 1) * H;
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(0, y, W, 28);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        for (let k = 0; k < 14; k++) ctx.fillRect(Math.random() * W, y + Math.random() * 28, 30 + Math.random() * 90, 2);
      }
    } else if (f.look === 'tape-pause') {
      // 멈춤 화면 아래쪽 떨리는 띠
      const y = H * 0.86 + Math.sin(f.time * 40) * 3;
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(0, y, W, 18);
    } else if (f.look === 'fail') {
      ctx.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
