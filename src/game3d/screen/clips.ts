/**
 * 전체 화면 영상 — 인트로(타이틀 → LOADING → 에러), 나중에 옛 녹화·엔딩 크레딧.
 *
 * - 영상 요소 2개(앞/뒤)를 번갈아 써요. 다음 영상을 뒤쪽에 미리 올려 두면 넘어갈 때 검은 화면이 안 껴요.
 * - 화면에 직접 그리지 않아요. 지금 영상을 texture로 내주면 캠코더 화면(camcorder.ts)이
 *   3D 대신 그걸 받아 VHS 효과와 함께 그려요. 실제로 재생이 시작되기 전까지는 texture가 없어요(그동안은 원래 화면 그대로).
 * - 소리는 영상에 없어요(소리는 Web Audio로 따로).
 * - (11/17 변경) play()는 영상 재생을 "그 자리에서 바로" 시작해요(기다리지 않음). 아이폰은 화면을 누른 그 순간에
 *   재생을 시작해야 막지 않아서(저전력 모드에선 소리 없는 영상도 막아요), 누름 처리 안에서 play()를 불러요.
 * - 영상이 막히거나 멈춰 버리면: 시작을 못 하면 5초 뒤, 시작했으면 길이 + 1.5초 뒤 끝난 걸로 쳐서 게임이 멈추지 않아요.
 */
import * as THREE from 'three';

interface Slot { v: HTMLVideoElement; tex: THREE.VideoTexture; file: string; ready: Promise<void> | null }

export class Clips {
  private slots: Slot[];
  private front = 0;
  /** 지금 화면에 보이는 영상(재생이 시작된 것). */
  private shown: Slot | null = null;
  private done: (() => void) | null = null;
  private elapsed = 0;
  private started = false;
  private paused = false;

  constructor() {
    this.slots = [0, 1].map(() => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.setAttribute('playsinline', ''); // 앱 속 브라우저(카카오톡 등)에서 전체 화면으로 튀어나가지 않게
      v.setAttribute('webkit-playsinline', '');
      v.preload = 'auto';
      // 화면엔 안 보이지만 문서 안에 있어야 재생되는 브라우저(iOS)가 있어요
      v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
      document.body.append(v);
      const tex = new THREE.VideoTexture(v);
      tex.colorSpace = THREE.NoColorSpace; // 셰이더에서 직접 빛의 세기로 바꿔요(camcorder.ts의 VIDEO)
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      const slot: Slot = { v, tex, file: '', ready: null };
      v.addEventListener('ended', () => { if (slot === this.slots[this.front] && !v.loop) this.finish(); });
      return slot;
    });
  }

  /** 지금 화면에 영상이 보이는가(재생이 실제로 시작됨). */
  get active(): boolean { return !!this.shown; }

  /** 지금 보일 영상 그림(없으면 null). */
  get texture(): THREE.Texture | null { return this.shown?.tex ?? null; }

  private url(file: string) { return `${import.meta.env.BASE_URL}media/${file}`; }

  /** 요소에 파일을 올려요(바로). ready = 첫 프레임이 준비되면(실패해도 멈추지 않게 그냥 끝남). */
  private load(slot: Slot, file: string) {
    slot.file = file;
    slot.ready = new Promise<void>((res) => {
      const v = slot.v;
      const done = () => { v.removeEventListener('loadeddata', done); v.removeEventListener('error', fail); res(); };
      const fail = () => { console.warn(`영상을 못 읽었어요: ${file}`); done(); };
      v.addEventListener('loadeddata', done);
      v.addEventListener('error', fail);
      v.loop = false;
      v.src = this.url(file);
      v.load();
    });
  }

  /** 뒤쪽 요소에 미리 올려 둬요. */
  prepare(file: string): Promise<void> {
    const back = this.slots[1 - this.front];
    if (back.file !== file || !back.ready) this.load(back, file);
    return back.ready!;
  }

  /**
   * 영상을 바로 틀어요(이 함수 안에서 재생을 시작해요 — 아이폰의 "누른 순간" 규칙).
   * loop면 계속 반복(돌아오는 약속은 재생이 시작되면 끝남), 아니면 영상이 끝날 때 끝나요.
   *   onStart = 실제로 재생이 시작된 순간(소리를 같이 시작할 때), then = 시작한 뒤 미리 올려 둘 다음 영상
   */
  play(file: string, o: { loop?: boolean; onStart?: () => void; then?: string } = {}): Promise<void> {
    this.finish(); // 앞에 틀던 영상의 기다림은 끝내요
    const back = this.slots[1 - this.front];
    if (back.file !== file || !back.ready) this.load(back, file);
    this.front = 1 - this.front;
    const s = back;
    s.v.loop = !!o.loop;
    try { if (s.v.readyState >= 1) s.v.currentTime = 0; } catch { /* 아직 길이를 모르면 처음부터 재생돼요 */ }
    this.started = false;
    this.elapsed = 0;

    const begin = () => {
      s.v.removeEventListener('playing', begin);
      if (this.slots[this.front] !== s || this.started) return;
      this.started = true;
      this.elapsed = 0;
      const old = this.shown;
      this.shown = s;
      if (old && old !== s) old.v.pause();
      o.onStart?.();
      if (o.then) {
        const other = this.slots[1 - this.front];
        this.load(other, o.then);
      }
      if (o.loop) this.finish();
    };
    s.v.addEventListener('playing', begin);
    if (!this.paused) void s.v.play().catch(() => { /* 막히면 다음 누름(kick) 때 다시 시도, 그래도 안 되면 5초 뒤 건너뜀 */ });
    return new Promise<void>((res) => { this.done = res; });
  }

  /** 영상을 치우고 3D 화면으로 돌아가요. */
  stop() {
    this.finish();
    for (const s of this.slots) s.v.pause();
    this.shown = null;
    this.started = false;
  }

  /** 일시정지(파란 화면). */
  pause() {
    this.paused = true;
    this.slots[this.front].v.pause();
  }

  resume() {
    this.paused = false;
    if (this.done || this.shown) void this.slots[this.front].v.play().catch(() => {});
  }

  private blessed = false;

  /**
   * (11/20 추가, 폰 점검) 사용자가 누른 그 순간(PLAY ▶)에 불러요: 지금 틀지 않는 영상 요소도 한 번 재생을 시도해 "허락받은 요소"로 만들어 둬요.
   * 아이폰은 저전력 모드(그리고 일부 앱 속 브라우저)에서 누름 없이 시작하는 영상을 소리가 없어도 막는데, 옛 녹화는 손바닥을 누른 다음
   * 프레임에 논리가 틀어서 "누른 순간"이 아니에요. 한 번 누름 안에서 재생을 시도한 요소는 그 뒤로 막지 않아요(사파리 규칙).
   * 재생 시도 바로 뒤에 멈춰요(같은 순간) — 허락은 시도하는 순간 받고, 멈춰 두지 않으면 빈 요소가 "재생 중"으로 남아
   * 나중에 파일을 올리자마자 저절로 틀어져 버려요(그러면 옛 녹화의 시작 신호를 놓쳐요).
   */
  bless() {
    if (this.blessed) return;
    this.blessed = true;
    for (const s of this.slots) {
      if (this.done && s === this.slots[this.front]) continue; // 지금 막 틀기 시작한 인트로는 그대로
      void s.v.play().catch(() => {});
      s.v.pause();
    }
  }

  /** 막힌 재생을 사용자가 누른 순간 다시 시도해요. */
  kick() {
    const v = this.slots[this.front].v;
    if (this.done && !this.paused && v.paused && v.src) void v.play().catch(() => {});
  }

  /** 매 프레임(멈춤 중엔 안 불러요): 영상이 막히거나 멈춰 버렸을 때를 대비한 시계. */
  tick(dt: number) {
    if (!this.done) return;
    this.elapsed += dt;
    const v = this.slots[this.front].v;
    if (!this.started) {
      if (this.elapsed > 5) { console.warn('영상이 시작되지 않아 건너뛰어요'); this.finish(); }
      return;
    }
    if (v.loop) return;
    const len = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 5;
    if (this.elapsed > len + 1.5) this.finish();
  }

  private finish() {
    const d = this.done;
    this.done = null;
    d?.();
  }
}

/**
 * (11/18 추가) 테이프에 끼어든 실사 영상(옛 녹화처럼) — 되감기 재생 위치에 맞춰 그 프레임을 보여 줘요.
 *
 * - 브라우저는 영상을 거꾸로 틀지 못해서, ◀◀·▶▶·❚❚ 땐 그 위치로 건너뛰고(seek),
 *   ▶ 재생·느리게 땐 그 빠르기로 그냥 틀어요(0.25초 넘게 어긋나면 다시 맞춤).
 * - 멈춘 화면에서 프레임을 정확히 읽으려면 영상을 키프레임이 촘촘하게 뽑아 두면 좋아요(소재 뽑기에서 -g를 작게).
 *   폰에서 거꾸로 감을 때 뚝뚝 끊길 수 있지만 되감기 노이즈 띠에 묻혀요.
 * - 소리는 없어요(영상 소리는 원래 안 씀).
 */
export class TapeClip {
  private v: HTMLVideoElement;
  readonly tex: THREE.VideoTexture;
  private file = '';
  private ready = false;

  constructor() {
    const v = (this.v = document.createElement('video'));
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    document.body.append(v);
    this.tex = new THREE.VideoTexture(v);
    this.tex.colorSpace = THREE.NoColorSpace; // Clips와 같게(camcorder.ts의 VIDEO가 직접 바꿔요)
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    v.addEventListener('seeked', () => { this.tex.needsUpdate = true; }); // 멈춘 채 건너뛴 프레임도 바로 보이게
  }

  /**
   * file의 t초를 보여 줘요. speed = 테이프 빠르기(1 재생, 0.25 느리게, 0 멈춤, 그 밖은 건너뛰기).
   * 첫 프레임이 준비되기 전엔 null(그동안은 3D 그대로).
   */
  show(file: string, t: number, speed: number): THREE.Texture | null {
    const v = this.v;
    if (file !== this.file) {
      this.file = file;
      this.ready = false;
      v.addEventListener('loadeddata', () => { if (this.file === file) this.ready = true; }, { once: true });
      v.src = `${import.meta.env.BASE_URL}media/${file}`;
      v.load();
    }
    if (!this.ready) return null;
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
    const tt = Math.max(0, Math.min(dur ? dur - 0.04 : t, t));
    if (speed > 0 && speed <= 1 && (!dur || t < dur - 0.05)) {
      if (v.playbackRate !== speed) v.playbackRate = speed;
      if (v.paused) void v.play().catch(() => { /* 막히면 건너뛰기로 */ });
      if (Math.abs(v.currentTime - tt) > 0.25 && !v.seeking) v.currentTime = tt;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - tt) > 1 / 40 && !v.seeking) v.currentTime = tt;
    }
    return this.tex;
  }

  private blessed = false;

  /** (11/20 추가, 폰 점검) Clips.bless와 같아요 — PLAY ▶를 누른 순간 이 요소도 허락받아 둬요(테이프에서 옛 녹화를 ▶로 볼 때). */
  bless() {
    if (this.blessed) return;
    this.blessed = true;
    void this.v.play().catch(() => {});
    this.v.pause(); // 바로 멈춰 둬요(Clips.bless 설명)
  }

  /** 끼어든 영상 대목을 벗어남. */
  hide() {
    if (!this.v.paused) this.v.pause();
  }
}
