// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Motor, type Presentation } from '../src/app/motor'
import { MIN_FOR_RATE, atomStats, hardestAtoms, isSureButWrong, liveAttempts, successRate, sureButWrongAtoms, summarize, topicStats } from '../src/engine/analysis/stats'
import { MemoryRepository } from '../src/store/memory/memoryRepository'
import { mountApp, type AppHandle } from '../src/ui/app'
import { DAY, FakeClock, fakeIds } from './helpers/engineFixture'

// Phase 15 (BL-42) — İlerleme: yalnız ham olaylardan sayım; void edilen ve pretest denemeler sayılmaz;
// veri azken oran gösterilmez; ekran sıralamayı/vadeleri etkilemez.

const flush = async (n = 14) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const byText = (label: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.textContent ?? '').trim().startsWith(label))!
const click = async (el: HTMLElement) => { el.click(); await flush() }
const section = (name: string) => document.querySelector<HTMLElement>(`[data-section="${name}"]`)

async function seeded(clock = new FakeClock()) {
  const repo = new MemoryRepository(fakeIds('gen'))
  const motor = await Motor.create({ repo, clock, ids: fakeIds('id') })
  const atom = await motor.addAtom({ subjectName: 'Tarih', topicName: '18. yy › Antlaşmalar', text: 'Küçük Kaynarca 1774.', prompt: 'Küçük Kaynarca hangi yıl?' })
  const q = await motor.addQuestion({ primaryAtomId: atom.id, source: 'kendi', text: 'Küçük Kaynarca hangi yıl?', options: ['1774', '1699', '1718'], correctIndex: 0 })
  return { repo, motor, clock, atom, q }
}

/**
 * Atomu bir kez cevapla. Motor soru ↔ kart arasında dönüşümlü sunar (04 §2), bu yüzden ikisini de karşılarız:
 * soruda güven, kartta öz değerlendirme aynı sonucu (doğru/yanlış) verir.
 */
async function answer(motor: Motor, atomId: string, opts: { correct: boolean; confidence: 'sure' | 'unsure' | 'guess' }) {
  const session = motor.startSession(null)
  await motor.next(session)
  const pres = await motor.presentAtom(atomId)
  if (pres.kind === 'question') {
    const p = pres as Extract<Presentation, { kind: 'question' }>
    const pick = opts.correct ? p.revision.correctOptionId : p.revision.options.find((o) => o.id !== p.revision.correctOptionId)!.id
    return motor.answerQuestion(session, p, {
      initialSelectedOptionId: pick, selectedOptionId: pick, confidence: opts.confidence,
      ...(opts.correct ? {} : { wrongReason: 'confused' as const }), responseTimeMs: 1000,
    })
  }
  if (pres.kind !== 'recall') throw new Error(`soru ya da kart bekleniyordu, gelen: ${pres.kind}`)
  return motor.answerRecall(session, pres, { selfAssessment: opts.correct ? 'good' : 'again', hookShown: false, responseTimeMs: 1000 })
}

describe('Analiz sayımı (saf)', () => {
  it('geri alınan (void edilen) deneme hiçbir sayıma girmez; ham kayıt durur', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await seeded(clock)
    const session = motor.startSession(null)
    await motor.next(session)
    const pres = await motor.presentAtom(atom.id)
    if (pres.kind !== 'question') throw new Error('soru bekleniyordu')
    const wrong = pres.revision.options.find((o) => o.id !== pres.revision.correctOptionId)!.id
    const { token } = await motor.answerQuestion(session, pres, { initialSelectedOptionId: wrong, selectedOptionId: wrong, confidence: 'sure', wrongReason: 'confused', responseTimeMs: 900 })
    const input0 = { attempts: motor.listAttempts(), voids: motor.listVoids(), atoms: [], topics: [], subjects: [] }
    expect(summarize(input0)).toMatchObject({ answered: 1, failed: 1, sureButWrong: 1 })
    expect(await motor.undo(session, token!)).toBe(true)
    const input1 = { attempts: motor.listAttempts(), voids: motor.listVoids(), atoms: [], topics: [], subjects: [] }
    expect(motor.listAttempts()).toHaveLength(1) // ham kayıt silinmez
    expect(liveAttempts(motor.listAttempts(), motor.listVoids())).toHaveLength(0)
    expect(summarize(input1)).toMatchObject({ answered: 0, failed: 0, sureButWrong: 0 })
  })

  it('emin olup yanlış ayrı sayılır; sallayıp doğru başarısızlık sayılmaz ama motor için Again üretir', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await seeded(clock)
    const a1 = (await answer(motor, atom.id, { correct: false, confidence: 'sure' })).attempt
    clock.advance(DAY)
    const a2 = (await answer(motor, atom.id, { correct: true, confidence: 'guess' })).attempt
    expect(isSureButWrong(a1)).toBe(true)
    expect(isSureButWrong(a2)).toBe(false)
    const stats = atomStats({ attempts: motor.listAttempts(), voids: motor.listVoids(), atoms: [], topics: [], subjects: [] })
    expect(stats[0]).toMatchObject({ answered: 2, failed: 1, sureButWrong: 1, failStreak: 0 })
    expect(sureButWrongAtoms(stats)).toHaveLength(1)
  })

  it('failStreak son denemeden geriye sayar; hardestAtoms önce üst üste başarısızlığa bakar', () => {
    const mk = (id: string, seq: number, correct: boolean, atomId: string) => ({
      id, kind: 'question' as const, sequence: seq, timestamp: `2026-09-0${seq}T10:00:00.000Z`, sessionId: 's',
      primaryAtomIdAtAttempt: atomId, mode: 'review' as const, confidence: 'unsure' as const, operation: 'discriminate' as const,
      support: 'choices' as const, responseTimeMs: 100, questionId: 'q', questionVersion: 1, initialSelectedOptionId: 'o1',
      selectedOptionId: 'o1', changedAnswer: false, correct, wrongReason: null,
    })
    const attempts = [mk('1', 1, false, 'A'), mk('2', 2, false, 'A'), mk('3', 3, false, 'B'), mk('4', 4, true, 'B'), mk('5', 5, false, 'B')]
    const stats = atomStats({ attempts, voids: [], atoms: [], topics: [], subjects: [] })
    const A = stats.find((s) => s.atomId === 'A')!
    const B = stats.find((s) => s.atomId === 'B')!
    expect(A).toMatchObject({ answered: 2, failed: 2, failStreak: 2 })
    expect(B).toMatchObject({ answered: 3, failed: 2, failStreak: 1 })
    expect(hardestAtoms(stats).map((s) => s.atomId)).toEqual(['A', 'B'])
  })

  it('oran yalnız yeterli veride: eşiğin altında null', () => {
    expect(successRate(MIN_FOR_RATE - 1, 0)).toBeNull()
    expect(successRate(MIN_FOR_RATE, 1)).toBe(80)
    expect(successRate(10, 0)).toBe(100)
  })

  it('konu sayımı çalışılmamış atomları da kapsar (kapsam görünsün)', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await seeded(clock)
    await motor.addAtom({ subjectName: 'Tarih', topicName: '18. yy › Antlaşmalar', text: 'Prut 1711.', prompt: 'Prut?' })
    await answer(motor, atom.id, { correct: true, confidence: 'sure' })
    const c = await motor.content()
    const input = { attempts: motor.listAttempts(), voids: motor.listVoids(), atoms: c.atoms, topics: c.topics, subjects: c.subjects }
    const t = topicStats(input, atomStats(input))
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ label: 'Tarih › 18. yy › Antlaşmalar', atoms: 2, studiedAtoms: 1, answered: 1, failed: 0 })
  })
})

describe('İlerleme ekranı', () => {
  let handle: AppHandle | null = null
  let root: HTMLDivElement
  beforeEach(() => { root = document.createElement('div'); document.body.appendChild(root) })
  afterEach(() => { handle?.destroy(); handle = null; document.body.replaceChildren() })

  it('veri azken oran yerine "yeterli veri yok"; emin-yanlış ve zorlandıkların listelenir; atoma gidilir', async () => {
    const clock = new FakeClock()
    const { motor, atom } = await seeded(clock)
    await answer(motor, atom.id, { correct: false, confidence: 'sure' })
    clock.advance(DAY)
    await answer(motor, atom.id, { correct: false, confidence: 'unsure' })
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    const dueBefore = motor.memory.get(atom.id)!.due
    await click(byTestId('to-progress')!)
    expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('progress')
    expect(section('summary')!.textContent).toContain('yeterli veri yok')
    expect(section('sure-wrong')!.textContent).toContain('1 kez emin olup yanlış')
    expect(section('hardest')!.textContent).toContain('2 kez üst üste başarısız')
    expect(section('topics')!.textContent).toContain('Tarih › 18. yy › Antlaşmalar')
    expect(motor.memory.get(atom.id)!.due).toBe(dueBefore) // ekran vadeye dokunmaz
    await click(document.querySelector<HTMLElement>(`[data-stat-atom="${atom.id}"]`)!)
    expect(document.querySelector('[data-screen]')?.getAttribute('data-screen')).toBe('content-atom')
  })

  it('hiç cevap yokken ekran boş değil, açık cümle kurar', async () => {
    const { motor } = await seeded()
    handle = mountApp(root, { motor, appVersion: '0.2.0' })
    await flush()
    await click(byText('İlerleme'))
    expect(byTestId('lifetime')!.textContent).toBe('Henüz hiç cevap yok.')
    expect(document.body.textContent).toContain('Çalışmaya başlayınca burada zorlandığın atomlar listelenir.')
    expect(section('sure-wrong')).toBeNull()
  })
})
