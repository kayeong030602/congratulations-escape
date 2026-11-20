/**
 * (11/20 7단계 추가) 끝 화면 — 테이프가 멈춘 뒤의 파란 VCR 화면(번지지 않는 HTML, 화면 전체).
 *   왼쪽: 기록(REC 시간 · 되감은 횟수 · 다시 시작한 횟수) + 음악·소리 출처(CC BY 표기) + 처음부터
 *   오른쪽: 네모 칸 — 맨 위 "LEVEL 0 — 2022.03 ~ 2026.02", 지나온 곳의 원래 이름(취소선) → 뜻하는 말이 한 줄씩 나타나고,
 *   그 아래 "FOUR YEARS. EVERY ROOM WAS COLLEGE."가 타자처럼(사용자 결정 — 대학생활 공개 장면(테이프 라벨·지도) 대신)
 * 공간·캠코더 글씨처럼 영어(VCR 글꼴), 누르는 단추만 한국어.
 */
import { Logic } from './logic.ts';

const ROWS: [string, string][] = [
  ['WHITE ROOM', 'FRESHMAN'],
  ['HALLWAY', 'YOU ARE HERE'],
  ['POST-IT ROOM', "EVERYONE'S ADVICE"],
  ['WARM ROOM', 'THE PEOPLE I MET'],
  ['WINDOW', 'WHAT COMES AFTER?'],
  ['LOCKED DOOR', 'MY OWN KEY'],
  ['STAIRS ×4', '4 YEARS'],
  ['congratulations!', 'GRADUATION'],
];
const LABEL = 'LEVEL 0 — 2022.03 ~ 2026.02';
const LAST = 'FOUR YEARS. EVERY ROOM WAS COLLEGE.';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 걸린 시간: 0:24:13 (캠코더 카운터처럼) */
function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function showEnd(st: { playMs: number; rewinds: number; fails: number }, sound?: (id: string) => void) {
  const el = document.getElementById('end')!;
  el.innerHTML = `
    <div class="end-in">
      <section class="end-left">
        <p class="end-stop">STOP <i></i></p>
        <dl class="end-stats">
          <dt>REC TIME</dt><dd>${hms(st.playMs)}</dd>
          <dt>REWIND</dt><dd>${st.rewinds}</dd>
          <dt>RETRY</dt><dd>${st.fails}</dd>
        </dl>
        <p class="end-credit">MUSIC "BIT SHIFT", "DREAMY FLASHBACK"<br>KEVIN MACLEOD (CC BY 4.0)<br>SOUND "THE GATES OF HEAVEN"<br>JOVICA (CC BY 4.0)</p>
        <button type="button" class="end-again">▶ 처음부터</button>
      </section>
      <section class="end-right">
        <div class="end-box">
          <p class="end-label">${esc(LABEL)}</p>
          ${ROWS.map(([a, b]) => `<p class="end-row"><s>${esc(a)}</s><span>→</span><span>${esc(b)}</span></p>`).join('')}
        </div>
        <p class="end-last"><span></span><i></i></p>
      </section>
    </div>`;
  el.hidden = false;
  el.querySelector('.end-again')!.addEventListener('click', () => {
    Logic.clearSave();
    location.href = location.pathname; // 저장 없이 처음부터(인트로부터)
  });
  // 방 이름 줄이 하나씩 나타난 뒤, 마지막 문구를 한 글자씩
  const rows = [...el.querySelectorAll<HTMLElement>('.end-row')];
  rows.forEach((r, i) => setTimeout(() => { r.classList.add('on'); sound?.('type.space'); }, 1400 + i * 550));
  const out = el.querySelector<HTMLElement>('.end-last span')!;
  const t0 = 1400 + rows.length * 550 + 900;
  [...LAST].forEach((ch, i) => setTimeout(() => {
    out.textContent = LAST.slice(0, i + 1);
    if (ch !== ' ') sound?.(`type.${i % 6}`);
    if (i === LAST.length - 1) sound?.('type.done');
  }, t0 + i * 90));
}
