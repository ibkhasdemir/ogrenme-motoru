import { defineConfig } from 'vitest/config'
import { swPrecachePlugin } from './build/swPlugin'

// 13 §7: service worker tam ön-önbellek manifesti build zamanında enjekte edilir (BL-35).
export default defineConfig({
  base: './',
  plugins: [swPrecachePlugin()],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
  },
})
