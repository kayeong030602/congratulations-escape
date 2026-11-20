import type { Action, Room } from '../schema.ts';
import {
  ENGLISH_SIGN, SLAM_DOOR, STAIR_AMB, STAIR_BOXES, STAIR_EXPOSURE, STAIR_LAMPS, STAIR_RAILS, STAIR_REACH, STAIR_SPAWNS, ZONE_AT,
  congratsDoor, floorPlate, postitCluster, tapeTraces,
} from './stairwell.ts';

/**
 * (11/20 6단계 계단참) 개발용 계단 시험 방 — ?room=stairtest&dev (개발 미리보기에서만, 배포엔 안 들어감, 저장 안 남김).
 * 위험한 새 기능을 계단참 루프에 쓰기 전에 폰에서 먼저 확인받는 곳(사용자 요청):
 *   ① 계단 오르내리기(바닥 높이 — 밟는 상자, walker.ts) ② 높이가 다른 곳으로 fade 순간이동(꼭대기 → 시작 칸)
 *   ③ 되감은 테이프가 계단 높이를 따라가는지 ④ 계단실 모양·밝기·난간 ⑤ congratulations! 홀로그램 글씨 ⑥ 0-2 포스트잇 무리 ⑦ 0-4 테이프 흔적
 * 퍼즐(층 판정)은 없어요: 계단참까지 올라갔다가 되돌아 내려오거나, 꼭대기 위 계단을 밟으면 시작 칸으로(바퀴 수만 셈).
 */
const door = congratsDoor();
const traces = tapeTraces();
const LOOP: Action[] = [{ do: 'set', flag: 'test.m', off: true }, { do: 'add', count: 'test.loops' }, { do: 'warp', spawn: 'start', via: 'fade' }];

export const stairtest: Room = {
  id: 'stairtest',
  title: '계단 시험 방(개발용)',
  dev: true,
  amb: 'hum',
  vhs: 0.25,
  exposure: STAIR_EXPOSURE,
  space: { boxes: STAIR_BOXES, lamps: STAIR_LAMPS, reach: STAIR_REACH, amb: STAIR_AMB },
  spawns: STAIR_SPAWNS,
  parts: [SLAM_DOOR, door.part, door.leaf],
  props: [floorPlate(2), ENGLISH_SIGN, ...door.props, ...traces.props],
  scatter: [...postitCluster(), traces.scatter],
  rails: STAIR_RAILS,
  zones: [
    { id: 'm', ...ZONE_AT.m, enter: [{ do: 'set', flag: 'test.m' }] },
    { id: 'down', ...ZONE_AT.down, when: { flag: 'test.m' }, enter: LOOP },
    { id: 'up', ...ZONE_AT.up, when: { flag: 'test.m' }, enter: LOOP },
  ],
  enter: [
    { do: 'set', flag: 'tape' },
    { do: 'hint', text: '계단 시험 방 · 오르내리기 · R 되감기', touch: '계단 시험 방 · 오르내리기 · ◀◀ 되감기' },
  ],
};
