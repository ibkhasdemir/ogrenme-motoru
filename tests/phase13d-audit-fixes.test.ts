// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyContentImport } from '../src/app/contentImport'
import { Motor } from '../src/app/motor'
import { parseContentImport, parseLooseJson, planContentImport, unitWarning } from '../src/engine/import/contentImport'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'

import { FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 13d — bağımsız denetimde (2026-09-08, iki inceleme ajanı) bulunan hatalar için gerileme testleri.
// Her test bir bulguya karşılık gelir; hepsi düzeltmeden önce kırmızıydı.

const text = (v: unknown) => JSON.stringify(v)
const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim() === label)!
const click = async (el: HTMLElement) => { el.click(); await flush() }

async function motorWith(atoms: { konu: string; text: string }[]) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock: new FakeClock(), ids: fakeIds('id') })
  const made = []
  for (const a of atoms) made.push(await motor.addAtom({ subjectName: 'Tarih', topicName: a.konu, text: a.text, prompt: `${a.text} sorusu?` }))
  return { repo, motor, made }
}

describe('Çekirdek — denetim bulguları', () => {
  it('E1: zaten var olan atomun satır içi çengeli kaybolmaz, mevcut atoma bağlanır (çift ise atlanır)', async () => {
    const { motor, made } = await motorWith([{ konu: 'X', text: 'Lale Devri 1718.' }])
    const c = await motor.content()
    const file = { atomlar: [{ ders: 'Tarih', konu: 'X', atom: 'Lale Devri 1718.', soru: 'Lale Devri?', cengel: [{ tur: 'kodlama', metin: 'Pasarofça → Lale açtı' }] }] }
    const plan = planContentImport(parseContentImport(text(file)), { atoms: c.atoms, questions: [], hooks: [] })
    expect(plan.skippedAtoms).toBe(1)
    expect(plan.hooks).toEqual([{ atomId: made[0]!.id, type: 'mnemonic', content: 'Pasarofça → Lale açtı' }])
    const out = await applyContentImport(motor, plan, null)
    expect(out).toMatchObject({ atomsAdded: 0, questionsAdded: 0, hooksAdded: 1 })
    // ikinci kez aynı dosya: çengel de artık var → atlanır, uygulanacak bir şey kalmaz
    const c2 = await motor.content()
    const plan2 = planContentImport(parseContentImport(text(file)), { atoms: c2.atoms, questions: [], hooks: c2.hooks.map((hk) => ({ atomId: hk.atomId, content: hk.content })) })
    expect(plan2.hooks).toEqual([])
    expect(plan2.skippedHooks).toBe(1)
    await expect(applyContentImport(motor, plan2, null)).rejects.toThrow(/Eklenecek yeni içerik yok/)
  })

  it('E2: parseLooseJson metin içindeki ``` dizisini silmez; JSON sonrası açıklamada } olsa da okur', () => {
    const withFence = { atomlar: [{ ders: 'Bilgisayar', konu: 'Markdown', atom: 'Kod bloğu ``` ile açılır.', soru: 'Kod bloğu neyle açılır?' }] }
    const wrapped = 'İşte:\n```json\n' + text(withFence) + '\n```\n'
    const p = parseContentImport(wrapped)
    expect(p.errors).toEqual([])
    expect(p.atoms[0]!.text).toBe('Kod bloğu ``` ile açılır.') // veri değiştirilmedi
    const trailing = text({ atomlar: [{ ders: 'T', konu: 'K', atom: 'A.', soru: 'A?' }] }) + '\n\nUmarım işine yarar :}'
    const r = parseLooseJson(trailing)
    expect('value' in r).toBe(true)
    expect(parseContentImport(trailing).atoms).toHaveLength(1)
  })

  it('E3: unitWarning üniteye bakar — 1 ünite + çok alt başlık ideal dizindir, uyarmaz; çok ünite uyarır', () => {
    const ideal = { atomlar: Array.from({ length: 16 }, (_, i) => ({ ders: 'Tarih', konu: '18. yy Osmanlı', altbaslik: `Alt ${i % 8}`, atom: `Atom ${i}.`, soru: `Atom ${i}?` })) }
    expect(unitWarning(planContentImport(parseContentImport(text(ideal)), { atoms: [], questions: [] }))).toBeNull()
    const flat = { atomlar: Array.from({ length: 12 }, (_, i) => ({ ders: 'Tarih', konu: `Olay ${i}`, atom: `Atom ${i}.`, soru: `Atom ${i}?` })) }
    expect(unitWarning(planContentImport(parseContentImport(text(flat)), { atoms: [], questions: [] }))).toMatch(/12 atom 12 ayrı üniteye dağılmış/)
  })

  it('E4: aynı adla "yeniden adlandır" hiçbir şey yapmaz (boş kabuğa taşımaz)', async () => {
    const { motor } = await motorWith([{ konu: 'A', text: 'Atom A.' }, { konu: 'B', text: 'Atom B.' }])
    const before = await motor.content()
    const tA = before.topics.find((t) => t.name === 'A')!
    const tB = before.topics.find((t) => t.name === 'B')!
    await motor.renameTopic(tA.id, 'B') // A → B ile birleşir; A boş kabuk, adı da "B"
    const mid = await motor.content()
    expect(mid.topics.filter((t) => t.name === 'B')).toHaveLength(2)
    const out = await motor.renameTopic(tB.id, 'B') // ad değişmiyor
    expect(out).toEqual({ topicId: tB.id, merged: false, movedAtoms: 0 })
    const after = await motor.content()
    expect(after.atoms.every((a) => a.topicId === tB.id)).toBe(true) // atomlar boş kabuğa taşınmadı
  })
})

describe('Arayüz — denetim bulguları', () => {
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

  async function topicsScreen(atoms: { konu: string; text: string }[]) {
    const { motor, repo, made } = await motorWith(atoms)
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    await click(byTestId('to-topics')!)
    return { motor, repo, made }
  }
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>('.topic-row input[type=checkbox]')]
  const toggle = async (i: number, on: boolean) => { const b = boxes()[i]!; b.checked = on; b.dispatchEvent(new Event('change')); await flush() }
  const nameField = () => document.querySelector<HTMLInputElement>('input[aria-label="Yeni konu adı"]')!
  const unitField = () => document.querySelector<HTMLInputElement>('input[aria-label="Ünite adı"]')!

  it('U1: seçim değişince ad alanı yenilenir — eski adla yanlış konu birleştirilmez', async () => {
    const { motor } = await topicsScreen([{ konu: 'Küçük Kaynarca', text: 'Atom K.' }, { konu: 'Prut Savaşı', text: 'Atom P.' }])
    await toggle(0, true)
    expect(nameField().value).toBe('Küçük Kaynarca')
    await toggle(0, false)
    expect(nameField().value).toBe('') // seçim kalkınca temizlenir
    await toggle(1, true)
    expect(nameField().value).toBe('Prut Savaşı') // bayat ad kalmaz
    expect(byTestId('topic-selection')!.textContent).toBe('1 konu seçili: Prut Savaşı')
    await click(byTestId('rename-topic')!)
    const c = await motor.content()
    expect(c.topics.map((t) => t.name).sort()).toEqual(['Küçük Kaynarca', 'Prut Savaşı']) // birleşme olmadı
  })

  it('U2: Ünite/ad boşken düğmeler kapalı; iki konu aynı ada inecekse taşıma yapılmaz', async () => {
    const { motor } = await topicsScreen([{ konu: '18. yy › Islahatlar', text: 'Atom 1.' }, { konu: '19. yy › Islahatlar', text: 'Atom 2.' }])
    await toggle(0, true)
    await toggle(1, true)
    expect((byTestId('move-topics') as HTMLButtonElement).disabled).toBe(true) // ünite boş
    const u = unitField()
    u.value = 'Osmanlı'
    u.dispatchEvent(new Event('input'))
    await flush()
    expect((byTestId('move-topics') as HTMLButtonElement).disabled).toBe(false)
    await click(byTestId('move-topics')!)
    expect(document.body.textContent).toContain('Taşınmadı')
    const c = await motor.content()
    expect(c.topics.map((t) => t.name).sort()).toEqual(['18. yy › Islahatlar', '19. yy › Islahatlar'])
    expect(new Set(c.atoms.map((a) => a.topicId)).size).toBe(2) // atomlar birleşmedi
  })

  it('U3: çengel kaydetmede çift dokunuş tek kayıt yazar', async () => {
    const { motor, made } = await motorWith([{ konu: 'K', text: 'Atom.' }])
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    document.querySelector<HTMLDetailsElement>('details[data-group]')!.open = true
    await click(document.querySelector<HTMLElement>(`[data-atom="${made[0]!.id}"]`)!)
    const t = document.querySelector<HTMLTextAreaElement>('[data-testid="hook-text"]')!
    t.value = 'Çift dokunuş kodlaması'
    const btn = byTestId('save-hook')!
    btn.click(); btn.click() // hızlı iki dokunuş
    await flush(20)
    expect((await motor.content()).hooks).toHaveLength(1)
  })

  it('U4: Ekle hata verirse düğme yeniden etkinleşir; ünite değişince önizleme geçersiz olur', async () => {
    const { motor, repo } = await motorWith([])
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    await click(byTestId('to-import')!)
    const ta = byTestId('import-text') as HTMLTextAreaElement
    ta.value = text({ atomlar: [{ ders: 'Tarih', konu: 'K', atom: 'Atom.', soru: 'Atom?' }] })
    ta.dispatchEvent(new Event('input'))
    await click(byTestId('preview-import')!)
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(false)
    const orig = repo.putAtom.bind(repo)
    repo.putAtom = async () => { throw new Error('kota dolu') }
    await click(byTestId('apply-import')!)
    expect(byTestId('import-error')!.textContent).toContain('kota dolu')
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(false) // kilitli kalmaz
    repo.putAtom = orig
    // ünite yazılınca eski önizleme geçersiz → Ekle kilitlenir, yeniden Önizle gerekir
    const u = byTestId('import-unit') as HTMLInputElement
    u.value = '18. yy Osmanlı'
    u.dispatchEvent(new Event('input'))
    await flush()
    expect((byTestId('apply-import') as HTMLButtonElement).disabled).toBe(true)
    await click(byTestId('preview-import')!)
    await click(byTestId('apply-import')!)
    const done = await motor.content()
    expect(done.atoms).toHaveLength(1)
    expect(done.topics.find((t) => t.id === done.atoms[0]!.topicId)!.name).toBe('18. yy Osmanlı › K')
    // ilk (başarısız) denemeden kalan boş konu zararsız: atomu olmadığı için ne listede ne Konular ekranında görünür
  })

  it('U5: aramada odak ve imleç korunur (telefonda klavye kapanmaz); açık panel açık kalır', async () => {
    const { motor } = await motorWith([{ konu: 'K', text: 'Lale Devri.' }, { konu: 'K', text: 'Prut Savaşı.' }])
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İçerik'))
    const search = document.querySelector<HTMLInputElement>('input[type=search]')!
    search.focus()
    search.value = 'Lale'
    search.setSelectionRange(4, 4)
    search.dispatchEvent(new Event('input'))
    await flush()
    const after = document.querySelector<HTMLInputElement>('input[type=search]')!
    expect(document.activeElement).toBe(after)
    expect(after.value).toBe('Lale')
    expect(after.selectionStart).toBe(4)
  })
})
