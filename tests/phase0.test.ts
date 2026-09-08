import { describe, expect, it } from 'vitest'

// 09 Phase 0: boş iskele testi — koşucu ve test altyapısı ayakta.
describe('Phase 0 iskele', () => {
  it('test koşucusu çalışıyor', () => {
    expect(true).toBe(true)
  })

  it('fake-indexeddb yüklü (08 §0)', () => {
    expect(typeof indexedDB).toBe('object')
  })
})
