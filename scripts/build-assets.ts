/**
 * 소재 뽑기 스크립트. 사용법:
 *   npm run assets            새로 생긴 줄만 뽑기
 *   npm run assets -- --force 전부 다시 뽑기
 *   npm run assets -- postit  이름에 'postit'이 들어간 줄만 (다시) 뽑기
 *
 * 원본은 읽기만 하고, 결과는 public/media/ 와 public/media/manifest.json 에 써요.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { JOBS, type Job } from './assets.config.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'media');
const args = process.argv.slice(2);
const force = args.includes('--force');
const filter = args.find((a) => !a.startsWith('--'));

const LIMIT_FILE = 25 * 1024 * 1024; // 파일 하나 25MB
const LIMIT_ALL = 300 * 1024 * 1024; // 전체 300MB

function ffmpeg(a: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || `ffmpeg exit ${r.status}`);
}

function probeDur(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    encoding: 'utf8',
  });
  return Math.round(parseFloat(r.stdout) * 1000) / 1000;
}

/**
 * at 앞뒤 win초 안에서 가장 또렷한(덜 흔들린) 프레임의 시간을 돌려줘요.
 * 손에 들고 찍은 영상이라 0.1초 차이로도 흔들림 번짐이 크게 달라져요.
 */
const picked = new Map<string, number>();
function sharpest(src: string, at: number, win: number): number {
  if (win <= 0) return at;
  const start = Math.max(0, at - win);
  // 재는 법: 각 프레임을 작은 JPEG로 압축했을 때의 크기. 번진 프레임은 디테일이 없어 작게 압축돼요.
  // (ffmpeg의 blurdetect는 이 영상에서 번진 프레임을 또렷하다고 잘못 골라서 쓰지 않아요.)
  // 주의: 지지직 노이즈가 많은 프레임도 크게 나오므로, 결과는 점검 시트로 눈으로 확인해요.
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', `${start}`, '-t', `${win * 2}`, '-i', src, '-an',
      '-vf', 'scale=480:360', '-c:v', 'mjpeg', '-q:v', '4', '-f', 'framecrc', '-'],
    { encoding: 'utf8' },
  );
  let best = at;
  let bestSize = -1;
  let i = 0;
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('0,')) continue;
    const size = parseInt(line.split(',')[4]);
    if (size > bestSize) {
      bestSize = size;
      best = start + i / 30;
    }
    i++;
  }
  return Math.round(best * 1000) / 1000;
}

// 영상 공통: H.264 main, yuv420p, 30fps, 소리 없음, 웹에서 바로 재생(faststart)
const H264 = ['-an', '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-movflags', '+faststart'];
const LOOP_FADE = 0.3; // 반복 클립의 끝→처음 섞는 길이(초)

function build(job: Job, out: string) {
  switch (job.kind) {
    case 'still': {
      const at = sharpest(job.src, job.at, job.pick ?? 0.2);
      picked.set(job.out, at);
      ffmpeg(['-ss', `${at}`, '-i', job.src, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '82', out]);
      return;
    }

    case 'clip': {
      const w = job.w ?? 960;
      ffmpeg(['-ss', `${job.from}`, '-t', `${job.to - job.from}`, '-i', job.src,
        '-vf', `scale=${w}:${(w * 3) / 4},fps=30`, ...H264, '-crf', '26', '-g', '30', out]);
      return;
    }

    case 'loop': {
      // 구간 [from, to] 의 마지막 LOOP_FADE초를 처음 LOOP_FADE초에 겹쳐 섞어요.
      // 결과 길이 = (to - from) - LOOP_FADE, 끝 프레임이 첫 프레임으로 자연스럽게 이어짐.
      const len = job.to - job.from;
      const body = len - LOOP_FADE;
      const fc =
        `[0:v]scale=960:720,fps=30,setpts=PTS-STARTPTS,split[a][b];` +
        `[a]trim=${LOOP_FADE}:${len},setpts=PTS-STARTPTS[body];` +
        `[b]trim=0:${LOOP_FADE},setpts=PTS-STARTPTS[head];` +
        `[body][head]xfade=transition=fade:duration=${LOOP_FADE}:offset=${body - LOOP_FADE}[v]`;
      ffmpeg(['-ss', `${job.from}`, '-t', `${len}`, '-i', job.src, '-filter_complex', fc, '-map', '[v]',
        ...H264, '-crf', '26', '-g', '30', out]);
      return;
    }

    case 'tape': {
      // 앞으로: 키프레임을 촘촘히(6프레임마다) → 멈춤·한 프레임씩 넘기기가 정확
      ffmpeg(['-ss', `${job.from}`, '-t', `${job.to - job.from}`, '-i', job.src,
        '-vf', 'scale=640:480,fps=30', ...H264, '-crf', '26', '-g', '6', out]);
      // 거꾸로: 되감기 화면용(3배속으로 틀어서 화질은 덜 중요)
      ffmpeg(['-ss', `${job.from}`, '-t', `${job.to - job.from}`, '-i', job.src,
        '-vf', 'scale=640:480,fps=30,reverse', ...H264, '-crf', '30', '-g', '15', out.replace(/\.mp4$/, '.rev.mp4')]);
      return;
    }

    case 'crop': {
      // 종이 가운데를 중심으로 넉넉히 잘라 → 돌려 바로 세우고 → 가운데를 w × h로
      const a = (Math.abs(job.deg) * Math.PI) / 180;
      const pw = Math.ceil(job.w * Math.cos(a) + job.h * Math.sin(a)) + 8;
      const ph = Math.ceil(job.w * Math.sin(a) + job.h * Math.cos(a)) + 8;
      const ow = job.size, oh = Math.round((job.size * job.h) / job.w / 2) * 2;
      const cut = `crop=${pw}:${ph}:${Math.round(job.cx - pw / 2)}:${Math.round(job.cy - ph / 2)},` +
        `rotate=${job.deg}*PI/180,crop=${job.w}:${job.h},scale=${ow}:${oh}`;
      if (job.alpha) {
        // (11/19 추가) 모양만 남기고 배경은 투명하게. ink = 어두운 획(밝기 118 아래), blue = 파란 물감(파랑이 빨강보다 많이 진한 곳)
        const m = job.alpha === 'ink'
          ? `format=gray,geq=lum='255*clip((118-lum(X\\,Y))/28\\,0\\,1)'`
          : `format=rgb24,geq=r='255*clip((b(X\\,Y)-r(X\\,Y)-12)/36\\,0\\,1)':g='255*clip((b(X\\,Y)-r(X\\,Y)-12)/36\\,0\\,1)':b='255*clip((b(X\\,Y)-r(X\\,Y)-12)/36\\,0\\,1)',format=gray`;
        const color = job.alpha === 'ink' ? '0x1c1a1e' : '0xffffff';
        const fc = `[0]${cut},${m}[m];[1][m]alphamerge`;
        ffmpeg(['-i', job.src, '-f', 'lavfi', '-i', `color=c=${color}:s=${ow}x${oh}`,
          '-filter_complex', fc, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '90', out]);
        return;
      }
      if (job.paper && job.ink) {
        // 손글씨 획만: 밝기 90 아래는 잉크, 118 위는 종이(그 사이는 부드럽게. 그늘진 종이가 잉크로 안 잡히게 좁게) → 잉크 색을 그 모양으로 종이 색 위에
        const hex = (c: string) => `0x${c.replace('#', '')}`;
        const fc = `[0]${cut},format=gray,geq=lum='255*clip((118-lum(X\,Y))/28\,0\,1)'[m];[2][m]alphamerge[ink];` +
          `[1][ink]overlay=format=auto,noise=alls=5:allf=u`;
        ffmpeg(['-i', job.src, '-f', 'lavfi', '-i', `color=c=${hex(job.paper)}:s=${ow}x${oh}`,
          '-f', 'lavfi', '-i', `color=c=${hex(job.ink)}:s=${ow}x${oh}`,
          '-filter_complex', fc, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88', out]);
        return;
      }
      ffmpeg(['-i', job.src, '-vf', cut, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '88', out]);
      return;
    }

    case 'memory': {
      // (11/19 추가) 옛 녹화: ① 장면마다 글씨 그림(투명 PNG)을 파이썬으로 만들고 ② 장면을 잘라 글씨를 얹어 이어 붙여요.
      // 테이프에서 멈춰·한 장씩 읽을 영상이라 키프레임을 2프레임마다(-g 2)
      const tmp = join(ROOT, 'assets-src', 'memory-overlay'); // 글씨 그림은 중간 파일이라 배포에 안 들어가는 곳에(git 제외)
      mkdirSync(tmp, { recursive: true });
      const r = spawnSync('python', ['-I', join(ROOT, 'scripts', 'memory-overlay.py'), tmp, job.font, job.hand, JSON.stringify(job.shots)], { encoding: 'utf8', cwd: ROOT });
      if (r.status !== 0) throw new Error(r.stderr || 'memory-overlay.py 실패');
      const ins: string[] = [];
      let fc = '';
      job.shots.forEach((s, i) => {
        ins.push('-ss', `${s.from}`, '-t', `${s.to - s.from}`, '-i', job.src);
        ins.push('-i', join(tmp, `${i}.png`));
        fc += `[${i * 2}:v]scale=640:480,fps=30,setpts=PTS-STARTPTS[v${i}];[v${i}][${i * 2 + 1}:v]overlay=0:0[o${i}];`;
      });
      fc += job.shots.map((_, i) => `[o${i}]`).join('') + `concat=n=${job.shots.length}:v=1:a=0[v]`;
      ffmpeg([...ins, '-filter_complex', fc, '-map', '[v]', ...H264, '-crf', '23', '-g', '2', out]);
      return;
    }

    case 'letters': {
      // (11/20 추가) 단색 바탕 글씨 → 투명 바탕 글씨 + 빛 번짐(scripts/letters-alpha.py)
      const glow = join(OUT, job.glow);
      mkdirSync(dirname(glow), { recursive: true });
      const r = spawnSync('python', ['-I', join(ROOT, 'scripts', 'letters-alpha.py'), join(ROOT, job.src), out, glow, `${job.w}`], { encoding: 'utf8', cwd: ROOT });
      if (r.status !== 0) throw new Error(r.stderr || 'letters-alpha.py 실패');
      console.log('  ' + r.stdout.trim());
      return;
    }

    case 'audio': {
      if (job.parts) {
        // (11/19 3차 추가) 여러 구간 이어 붙이기 → (걸러 내기) → (크기 맞추기)
        const n = job.parts.length;
        const fc = job.parts.map(([a, b], i) => `[0:a]atrim=${a}:${b},asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=${(b - a - 0.015).toFixed(3)}:d=0.015[p${i}];`).join('')
          + job.parts.map((_, i) => `[p${i}]`).join('') + `concat=n=${n}:v=0:a=1`
          + (job.hp ? `,highpass=f=${job.hp},highpass=f=${job.hp}` : '') + (job.norm ? ',loudnorm=I=-18:TP=-2:LRA=7' : '') + '[a]';
        ffmpeg(['-i', job.src, '-filter_complex', fc, '-map', '[a]', '-c:a', 'libmp3lame', '-ar', '44100',
          ...(job.mono ? ['-ac', '1', '-b:a', '96k'] : ['-ac', '2', '-b:a', '128k']), out]);
        return;
      }
      if (job.loop && job.from !== undefined && job.to !== undefined) {
        // (11/19 6단계 추가) 끊김 없이 반복되는 소리: 끝 뒤로 loop초를 더 잘라 와서 그 꼬리를 머리에 겹쳐 섞어요(이음매에서 파형이 이어짐).
        // mp3는 앞뒤에 빈 틈이 붙어 반복할 때 "틱" 소리가 나서, .wav(틈 없음)로 써요
        const L = job.to - job.from, X = job.loop;
        const fc = `[0:a]asplit=3[a][b][c];[a]atrim=${L}:${L + X},asetpts=PTS-STARTPTS[tail];[b]atrim=0:${X},asetpts=PTS-STARTPTS[head];`
          + `[c]atrim=${X}:${L},asetpts=PTS-STARTPTS[body];[tail][head]acrossfade=d=${X}:c1=tri:c2=tri[seam];[seam][body]concat=n=2:v=0:a=1[o]`;
        ffmpeg(['-ss', `${job.from}`, '-t', `${L + X + 0.05}`, '-i', job.src, '-filter_complex', fc, '-map', '[o]',
          ...(out.endsWith('.wav') ? ['-c:a', 'pcm_s16le', '-ar', '24000'] : ['-c:a', 'libmp3lame', '-ar', '44100', '-b:a', '96k']), '-ac', '1', out]);
        return;
      }
      const cut = job.from !== undefined ? ['-ss', `${job.from}`, '-t', `${(job.to ?? 0) - job.from}`] : [];
      // (11/17 추가) 끝을 짧게 페이드아웃
      const fade = job.fadeOut && job.from !== undefined && job.to !== undefined
        ? ['-af', `afade=t=out:st=${(job.to - job.from - job.fadeOut).toFixed(3)}:d=${job.fadeOut}`] : [];
      ffmpeg([...cut, '-i', job.src, '-vn', ...fade, '-c:a', 'libmp3lame', '-ar', '44100',
        ...(job.mono ? ['-ac', '1', '-b:a', '96k'] : ['-ac', '2', '-b:a', '128k']), out]);
      return;
    }
  }
}

type Entry = { file: string; kind: Job['kind']; bytes: number; dur?: number };
const manifest: Entry[] = [];
let built = 0;

for (const job of JOBS) {
  const out = join(OUT, job.out);
  const outputs = job.kind === 'tape' ? [out, out.replace(/\.mp4$/, '.rev.mp4')] : [out];
  const want = force || (filter ? job.out.includes(filter) : !outputs.every(existsSync));

  if (want) {
    if (!existsSync(job.src)) throw new Error(`원본이 없어요: ${job.src}`);
    mkdirSync(dirname(out), { recursive: true });
    process.stdout.write(`  뽑는 중  ${job.out} ... `);
    const t = Date.now();
    build(job, out);
    built++;
    const at = picked.get(job.out);
    console.log(`${((Date.now() - t) / 1000).toFixed(1)}s${at !== undefined ? `  (고른 프레임 ${at}초)` : ''}`);
  }

  for (const o of outputs) {
    const rel = o.slice(OUT.length + 1).replaceAll('\\', '/');
    const e: Entry = { file: rel, kind: job.kind, bytes: statSync(o).size };
    if (job.kind !== 'still') e.dur = probeDur(o);
    manifest.push(e);
  }
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));

// ── 용량 요약 ──
const total = manifest.reduce((s, e) => s + e.bytes, 0);
const byKind = new Map<string, number>();
for (const e of manifest) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + e.bytes);
const mb = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB';

console.log(`\n새로 뽑음 ${built}개 / 전체 ${manifest.length}개 파일, 합계 ${mb(total)} (목표 ${mb(LIMIT_ALL)} 이하)`);
for (const [k, b] of byKind) console.log(`  ${k.padEnd(6)} ${mb(b)}`);
const big = manifest.filter((e) => e.bytes > LIMIT_FILE);
if (big.length) console.log('⚠ 25MB 넘는 파일:', big.map((e) => e.file).join(', '));
if (total > LIMIT_ALL) console.log('⚠ 전체 용량 목표 초과');
