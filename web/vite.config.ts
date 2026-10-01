import { defineConfig } from 'vitest/config';

// data/*.json (근거 DB) 는 web/ 바깥(../data)에 있으므로 개발 서버가 읽을 수 있게 허용한다.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2020' },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
