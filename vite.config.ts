import { defineConfig } from 'vitest/config'

// 13 §7: service worker / build kimliği Phase 11'de eklenir. Phase 0: yalnız iskele.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
})
