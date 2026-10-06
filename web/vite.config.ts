import { defineConfig } from 'vitest/config';

// data/*.json (근거 DB) 는 web/ 바깥(../data)에 있으므로 개발 서버가 읽을 수 있게 허용한다.
export default defineConfig({
  base: './',
  // PORT 환경변수가 있으면 그 포트를 쓴다 (미리보기 도구가 빈 포트를 정해 줌)
  server: { port: Number(process.env.PORT) || 5173, fs: { allow: ['..'] } },
  // 화면: 홈페이지(index) · 3분 체크(check) · 상담 신청(consult) · 간병 안내(care, 기능 스위치) · 관리자(admin)
  build: { outDir: 'dist', target: 'es2020', rollupOptions: { input: { home: 'index.html', check: 'check.html', consult: 'consult.html', care: 'care.html', admin: 'admin.html' } } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
