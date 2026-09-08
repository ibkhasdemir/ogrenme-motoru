// İçerik içe aktarma — uygulama katmanı (BL-38). Planı Motor'un mevcut ekleme yollarıyla uygular (formla aynı kurallar).
// 06 §5/§9: kullanıcı başlatmalı içe aktarma, kurtarma deposu bağlıysa önce `pre_import` noktası yazılmadan başlamaz;
// nokta yazılamazsa içe aktarma başlamaz. Yalnız ekler; mevcut içerik ve öğrenme geçmişi değişmez.
import type { ImportPlan } from '../engine/import/contentImport'
import type { Motor } from './motor'
import { writeRecoveryPoint, type RecoveryDeps } from './recoveryPoints'

export interface ImportResult {
  atomsAdded: number
  questionsAdded: number
  recoveryPointId: string | null
}

export class ContentImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentImportError'
  }
}

export async function applyContentImport(motor: Motor, plan: ImportPlan, recovery: RecoveryDeps | null): Promise<ImportResult> {
  if (plan.errors.length) throw new ContentImportError(`Planda ${plan.errors.length} hata var; hiçbir şey eklenmedi.`)
  if (!plan.atoms.length && !plan.questions.length) throw new ContentImportError('Eklenecek yeni içerik yok.')

  let recoveryPointId: string | null = null
  if (recovery) {
    const rec = await writeRecoveryPoint(recovery, 'pre_import') // fırlatırsa içe aktarma başlamaz
    recoveryPointId = rec.id
  }

  const newIds: string[] = []
  for (const a of plan.atoms) {
    const atom = await motor.addAtom({
      subjectName: a.subjectName, topicName: a.topicName, text: a.text, prompt: a.prompt, facets: a.facets, hooks: a.hooks,
      ...(a.why ? { why: a.why } : {}),
      ...(a.how ? { how: a.how } : {}),
    })
    newIds.push(atom.id)
  }

  let questionsAdded = 0
  for (const q of plan.questions) {
    const primaryAtomId = q.atom.kind === 'new' ? newIds[q.atom.index] : q.atom.atomId
    if (!primaryAtomId) throw new ContentImportError('İç hata: sorunun atomu çözülemedi')
    await motor.addQuestion({ primaryAtomId, source: q.source, text: q.text, options: q.options, correctIndex: q.correctIndex })
    questionsAdded++
  }
  return { atomsAdded: newIds.length, questionsAdded, recoveryPointId }
}
