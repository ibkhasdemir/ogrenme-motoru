// @vitest-environment jsdom
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor } from '../src/app/motor'
import { DexieRepository } from '../src/store/dexie/dexieRepository'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { LEGACY_UNAVAILABLE_TEXT, VERSION_DATE_UNKNOWN } from '../src/ui/content'
import { DAY, FakeClock, MIN, fakeIds } from './helpers/engineFixture'
import { seedLegacyV1, testIds, uniqueDbName } from './helpers/legacyDb'

// Phase 9 — Uçtan uca (jsdom, 08 §6): E-01…E-09, E-15, E-16, E-17, E-19, E-20; U-DQ-14 ekran metni; U-QR-09/12 UI cümleleri; I-22 DOM.

const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const screen = () => document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null
const phase = () => document.querySelector('[data-screen]')?.getAttribute('data-phase') ?? null
const text = () => document.body.textContent ?? ''
function byText(label: string, tag = 'button'): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>(tag)].find((b) => (b.textContent ?? '').trim() === label || (b.textContent ?? '').trim().startsWith(label))
  if (!el) throw new Error(`Öğe bulunamadı: ${label} (ekran: ${screen()} / ${phase()})`)
  return el
}
const click = async (el: HTMLElement) => { el.click(); await flush() }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const options = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-option]')]

let handle: AppHandle | null = null
let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); root.id = 'app'; document.body.appendChild(root) })
afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

async function setup(opts: { withQuestion?: boolean; extraAtoms?: number } = { withQuestion: true }) {
  const clock = new FakeClock()
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const atomA = await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: 'Tanzimat Fermanı 1839 yılında ilan edildi.', prompt: 'Tanzimat Fermanı hangi yıl ilan edildi?', facets: ['date'], hooks: [{ type: 'logic', content: 'On sekiz otuz dokuz çengeli' }], why: 'Batılılaşma' })
  const q = opts.withQuestion ? await motor.addQuestion({ primaryAtomId: atomA.id, source: 'kendi', text: 'Tanzimat Fermanı hangi yıl ilan edildi?', options: ['1839', '1856', '1876'], correctIndex: 0 }) : null
  for (let i = 0; i < (opts.extraAtoms ?? 0); i++) await motor.addAtom({ subjectName: 'Tarih', topicName: 'Osmanlı', text: `Ek atom ${i}.`, prompt: `Ek atom ${i}?` })
  handle = mountApp(root, { motor, appVersion: '0.2.0' })
  await flush()
  return { motor, repo, clock, atomA, q }
}

/** Başla → Oku → Okudum → soru ekranı (ilk öğe yeni atom) */
async function toQuestion() {
  await click(byTestId('start')!)
  expect(screen()).toBe('read')
  await click(byTestId('read-done')!)
  expect(screen()).toBe('question')
  expect(phase()).toBe('answer')
}

describe('Phase 9 — UI akışı', () => {
  it('E-01 (T1) — veri yüklü açılış: Başla görünür; ders/konu/mod seçimi yok; tek dokunuşla ilk öğe ekranda', async () => {
    await setup()
    expect(screen()).toBe('today')
    expect(byTestId('start')!.textContent).toBe('Başla · 1 öğe')
    expect(document.querySelectorAll('select')).toHaveLength(0)
    expect(text()).toContain('tekrar'); expect(text()).toContain('yeni'); expect(text()).toContain('bugün yapılan')
    await click(byTestId('start')!)
    expect(screen()).toBe('read')
  })

  it('E-02 — yeni atom akışı: Başla → Oku → "Okudum, sına beni" → soru', async () => {
    await setup()
    await click(byTestId('start')!)
    expect(screen()).toBe('read')
    expect(text()).toContain('Yeni · Tarih › Osmanlı')
    expect(text()).toContain('Tanzimat Fermanı 1839 yılında ilan edildi.')
    await click(byTestId('read-done')!)
    expect(screen()).toBe('question')
    expect(text()).toContain('Tanzimat Fermanı hangi yıl ilan edildi?')
  })

  it('E-03 — soru akışı: seçenek → Cevapla → Güven (doğru cevap görünmüyor) → Sonuç', async () => {
    const { repo } = await setup()
    await toQuestion()
    expect((byTestId('answer') as HTMLButtonElement).disabled).toBe(true)
    await click(options()[0]!)
    expect(options()[0]!.classList.contains('is-selected')).toBe(true)
    expect(document.querySelectorAll('.is-correct')).toHaveLength(0)
    await click(byTestId('answer')!)
    expect(phase()).toBe('confidence')
    expect(text()).toContain('Ne kadar eminsin? Cevap henüz gösterilmedi.')
    expect(document.querySelectorAll('.is-correct')).toHaveLength(0)
    expect(await repo.listAttempts()).toHaveLength(0)
    await click(byTestId('conf-sure')!)
    expect(phase()).toBe('result')
    expect(text()).toContain('Doğru.')
    expect(await repo.listAttempts()).toHaveLength(1)
  })

  it('E-04 / E-19 — yanlışta önce neden, sonra cevap: "Yanlış." + dört çip (cevap gizli, Attempt yok) → çip → Attempt diske → doğru seçenek + açıklama → Devam', async () => {
    const { repo } = await setup({ withQuestion: true, extraAtoms: 1 })
    await toQuestion()
    await click(options()[1]!) // yanlış
    await click(byTestId('answer')!)
    await click(byTestId('conf-guess')!)
    expect(phase()).toBe('reason')
    expect(text()).toContain('Yanlış.')
    expect(text()).toContain('Neden yanlış?')
    const chips = [...document.querySelectorAll<HTMLButtonElement>('button.chip')].map((c) => c.textContent)
    expect(chips).toEqual(['Bilmiyordum', 'Karıştırdım', 'Dikkat / işlem', 'Geç'])
    expect(document.querySelectorAll('.is-correct')).toHaveLength(0) // doğru seçenek işaretli DEĞİL
    expect(byTestId('atom-explanation')).toBeNull() // açıklama YOK
    expect(await repo.listAttempts()).toHaveLength(0) // henüz kayıt yok
    await click(byText('Karıştırdım'))
    expect(phase()).toBe('result')
    expect(document.querySelectorAll('.is-correct')).toHaveLength(1)
    expect(document.querySelectorAll('.is-incorrect')).toHaveLength(1)
    expect(byTestId('atom-explanation')).not.toBeNull()
    const atts = await repo.listAttempts()
    expect(atts).toHaveLength(1)
    expect(atts[0]).toMatchObject({ kind: 'question', correct: false, wrongReason: 'confused', confidence: 'guess' })
    await click(byTestId('continue')!)
    expect(screen()).toBe('read') // sonraki öğe (ek atom yeni)
  })

  it('E-05 — doğru → Devam → sonraki öğe', async () => {
    await setup({ withQuestion: true, extraAtoms: 1 })
    await toQuestion()
    await click(options()[0]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    expect(text()).toContain('Doğru.')
    await click(byTestId('continue')!)
    expect(screen()).toBe('read')
  })

  it('E-06 — geri al: Sonuç → Geri al (30 sn içinde) → aynı soru aynı sürüm bir kez yeniden; deneme sayısı aynı, geri alma +1; 30 sn sonra düğme yok; kartta kısa ömürlü çubuk', async () => {
    const { repo, clock, q } = await setup({ withQuestion: true, extraAtoms: 1 })
    await toQuestion()
    await click(options()[0]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    expect(byTestId('undo')).not.toBeNull()
    await click(byTestId('undo')!)
    expect(screen()).toBe('question')
    expect(phase()).toBe('answer')
    const s = handle!.getScreen()
    expect(s.name === 'question' && s.pres.action.questionId).toBe(q!.question.id)
    expect(s.name === 'question' && s.pres.action.questionVersion).toBe(1)
    expect(s.name === 'question' && s.pres.replayOfAttemptId).toBeDefined()
    expect(await repo.listAttempts()).toHaveLength(1)
    expect(await repo.listVoids()).toHaveLength(1)
    // tekrar cevap: Geri al yoktur (BL-04)
    await click(options()[0]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    expect(phase()).toBe('result')
    expect(byTestId('undo')).toBeNull()
    await click(byTestId('continue')!)
    // kart akışı: ek atom yeni → oku → kart (sorusu yok)
    expect(screen()).toBe('read')
    await click(byTestId('read-done')!)
    expect(screen()).toBe('recall')
    await click(byTestId('reveal')!)
    await click(byTestId('sa-good')!)
    // sonraki ekranda kısa ömürlü "Son kartı geri al" çubuğu
    expect(text()).toContain('Son kartı geri al')
    expect(byTestId('undo-recall')).not.toBeNull()
    await click(byTestId('undo-recall')!)
    expect(screen()).toBe('recall')
    const r = handle!.getScreen()
    expect(r.name === 'recall' && r.pres.replayOfAttemptId).toBeDefined()
    expect(await repo.listVoids()).toHaveLength(2)
    // 30 sn sonra düğme yok
    await click(byTestId('reveal')!)
    await click(byTestId('sa-good')!)
    expect(byTestId('undo-recall')).toBeNull() // tekrar cevaba token yok (BL-04)
    // yeni bir kart cevabı → çubuk → 31 sn → yok
    const sess = handle!.ctx.session!
    expect(sess.answered).toBe(4)
  })

  it('E-06b — 30 sn penceresi: soru sonucunda Geri al 31 sn sonra görünmez', async () => {
    const { clock } = await setup()
    await toQuestion()
    await click(options()[0]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    expect(byTestId('undo')).not.toBeNull()
    clock.advance(31_000)
    await handle!.render(); await flush()
    expect(phase()).toBe('result')
    expect(byTestId('undo')).toBeNull()
  })

  it('E-07 — kart akışı: Çengeli göster → Cevabı aç → Hatırladım → sonraki; support = hook', async () => {
    const { repo } = await setup({ withQuestion: false, extraAtoms: 1 })
    await click(byTestId('start')!)
    await click(byTestId('read-done')!)
    expect(screen()).toBe('recall')
    expect(text()).toContain('Tanzimat Fermanı hangi yıl ilan edildi?')
    expect(text()).not.toContain('Tanzimat Fermanı 1839') // cevap gizli
    await click(byTestId('show-hook')!)
    expect(text()).toContain('On sekiz otuz dokuz çengeli')
    await click(byTestId('reveal')!)
    expect(text()).toContain('Tanzimat Fermanı 1839 yılında ilan edildi.')
    await click(byTestId('sa-good')!)
    const atts = await repo.listAttempts()
    expect(atts[0]).toMatchObject({ kind: 'recall', support: 'hook', selfAssessment: 'good' })
    expect(screen()).toBe('read') // sonraki öğe
  })

  it('E-08 (T9) — soru girişi: 4 alanla Kaydet → hata metni; 5 alanla → kaydedildi', async () => {
    const { repo } = await setup({ withQuestion: false })
    await click(byText('+ Soru'))
    expect(screen()).toBe('question-form')
    const [textIn] = document.querySelectorAll<HTMLTextAreaElement>('textarea')
    textIn!.value = 'Islahat Fermanı hangi yıl?'
    const inputs = document.querySelectorAll<HTMLInputElement>('input.input')
    inputs[0]!.value = '1856'; inputs[1]!.value = '1839'
    document.querySelector<HTMLInputElement>('input[type=radio][value="0"]')!.checked = true
    const sel = document.querySelector<HTMLSelectElement>('select')!
    sel.value = sel.options[1]!.value
    await click(byTestId('save-question')!)
    expect(text()).toContain('Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak.')
    expect(await repo.listQuestions()).toHaveLength(0)
    const source = [...document.querySelectorAll<HTMLInputElement>('input.input')].find((i) => i.placeholder.startsWith('Kaynak'))!
    source.value = 'kitap s.217'
    await click(byTestId('save-question')!)
    expect(screen()).toBe('today')
    expect(text()).toContain('Soru kaydedildi.')
    const qs = await repo.listQuestions()
    expect(qs).toHaveLength(1)
    expect(qs[0]!.source).toBe('kitap s.217')
  })

  it('E-09 (T15) — mikro mod: 3 dk seç; saat ilerletilir → aktif öğe biter, yenisi gelmez, "Süre doldu"', async () => {
    const { clock } = await setup({ withQuestion: true, extraAtoms: 3 })
    await click(byTestId('start-3')!)
    expect(screen()).toBe('read')
    await click(byTestId('read-done')!)
    clock.advance(3 * MIN + 1000)
    await click(options()[0]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    expect(phase()).toBe('result') // aktif öğe tamamlanır
    await click(byTestId('continue')!)
    expect(screen()).toBe('end')
    expect(text()).toContain('Süre doldu.')
    await click(byTestId('to-today')!)
    expect(screen()).toBe('today')
  })

  it('E-15 — soru sürüm geçmişi: İçerik → soru → düzenle → uyarı metni; geçmişte v1 ve v2 tam içerik', async () => {
    const { q } = await setup()
    await click(byText('İçerik'))
    expect(screen()).toBe('content')
    await click(document.querySelector<HTMLElement>('button[data-atom]')!)
    expect(screen()).toBe('content-atom')
    await click(document.querySelector<HTMLElement>('button[data-question]')!)
    expect(screen()).toBe('content-question')
    await click(byTestId('edit-question')!)
    expect(text()).toContain('Bu değişiklik yeni bir sürüm oluşturur; eski cevapların eski sürümle saklanır.')
    document.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Tanzimat Fermanı hangi yılda ilan edilmiştir?'
    await click(byTestId('save-edit')!)
    expect(screen()).toBe('content-question')
    expect(text()).toContain('v2')
    expect(text()).toContain('Yanlış-şık ve ikincil atom ilişkileri sıfırlandı')
    await click(byTestId('history')!)
    expect(screen()).toBe('content-history')
    const blocks = [...document.querySelectorAll<HTMLElement>('[data-revision]')]
    expect(blocks.map((b) => b.getAttribute('data-revision'))).toEqual(['1', '2'])
    expect(blocks[0]!.textContent).toContain('Tanzimat Fermanı hangi yıl ilan edildi?')
    expect(blocks[0]!.textContent).toContain('1839 (doğru)')
    expect(blocks[1]!.textContent).toContain('Tanzimat Fermanı hangi yılda ilan edilmiştir?')
    expect(q!.question.id).toBeTruthy()
  })

  it('E-16 — oturum içinde yeniden gelen atom: Again → saat 1 dk ileri → Devam → aynı atom yeniden sunulur', async () => {
    const { clock, atomA } = await setup()
    await toQuestion()
    await click(options()[1]!); await click(byTestId('answer')!); await click(byTestId('conf-sure')!)
    await click(byText('Bilmiyordum'))
    expect(phase()).toBe('result')
    clock.advance(1 * MIN)
    await click(byTestId('continue')!)
    expect(screen()).toBe('recall') // aynı atom, kart (dönüşüm)
    const s = handle!.getScreen()
    expect(s.name === 'recall' && s.pres.atom.id).toBe(atomA.id)
  })

  it('E-20 — soru yüzü zorunlu: Atom ekle prompt boş → hata; dolu → kaydedilir', async () => {
    const { repo } = await setup({ withQuestion: false })
    await click(byText('+ Atom'))
    expect(screen()).toBe('atom-form')
    const inputs = document.querySelectorAll<HTMLInputElement>('input.input')
    inputs[0]!.value = 'Coğrafya'; inputs[1]!.value = 'İklim'
    const tas = document.querySelectorAll<HTMLTextAreaElement>('textarea')
    tas[0]!.value = 'Karadeniz kıyısında dağlar kıyıya paralel uzanır.'
    await click(byTestId('save-atom')!)
    expect(text()).toContain('Atom metni ve soru yüzü boş olamaz.')
    expect(await repo.listAtoms()).toHaveLength(1)
    tas[1]!.value = 'Karadeniz kıyısında dağlar kıyıya göre nasıl uzanır?'
    await click(byTestId('save-atom')!)
    expect(screen()).toBe('today')
    expect(await repo.listAtoms()).toHaveLength(2)
    expect((await repo.listSubjects()).map((s) => s.name)).toContain('Coğrafya')
  })

  it('U-DQ-14 (ekran) — newPerDay 0 → Bugün "0 yeni"; ayarlar negatif değeri reddeder', async () => {
    const { motor } = await setup({ withQuestion: false, extraAtoms: 2 })
    await motor.setQueueConfig({ reviewCap: 25, newPerDay: 0 })
    await handle!.render(); await flush()
    const counts = [...document.querySelectorAll<HTMLElement>('.count')].map((c) => c.textContent)
    expect(counts.some((c) => c === '0yeni')).toBe(true)
    await click(byText('Veri'))
    const caps = [...document.querySelectorAll<HTMLInputElement>('input[type=number]')]
    caps[1]!.value = '-1'
    await click(byTestId('save-caps')!)
    expect(text()).toContain('Tavan kaydedilmedi')
  })

  it('I-22 (DOM) — Bugün\'de saat tutarsızlığı uyarısı ve N ileri tarihli kayıt; Veri\'de liste ve "Bu kayıtları geçersiz kıl"', async () => {
    const { clock, repo } = await setup({ withQuestion: false })
    clock.wallMs += 30 * DAY // cihaz saati ileri
    await click(byTestId('start')!)
    await click(byTestId('read-done')!)
    await click(byTestId('reveal')!)
    await click(byTestId('sa-good')!)
    clock.wallMs -= 30 * DAY // saat düzeltildi
    await click(byTestId('to-today')!)
    expect(text()).toContain('Cihaz saati tutarsız görünüyor: 1 kayıt ileri tarihli')
    await click(byText('İncele'))
    expect(screen()).toBe('data')
    expect(text()).toContain('İleri tarihli kayıtlar')
    await click(byTestId('void-skew')!)
    expect((await repo.listVoids()).map((v) => v.reason)).toEqual(['clock_skew'])
    expect(await repo.listAttempts()).toHaveLength(1) // silme yok
    await click(byText('← Bugün'))
    expect(text()).not.toContain('Cihaz saati tutarsız')
  })
})

describe('E-17 — legacy sürüm mesajı (migrate edilmiş veri)', () => {
  const names: string[] = []
  afterEach(async () => { for (const n of names.splice(0)) await Dexie.delete(n) })

  it('İçerik → soru → sürüm geçmişi: eski sürüm satırı "…eski veri modelinde saklanmadığı için mevcut değil"; güncel metin o satırda yok; "sürüm tarihi bilinmiyor"; prompt\'suz atomlar "soru yüzü eksik"', async () => {
    const name = uniqueDbName('e17'); names.push(name)
    await seedLegacyV1(name)
    const clock = new FakeClock()
    const repo = await DexieRepository.open({ name, ids: testIds(), now: () => clock.now() })
    try {
      const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
      handle = mountApp(root, { motor, appVersion: '0.2.0' })
      await flush()
      expect(text()).toContain('Şu an vadesi gelen bir şey yok') // prompt'suz atomlar kuyruğa girmez (E-20 son cümlesi)
      await click(byText('İçerik'))
      expect(text()).toContain('soru yüzü eksik')
      const atomB = document.querySelector<HTMLElement>('button[data-atom="atm-b"]')!
      await click(atomB)
      await click(document.querySelector<HTMLElement>('button[data-question="q-2"]')!)
      await click(byTestId('history')!)
      const blocks = [...document.querySelectorAll<HTMLElement>('[data-revision]')]
      expect(blocks.map((b) => b.getAttribute('data-revision'))).toEqual(['1', '2', '3'])
      expect(blocks[0]!.textContent).toContain(LEGACY_UNAVAILABLE_TEXT)
      expect(blocks[0]!.textContent).not.toContain('Islahat hangi yıl? (v3)')
      expect(blocks[1]!.textContent).toContain(LEGACY_UNAVAILABLE_TEXT)
      expect(blocks[2]!.textContent).toContain('Islahat hangi yıl? (v3)')
      expect(blocks[2]!.textContent).toContain(VERSION_DATE_UNKNOWN) // U-QR-12 UI cümlesi
      // soru yüzü tamamlanınca atom çalışılabilir olur
      await click(byText('← Soru')); await click(byText('← Atom'))
      document.querySelector<HTMLTextAreaElement>('textarea')!.value = 'Islahat Fermanı hangi yıl?'
      await click(byTestId('save-prompt')!)
      expect(text()).toContain('atom artık çalışılabilir')
    } finally {
      handle?.destroy(); handle = null
      repo.close()
    }
  })
})
