/**
 * 소재 미리 받기.
 * 방에 들어갈 때 그 방의 영상·이미지를 통째로 받아 메모리에 올려 둬요.
 * 그래서 플레이 중엔 버퍼링이 없고, 영상 안에서 위치를 옮기는 것도 바로 돼요.
 */
import type { ClipRef, Room } from '../data/schema.ts';

export const BASE = `${import.meta.env.BASE_URL}media/`;

/** 되감기·반대 방향용 거꾸로 파일 이름. */
export const rev = (file: string) => file.replace(/\.mp4$/, '.rev.mp4');

/** ClipRef → 실제 파일 이름. */
export const clipFile = (c: ClipRef) => (typeof c === 'string' ? c : c.reverse ? rev(c.clip) : c.clip);

const blobs = new Map<string, string>();

/** 받아 둔 파일이면 메모리 주소를, 아니면 서버 주소를 돌려줘요. */
export const url = (file: string) => blobs.get(file) ?? BASE + file;

export async function preload(files: Iterable<string>, onProgress?: (done: number, total: number) => void) {
  const todo = [...new Set(files)].filter((f) => !blobs.has(f));
  let done = 0;
  onProgress?.(0, todo.length);
  await Promise.all(
    todo.map(async (f) => {
      const r = await fetch(BASE + f);
      if (!r.ok) throw new Error(`소재를 못 받았어요: ${f} (${r.status})`);
      blobs.set(f, URL.createObjectURL(await r.blob()));
      onProgress?.(++done, todo.length);
    }),
  );
}

/** 방 데이터를 훑어서 그 방이 쓰는 영상·이미지 파일과 소리 이름을 모아요. */
export function collect(room: Room): { media: string[]; sounds: string[] } {
  const media = new Set<string>();
  const sounds = new Set<string>();

  (function walk(v: unknown) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'still' || k === 'loop') media.add(x as string);
      else if (k === 'via' || k === 'clip') media.add(clipFile(x as ClipRef));
      else if ((k === 'sound' || k === 'amb') && typeof x === 'string') sounds.add(x);
      else walk(x);
    }
  })(room);

  for (const seg of room.tape?.segments ?? []) media.add(rev(seg.clip));
  return { media: [...media], sounds: [...sounds] };
}
