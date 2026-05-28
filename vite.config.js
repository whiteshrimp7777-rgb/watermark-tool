import { defineConfig } from 'vite';

// base: './' (상대경로) → GitHub Pages 서브패스(/저장소이름/)에서도 그대로 동작.
// 저장소 이름이 바뀌어도 수정 불필요.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
});
