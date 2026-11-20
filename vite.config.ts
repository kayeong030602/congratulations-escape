import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// GitHub Pages 주소가 https://아이디.github.io/congratulations-escape/ 라서
// 배포용 빌드에서만 앞에 저장소 이름을 붙여요. 로컬 미리보기는 그냥 '/'.
// (11/17 변경) 배포에 넣는 화면: 본 게임(3D, index.html) + 2.5D 보관본(legacy.html).
//   시험 방(lab3d.html)·소재 확인(media.html)·옛 주소(play.html)는 개발용이라 넣지 않아요.
// (11/20 8단계) 빌드본 미리보기(`vite preview`)도 같은 경로로 열어 배포판과 똑같이 시험해요.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/congratulations-escape/' : '/',
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        legacy: resolve(import.meta.dirname, 'legacy.html'),
      },
    },
  },
}));
