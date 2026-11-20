/**
 * 시험 방 데이터 — 통로 한 칸.
 *
 * 계획서(docs/PIVOT_3D_PLAN.md 2.2)의 "상자 조립 데이터"를 그대로 써 본 거예요.
 * 단위는 미터. 가운데 숫자가 높이(y). 카메라는 처음에 -z 쪽을 봐요.
 *
 *            z=-6 ┌──────────── 주황 벽 ────────────┐
 *                 │  본 통로 끝      옆 통로         ┊ ← 점선 벽(x=5)
 *          z=-4.2 │        ┌■ 초록 기둥 ────────────┘
 *                 │        │
 *   안내판(왼쪽 벽)│        │
 *                 │        │
 *             z=5 └────────┘   ← 시작(등 뒤는 막힌 벽)
 *               x=-0.9   x=0.9
 */

export type V3 = [number, number, number];
// (11/17 추가) speckle = 점박이 흰 판(본 게임 포스트잇의 방 앞벽 — 영상의 and you? 장면)
// (11/19 추가) beige = 따뜻한 방 벽, wood = 갈색 문, gray = 창밖 복도 벽, metal = 창살·문틀
// (11/19 본 게임 6단계 추가) olive = 계단실 벽(영상의 어두운 올리브색), terrazzo = 계단·계단참 바닥(흰 바탕에 잔 돌 조각)
// (11/20 본 게임 6단계 2차 추가) block = 계단실 벽: 차가운 흰색 페인트를 칠한 시멘트 블록(사용자 의견: 초록 말고 더 섬뜩한 색)
export type MatId = 'white' | 'orange' | 'green' | 'carpet' | 'ceiling' | 'base' | 'speckle' | 'beige' | 'wood' | 'gray' | 'metal' | 'olive' | 'terrazzo' | 'block';

export interface Box {
  id: string;
  at: V3;       // 가운데
  size: V3;     // 가로(x), 높이(y), 세로(z)
  mat: MatId;
  solid?: boolean; // 기본 true: 지나갈 수 없고 빛을 가려요. 걸레받이 같은 장식은 false
  /** (11/19 본 게임 6단계 추가) 보이지 않는 벽: 지나갈 수만 없고, 그리지도·빛을 가리지도 않아요(끝없는 복도 앞) */
  ghost?: true;
  /**
   * (11/20 본 게임 6단계 추가) 밟고 지나가는 상자(계단 한 칸·계단참 바닥): 그려지고 빛도 가리지만 부딪히지 않고,
   * 윗면이 그 자리의 바닥 높이가 돼요(걷는 몸이 무릎 높이 45cm까지는 밟고 올라감 — walker.ts). 그보다 높으면 벽처럼 막아요.
   */
  walk?: true;
}

/** 천장등: 아래를 향한 네모 조명. hide = 빛만 있고 등은 안 보임(본 게임의 하얀 방처럼 빛이 어디서 오는지 모르는 곳). */
export interface Lamp { at: V3; size: [number, number]; power: number; color: string; hide?: boolean; round?: boolean } // (11/17 추가) round = 둥근 등(지름 = size[0])

/** 조준 대상(지금 엔진의 클릭 영역 자리). */
export interface Target { id: string; at: V3; size: V3; on: 'zoom'; minZoom: number; maxDist: number }

/** 바닥 영역: 들어서면 일이 일어나요. */
export interface Zone { id: string; at: V3; size: V3 }

export interface Space {
  spawn: { at: V3; yaw: number };
  boxes: Box[];
  lamps: Lamp[];
  targets: Target[];
  zones: Zone[];
}

const H = 2.6;        // 천장 높이
const Y = H / 2;
const WARM = '#fff3dc';

/** 벽 아래 걸레받이(높이 10cm). */
const base = (id: string, at: [number, number], size: [number, number]): Box => ({
  id, at: [at[0], 0.05, at[1]], size: [size[0], 0.1, size[1]], mat: 'base', solid: false,
});

export const corridor: Space = {
  spawn: { at: [0, 0, 4.2], yaw: 0 },

  boxes: [
    // 바닥·천장 (본 통로 + 옆 통로)
    { id: 'floor-main', at: [0, -0.1, -0.5], size: [2.2, 0.2, 11.4], mat: 'carpet' },
    { id: 'floor-side', at: [3.15, -0.1, -5.2], size: [4.1, 0.2, 2.0], mat: 'carpet' },
    { id: 'ceil-main', at: [0, H + 0.1, -0.5], size: [2.2, 0.2, 11.4], mat: 'ceiling' },
    { id: 'ceil-side', at: [3.15, H + 0.1, -5.2], size: [4.1, 0.2, 2.0], mat: 'ceiling' },

    // 벽
    { id: 'wall-left', at: [-1.0, Y, -0.5], size: [0.2, H, 11.4], mat: 'white' },
    { id: 'wall-back', at: [0, Y, 5.1], size: [1.8, H, 0.2], mat: 'white' },
    { id: 'wall-right', at: [1.0, Y, 0.8], size: [0.2, H, 8.8], mat: 'white' },
    { id: 'wall-end', at: [2.15, Y, -6.1], size: [6.1, H, 0.2], mat: 'orange' },
    { id: 'wall-side', at: [3.175, Y, -4.1], size: [4.05, H, 0.2], mat: 'white' },
    { id: 'wall-dotted', at: [5.1, Y, -5.1], size: [0.2, H, 1.8], mat: 'white' },

    // 모퉁이의 초록 기둥 (통로 쪽으로 25cm 튀어나옴)
    { id: 'pillar', at: [0.9, Y, -3.9], size: [0.5, H, 0.6], mat: 'green' },

    // 걸레받이
    base('bb-left', [-0.892, -0.5], [0.016, 11.0]),
    base('bb-right', [0.892, 0.8], [0.016, 8.8]),
    base('bb-back', [0, 4.992], [1.8, 0.016]),
    base('bb-end', [2.05, -5.992], [5.9, 0.016]),
    base('bb-side', [3.075, -4.208], [3.85, 0.016]),
    base('bb-dotted', [4.992, -5.1], [0.016, 1.8]),
  ],

  lamps: [
    { at: [0, H - 0.02, 3.4], size: [0.6, 0.3], power: 6, color: WARM },
    { at: [0, H - 0.02, 0.5], size: [0.6, 0.3], power: 6, color: WARM },
    { at: [0, H - 0.02, -2.4], size: [0.6, 0.3], power: 6, color: WARM },
    { at: [0, H - 0.02, -5.1], size: [0.6, 0.3], power: 6, color: WARM },
    { at: [3.3, H - 0.02, -5.1], size: [0.3, 0.6], power: 5, color: WARM },
  ],

  targets: [
    { id: 'sign', at: [-0.88, 1.5, 1.0], size: [0.08, 0.66, 0.92], on: 'zoom', minZoom: 1.8, maxDist: 5 },
  ],

  zones: [
    { id: 'dotted-wall', at: [4.5, 1, -5.1], size: [0.9, 2, 1.8] },
  ],
};

/** 안내판과 점선 문 자리(평면 한 장씩). */
export const SIGN = { at: [-0.897, 1.5, 1.0] as V3, size: [0.9, 0.646] as [number, number] };
export const DOTTED = { at: [4.996, 1.02, -5.1] as V3, size: [0.9, 2.04] as [number, number] };
