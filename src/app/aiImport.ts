// Yapay zekâ ile içerik üretimi (BL-44) — uygulama katmanı orkestrasyonu.
// A18: üretilen şey ÖNERİDİR. Bu modül yalnız METİN alır ve mevcut içe aktarma doğrulamasına verir; hiçbir yazma yapmaz.
// Yazma, kullanıcının önizleyip "Ekle" dediği yoldan (applyContentImport) geçer.
import { parseContentImport, planContentImport, applyUnitToPlan, type ExistingContent, type ImportPlan } from '../engine/import/contentImport'
import { AiError, type AiService } from '../platform/ai'

export interface GenerateInput {
  notes: string
  unit: string
  existing: ExistingContent
  /** şablon metni (ui/contentImport.ts) — tek kaynak; burada kopyalanmaz */
  buildPrompt: (notes: string, unit: string) => string
  signal?: AbortSignal
}

export interface GenerateOutput {
  /** ham yanıt: kullanıcı görmek isterse gösterilir, hata ayıklamada işe yarar */
  raw: string
  plan: ImportPlan
}

export class AiGenerateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiGenerateError'
  }
}

/**
 * Notu şablonla birlikte modele gönderir, dönen metni tolere ederek ayrıştırır (``` çiti / açıklama cümlesi),
 * mevcut içerikle planlar ve ünite kuralını uygular. Plan hatalıysa hata FIRLATMAZ: hatalar planda taşınır,
 * ekran onları gösterir ve "Ekle" kapalı kalır (yanlış içerik sessizce eklenmez).
 */
export async function generateImportPlan(ai: AiService, input: GenerateInput): Promise<GenerateOutput> {
  const notes = input.notes.trim()
  if (!notes) throw new AiGenerateError('Önce ders notunu yapıştır.')
  let raw: string
  try {
    raw = await ai.complete({ prompt: input.buildPrompt(notes, input.unit), ...(input.signal ? { signal: input.signal } : {}) })
  } catch (e) {
    throw new AiGenerateError(e instanceof AiError ? e.message : `Üretilemedi: ${(e as Error).message}`)
  }
  const plan = applyUnitToPlan(planContentImport(parseContentImport(raw), input.existing), input.unit)
  return { raw, plan }
}
