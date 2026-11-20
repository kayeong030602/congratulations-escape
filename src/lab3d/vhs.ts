/**
 * 임시 VHS 필터 — 시험 방에서 "3D가 VHS를 통과하면 실사처럼 보이는가"를 보기 위한 것.
 * 제대로 된 셰이더는 셰이더 단계(Opus 5.5)에서 다시 만들어요. 여기 것은 버려도 돼요.
 *
 * 순서: 3D를 낮은 해상도 화면 한 장(HDR)에 그림 → 이 필터가 그 장을 읽어 화면에 그림.
 */
import * as THREE from 'three';

const FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uRes;
uniform float uTime, uVhs, uExposure;
uniform bool uOn;
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// 캠코더 밝기 반응: 밝은 곳이 부드럽게 날아가요
vec3 tone(vec3 c) { c *= uExposure; return c / (1.0 + c * 0.8); }
vec3 grab(vec2 uv) { return tone(texture2D(tScene, clamp(uv, 0.0, 1.0)).rgb); }
vec3 toYiq(vec3 c) { return vec3(dot(c, vec3(.299, .587, .114)), dot(c, vec3(.596, -.274, -.322)), dot(c, vec3(.211, -.523, .312))); }
vec3 toRgb(vec3 c) { return vec3(c.x + .956 * c.y + .621 * c.z, c.x - .272 * c.y - .647 * c.z, c.x - 1.106 * c.y + 1.703 * c.z); }

void main() {
  vec2 uv = vUv;
  if (!uOn) { gl_FragColor = vec4(pow(clamp(grab(uv), 0.0, 1.0), vec3(1.0 / 2.2)), 1.0); return; }

  float px = 1.0 / uRes.x;
  float line = floor(uv.y * uRes.y);
  float f30 = floor(uTime * 30.0);

  // 줄마다 좌우로 미세하게 떨림
  float jit = (hash(vec2(line, f30)) - 0.5) * px * (0.8 + uVhs);
  // 트래킹 띠: 천천히 흐르는 띠 안에서 크게 밀림
  float band = fract(uv.y * 0.9 + uTime * 0.06);
  band = smoothstep(0.0, 0.015, band) * (1.0 - smoothstep(0.03, 0.07, band));
  jit += band * px * (3.0 + 10.0 * uVhs) * (hash(vec2(line, f30 + 7.0)) - 0.3);
  // 헤드 스위칭: 맨 아래 몇 줄이 옆으로 밀림
  float hs = step(uv.y, 0.02);
  jit += hs * (0.015 + 0.03 * hash(vec2(line, f30 + 3.0)));
  uv.x += jit;

  // 밝기는 비교적 또렷하게, 색은 옆으로 번지게 (VHS는 색 해상도가 낮아요)
  vec3 c0 = toYiq(grab(uv));
  float y = c0.x * 0.5 + toYiq(grab(uv + vec2(px, 0.0))).x * 0.25 + toYiq(grab(uv - vec2(px, 0.0))).x * 0.25;
  y += (c0.x - toYiq(grab(uv - vec2(3.0 * px, 0.0))).x) * 0.12; // 가장자리 메아리
  vec2 iq = vec2(0.0);
  for (int i = -3; i <= 3; i++) iq += toYiq(grab(uv + vec2((float(i) * 2.0 + 2.5) * px, 0.0))).yz;
  iq /= 7.0;
  vec3 col = toRgb(vec3(y, iq * 1.08));

  // 알갱이
  float n = hash(vUv * uRes + fract(uTime) * 91.7);
  col += (n - 0.5) * 0.07 * (0.6 + uVhs);
  // 주사선
  col *= 0.94 + 0.06 * cos(6.2831 * vUv.y * uRes.y * 0.5);
  // 드롭아웃: 가끔 하얀 줄
  float dl = hash(vec2(line * 1.7, floor(uTime * 24.0)));
  if (dl > 0.9982 - 0.002 * uVhs) {
    float sx = hash(vec2(line, floor(uTime * 24.0) + 3.0));
    col = mix(col, vec3(0.92), step(sx, vUv.x) * step(vUv.x, sx + 0.18) * 0.8);
  }
  col = mix(col, vec3(hash(vec2(vUv.x * 80.0, line + f30))), hs * 0.45);
  // 비네트, 뜬 검정, 살짝 따뜻한 색
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.55;
  col = col * 0.94 + 0.035;
  col *= vec3(1.03, 1.0, 0.95);
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export class VhsPass {
  /** 3D를 그려 넣는 낮은 해상도 화면. */
  target: THREE.WebGLRenderTarget;
  on = true;
  strength = 0.35;
  exposure = 1.0;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;

  constructor(w: number, h: number) {
    this.target = VhsPass.makeTarget(w, h);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uRes: { value: new THREE.Vector2(w, h) },
        uTime: { value: 0 },
        uVhs: { value: this.strength },
        uExposure: { value: this.exposure },
        uOn: { value: true },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  private static makeTarget(w: number, h: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, // 밝은 곳(천장등)이 1을 넘어도 담기게
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
  }

  resize(w: number, h: number) {
    this.target.dispose();
    this.target = VhsPass.makeTarget(w, h);
    this.mat.uniforms.tScene.value = this.target.texture;
    (this.mat.uniforms.uRes.value as THREE.Vector2).set(w, h);
  }

  render(renderer: THREE.WebGLRenderer, time: number) {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uVhs.value = this.strength;
    u.uExposure.value = this.exposure;
    u.uOn.value = this.on;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }
}
