/**
 * 3D 시험 방 — 풀 3D로 가도 되는지 눈으로 확인하기 위한 통로 한 칸.
 * 주소: http://localhost:5173/lab3d.html   (본 게임 코드는 건드리지 않아요)
 *
 * 볼 것: ① VHS를 통과한 3D가 실사처럼 보이는가  ② 걷는 느낌·손떨림  ③ 조준해서 줌으로 읽기
 * 비교 키: V = VHS 끄기/켜기, G = 구운 조명 끄기/켜기
 */
import * as THREE from 'three';
import { game as data } from '../data/game.ts';
import { AudioEngine } from '../engine/audio.ts';
import { buildSpace } from './build.ts';
import { DOTTED, SIGN, corridor, type V3 } from './room.ts';
import { dottedTexture } from './textures.ts';
import { VhsPass } from './vhs.ts';
import { Walker } from './walker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage'), canvas = $<HTMLCanvasElement>('screen'), startEl = $('start');
const recEl = $('rec'), focusEl = $('focus'), msgEl = $('msg'), zoomDot = $('zoomDot'), statEl = $('stat');

const FOV = 52;      // 세로 화각(도). 영상의 휴대폰 카메라와 비슷하게
const ZOOM_MAX = 3;

// ── 3D 세계 ─────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.05, 60);

const built = buildSpace(corridor);
scene.add(built.root);

const lightAt = (p: V3, n: V3, u: V3, v: V3) => new THREE.Color(...built.baker.light(p, n, u, v));

// 안내판(원본 디자인 그림) — 왼쪽 벽, 통로 쪽(+x)을 봄
const signTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}lab3d/sign.webp`);
signTex.colorSpace = THREE.SRGBColorSpace;
signTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const sign = new THREE.Mesh(
  new THREE.PlaneGeometry(...SIGN.size),
  new THREE.MeshBasicMaterial({ map: signTex, color: lightAt(SIGN.at, [1, 0, 0], [0, 0, -1], [0, 1, 0]) }),
);
sign.position.set(...SIGN.at);
sign.rotation.y = Math.PI / 2;
scene.add(sign);

// 점선 문 자리 — 안내판을 읽은 뒤에만 보여요(모퉁이 너머라 안 보는 사이에 생김)
const dotted = new THREE.Mesh(
  new THREE.PlaneGeometry(...DOTTED.size),
  new THREE.MeshBasicMaterial({ map: dottedTexture(), transparent: true, color: lightAt(DOTTED.at, [-1, 0, 0], [0, 0, 1], [0, 1, 0]) }),
);
dotted.position.set(...DOTTED.at);
dotted.rotation.y = -Math.PI / 2;
dotted.visible = false;
scene.add(dotted);

const walker = new Walker(built.rects);
walker.place(corridor.spawn.at[0], corridor.spawn.at[2], corridor.spawn.yaw);

let resH = 480;
const vhs = new VhsPass((resH * 4) / 3, resH);

// ── 상태 ────────────────────────────────────────────
const flags = new Set<string>();
let zoom = 1, zoomCur = 1;
let aimed: string | null = null;
let dwell = 0;
let msgUntil = 0;
let time = 0;
let fps = 0;
let drawCalls = 0;

function say(text: string, ms = 4000) {
  msgEl.textContent = text;
  msgUntil = performance.now() + ms;
}

// ── 조준 판정: 화면 가운데에서 선을 쏴서 처음 닿는 대상 ──
const dirV = new THREE.Vector3();
function findAim(): string | null {
  camera.getWorldDirection(dirV);
  const o: V3 = [camera.position.x, camera.position.y, camera.position.z];
  const d: V3 = [dirV.x, dirV.y, dirV.z];
  for (const t of corridor.targets) {
    const box = {
      min: [t.at[0] - t.size[0] / 2, t.at[1] - t.size[1] / 2, t.at[2] - t.size[2] / 2] as V3,
      max: [t.at[0] + t.size[0] / 2, t.at[1] + t.size[1] / 2, t.at[2] + t.size[2] / 2] as V3,
    };
    const dist = built.baker.rayBox(o, d, box, t.maxDist);
    if (dist === Infinity) continue;
    if (built.baker.nearest(o, d, dist) < dist - 0.06) continue; // 벽에 가려짐
    return t.id;
  }
  return null;
}

function logic(dt: number) {
  aimed = findAim();
  const target = corridor.targets.find((t) => t.id === aimed);
  if (target && zoomCur >= target.minZoom && !flags.has(`${target.id}Read`)) {
    dwell += dt;
    if (dwell > 0.5) {
      flags.add(`${target.id}Read`);
      dotted.visible = true;
      say('안내판을 읽었어요 → 통로 끝에서 오른쪽 모퉁이를 돌아 보세요', 6000);
    }
  } else dwell = 0;

  for (const z of corridor.zones) {
    const inside = Math.abs(walker.x - z.at[0]) < z.size[0] / 2 && Math.abs(walker.z - z.at[2]) < z.size[2] / 2;
    const key = `in:${z.id}`;
    if (inside && !flags.has(key)) {
      flags.add(key);
      say(flags.has('signRead')
        ? '점선 벽에 닿았어요 — 본 게임에서는 여기서 다음 방으로 넘어가요 (시험 방은 여기까지)'
        : '아직 아무 일도 없어요. 안내판을 먼저 읽어 보세요(조준 + 줌)', 6000);
    } else if (!inside) flags.delete(key);
  }
}

// ── 입력 ────────────────────────────────────────────
const keys = new Set<string>();
const stick = { id: -1, x0: 0, y0: 0, fwd: 0, side: 0 };
const look = { id: -1, x: 0, y: 0 };
let audio: AudioEngine | null = null;

function begin() {
  startEl.hidden = true;
  if (!audio) {
    audio = new AudioEngine(data.sounds);
    void audio.load(['hum']).then(() => audio!.setAmb('hum')).catch((e) => console.warn(e));
  }
  audio.unlock();
}

startEl.addEventListener('pointerdown', (e) => {
  begin();
  if (e.pointerType === 'mouse') void canvas.requestPointerLock();
});
canvas.addEventListener('click', () => {
  if (document.pointerLockElement !== canvas) void canvas.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  // Esc로 잠금이 풀리면 시작 화면(= 나중의 일시정지 화면)으로
  if (document.pointerLockElement !== canvas && matchMedia('(pointer: fine)').matches) startEl.hidden = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  const s = 0.0022 / zoomCur; // 줌을 당기면 시선이 천천히 움직여요
  walker.turn(e.movementX * s, e.movementY * s);
});
addEventListener('wheel', (e) => {
  zoom = Math.max(1, Math.min(ZOOM_MAX, zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: true });
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyV') vhs.on = !vhs.on;
  if (e.code === 'KeyG') { baked = !baked; built.setBaked(baked); }
  if (e.code === 'KeyB') walker.shake = walker.shake ? 0 : 1;
  if (e.code === 'Digit1') setRes(480);
  if (e.code === 'Digit2') setRes(720);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') zoom = Math.min(ZOOM_MAX, zoom * 1.25);
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoom = Math.max(1, zoom / 1.25);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let baked = true;

// 터치: 왼쪽 절반 = 걷기 조이스틱, 오른쪽 절반 = 둘러보기
stage.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  begin();
  const r = stage.getBoundingClientRect();
  if (e.clientX < r.left + r.width / 2 && stick.id < 0) Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, fwd: 0, side: 0 });
  else if (look.id < 0) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
});
stage.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    stick.side = Math.max(-1, Math.min(1, (e.clientX - stick.x0) / 50));
    stick.fwd = Math.max(-1, Math.min(1, (stick.y0 - e.clientY) / 50));
  } else if (e.pointerId === look.id) {
    walker.turn(((e.clientX - look.x) * 0.005) / zoomCur, ((e.clientY - look.y) * 0.005) / zoomCur);
    look.x = e.clientX; look.y = e.clientY;
  }
});
const lift = (e: PointerEvent) => {
  if (e.pointerId === stick.id) Object.assign(stick, { id: -1, fwd: 0, side: 0 });
  if (e.pointerId === look.id) look.id = -1;
};
stage.addEventListener('pointerup', lift);
stage.addEventListener('pointercancel', lift);

// ── 화면 크기 ───────────────────────────────────────
function setRes(h: number) {
  resH = h;
  vhs.resize((h * 4) / 3, h);
}
function fit() {
  const w = Math.min(innerWidth, (innerHeight * 4) / 3);
  stage.style.width = `${w}px`;
  stage.style.height = `${(w * 3) / 4}px`;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setSize(Math.round(w * dpr), Math.round(((w * 3) / 4) * dpr), false);
}
addEventListener('resize', fit);
fit();

// ── 돌리기 ──────────────────────────────────────────
function step(dt: number) {
  time += dt;
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + stick.fwd;
  const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + stick.side;
  walker.update(dt, fwd, side);
  zoomCur += (zoom - zoomCur) * Math.min(1, dt * 8);
  camera.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) / zoomCur) * 180) / Math.PI;
  camera.updateProjectionMatrix();
  walker.apply(camera, time);
  camera.updateMatrixWorld();
  logic(dt);

  renderer.setRenderTarget(vhs.target);
  renderer.render(scene, camera);
  drawCalls = renderer.info.render.calls;
  vhs.render(renderer, time);

  // 캠코더 표시
  recEl.classList.toggle('off', time % 1.6 > 1.1);
  focusEl.classList.toggle('on', !!aimed);
  zoomDot.style.left = `${((zoomCur - 1) / (ZOOM_MAX - 1)) * 100}%`;
  if (msgUntil && performance.now() > msgUntil) { msgEl.textContent = ''; msgUntil = 0; }
}

let last = performance.now();
let statAt = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  step(dt);
  if (now > statAt) {
    statAt = now + 500;
    const s = built.stats;
    statEl.textContent =
      `${fps.toFixed(0)}fps · 내부 ${(resH * 4) / 3}×${resH} · VHS ${vhs.on ? '켜짐' : '꺼짐'} · 구운 조명 ${baked ? '켜짐' : '꺼짐'}\n` +
      `삼각형 ${s.tris} · 꼭짓점 ${s.verts} · 그리기 ${drawCalls}회 · 조명 굽기 ${s.bakeMs}ms\n` +
      `위치 ${walker.x.toFixed(2)}, ${walker.z.toFixed(2)} · 줌 ${zoomCur.toFixed(2)} · 조준 ${aimed ?? '-'} · ${[...flags].join(' ') || '-'}`;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// 개발용: 콘솔·자동 시험에서 쓰는 손잡이
Object.assign(window, {
  lab: {
    walker, vhs, built, flags, camera, renderer,
    step,
    setZoom: (z: number) => { zoom = zoomCur = z; },
    keys,
  },
});
