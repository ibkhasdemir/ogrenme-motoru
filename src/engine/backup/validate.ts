// 06 §8 adım 1–5 ve §8.2 — Güvenli geri yükleme doğrulaması (saf; ana DB'ye dokunmaz). Sıra: parse → (format, şema) matrisi →
// GELEN formatın kendi checksum'ı → bellekte migration → güncel şema yapısal/referans/semantik doğrulama.
// Bozuk yedek aktif veriyi asla değiştirmez: hata varsa red. Sessiz budama yoktur (B-30).
import type { Attempt, QuestionAttempt, QuestionRevision } from '../../domain'
import {
  ATOM_FACETS, ATTEMPT_KINDS, ATTEMPT_MODES, ATTEMPT_VOID_REASONS, CONFIDENCES, HOOK_TYPES, OPERATIONS, OPTION_ATOM_RELATIONS,
  QUESTION_ATOM_ROLES, RELATION_TYPES, SELF_ASSESSMENTS, SUPPORTS, WRONG_REASONS, isCompleteRevision, revisionStatus,
} from '../../domain'
import type { HashService } from '../../platform/services'
import { checksumMatches } from './checksum'
import { BackupMigrationError, migrateBackupToCurrent } from './migrateBackup'
import { BACKUP_FORMAT_VERSION, type BackupFile } from './types'

export const SUPPORTED_SCHEMA_VERSION = 2

export interface ValidationReport {
  errors: string[]
  warnings: string[]
}

export type ParsedBackup =
  | { kind: 'backup'; file: BackupFile }
  | { kind: 'recovery_dump' }
  | { kind: 'invalid'; error: string }

export function parseBackupText(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'invalid', error: 'Dosya JSON olarak okunamadı' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid', error: 'Yedek bir nesne değil' }
  const obj = raw as Record<string, unknown>
  if (obj['kind'] === 'recovery_dump') return { kind: 'recovery_dump' } // 06 §6.3: normal yedek değildir
  return { kind: 'backup', file: obj as unknown as BackupFile }
}

/** 06 §7 matrisi: (1,1) → migrate; (2,2) → doğrudan; bilinen format + bilinmeyen/ileri şema → red; bilinmeyen format → red. */
export function checkFormatMatrix(file: BackupFile): { ok: true; path: 'direct' | 'migrate' } | { ok: false; error: string } {
  const f = file.backupFormatVersion
  const s = file.schemaVersion
  if (!Number.isInteger(f) || !Number.isInteger(s)) return { ok: false, error: 'backupFormatVersion / schemaVersion tamsayı değil' }
  if (f === 1 && s === 1) return { ok: true, path: 'migrate' }
  if (f === 2 && s === 2) return { ok: true, path: 'direct' }
  if (f === 1 || f === 2) return { ok: false, error: s > SUPPORTED_SCHEMA_VERSION ? 'Bu yedek daha yeni bir veri şemasıyla alınmış' : `Desteklenmeyen (format ${f}, şema ${s}) bileşimi` }
  return { ok: false, error: f > BACKUP_FORMAT_VERSION ? 'Bu yedek daha yeni bir uygulama sürümüyle alınmış (bilinmeyen format)' : `Bilinmeyen yedek formatı: ${f}` }
}

const isIso = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1
const inEnum = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 06 §8.2 — tam yedek için sert doğrulama (schemaVersion 2). */
export function validateSnapshotV2(file: BackupFile): ValidationReport {
  const errors: string[] = []
  const warnings: string[] = []
  const err = (m: string) => { if (errors.length < 200) errors.push(m) }

  if (!isObj(file.content) || !isObj(file.events) || !isObj(file.config)) return { errors: ['content / events / config eksik'], warnings }
  const c = file.content
  const e = file.events
  for (const k of ['subjects', 'topics', 'atoms', 'hooks', 'questions', 'questionRevisions', 'questionAtoms', 'optionAtoms', 'atomRelations', 'inbox'] as const) {
    if (!Array.isArray(c[k])) err(`content.${k} dizi değil`)
  }
  for (const k of ['attempts', 'voids'] as const) if (!Array.isArray(e[k])) err(`events.${k} dizi değil`)
  if (errors.length) return { errors, warnings }

  // --- config ---
  const cfg = file.config
  if (!isObj(cfg.evidencePolicy) || !isPosInt(cfg.evidencePolicy.policyVersion)) err('config.evidencePolicy.policyVersion eksik/geçersiz')
  const sc = cfg.schedulerConfig
  if (!isObj(sc)) err('config.schedulerConfig eksik')
  else {
    if (!isPosInt(sc.configVersion)) err('schedulerConfig.configVersion bilinmiyor (pozitif tamsayı değil)') // BL-08
    for (const k of ['engine', 'engineVersion', 'algorithm'] as const) if (!isStr(sc[k]) || !sc[k]) err(`schedulerConfig.${k} eksik`)
    if (typeof sc.requestRetention !== 'number' || !(sc.requestRetention > 0 && sc.requestRetention < 1)) err('schedulerConfig.requestRetention (0,1) aralığında değil')
    if (!isPosInt(sc.maximumInterval)) err('schedulerConfig.maximumInterval geçersiz')
    if (sc.enableFuzz !== false) err('schedulerConfig.enableFuzz false olmalı (02 §4.2 determinizm)')
    if (!Array.isArray(sc.learningSteps) || !Array.isArray(sc.relearningSteps)) err('schedulerConfig adımları dizi değil')
    if (sc.weights !== null && sc.weights !== undefined && !(Array.isArray(sc.weights) && sc.weights.every((w) => typeof w === 'number'))) err('schedulerConfig.weights geçersiz')
  }
  if (!isObj(cfg.queueConfig) || !isNonNegInt(cfg.queueConfig.reviewCap) || !isNonNegInt(cfg.queueConfig.newPerDay)) err('config.queueConfig geçersiz')
  for (const k of ['evidencePolicyHistory', 'schedulerConfigHistory'] as const) {
    const h = cfg[k]
    if (!Array.isArray(h)) err(`config.${k} dizi değil`)
    else for (const r of h) if (!isObj(r) || !isStr(r['kind']) || !isIso(r['at'])) err(`config.${k}: kayıtta kind/at eksik`)
  }

  // --- içerik: ebeveyn referansları ---
  const subjects = new Set<string>()
  for (const s of c.subjects) { if (!isStr(s.id) || !isStr(s.name) || typeof s.sortOrder !== 'number') err(`Subject zorunlu alan eksik: ${String(s.id)}`); subjects.add(s.id) }
  const topics = new Set<string>()
  for (const t of c.topics) {
    if (!isStr(t.id) || !isStr(t.name) || typeof t.sortOrder !== 'number') err(`Topic zorunlu alan eksik: ${String(t.id)}`)
    if (!subjects.has(t.subjectId)) err(`Topic.subjectId çözülmüyor: ${t.id} → ${t.subjectId}`)
    topics.add(t.id)
  }
  const atoms = new Set<string>()
  for (const a of c.atoms) {
    if (!isStr(a.id) || !isStr(a.text) || !isStr(a.prompt) || typeof a.sortOrder !== 'number' || typeof a.archived !== 'boolean' || !isIso(a.createdAt)) err(`Atom zorunlu alan eksik: ${String(a.id)}`)
    if (!Array.isArray(a.facets) || a.facets.length === 0 || !a.facets.every((f) => inEnum(ATOM_FACETS, f))) err(`Atom.facets geçersiz: ${a.id}`)
    if (!topics.has(a.topicId)) err(`Atom.topicId çözülmüyor: ${a.id} → ${a.topicId}`)
    atoms.add(a.id)
  }
  for (const h of c.hooks) {
    if (!isStr(h.id) || !isStr(h.content) || !inEnum(HOOK_TYPES, h.type)) err(`MemoryHook geçersiz: ${String(h.id)}`)
    if (!atoms.has(h.atomId)) err(`MemoryHook.atomId çözülmüyor: ${h.id}`)
  }
  for (const r of c.atomRelations) {
    if (!inEnum(RELATION_TYPES, r.type)) err('AtomRelation.type enum dışı')
    if (!atoms.has(r.fromAtomId) || !atoms.has(r.toAtomId)) err('AtomRelation atomu çözülmüyor')
  }

  // --- revision'lar ---
  const revKey = (q: string, v: number) => `${q} ${v}`
  const revisions = new Map<string, QuestionRevision>()
  for (const r of c.questionRevisions) {
    if (!isStr(r.questionId) || !isPosInt(r.version)) { err('QuestionRevision questionId/version geçersiz'); continue }
    const key = revKey(r.questionId, r.version)
    if (revisions.has(key)) err(`Tekrarlı revision: ${key}`)
    revisions.set(key, r)
    const status = revisionStatus(r)
    if (status === 'complete') {
      const cr = r as Extract<QuestionRevision, { integrityStatus?: 'complete' }>
      if (!isStr(cr.text) || !Array.isArray(cr.options) || !isStr(cr.correctOptionId)) { err(`complete revision içeriği eksik: ${key}`); continue }
      if (cr.options.length < 2) err(`revision seçenek sayısı < 2: ${key}`)
      const ids = new Set<string>()
      for (const o of cr.options) { if (!isStr(o.id) || !isStr(o.text)) err(`seçenek geçersiz: ${key}`); if (ids.has(o.id)) err(`revision içinde tekrarlı option id: ${key}/${o.id}`); ids.add(o.id) }
      if (!ids.has(cr.correctOptionId)) err(`correctOptionId seçeneklerde yok: ${key}`)
      if (!isStr(cr.primaryAtomId) || !atoms.has(cr.primaryAtomId)) err(`complete revision primaryAtomId çözülmüyor: ${key}`)
      if (cr.createdAt === null) {
        if (cr.legacyProvenance?.createdAtSource !== 'unknown') err(`complete revision createdAt null ama createdAtSource ≠ unknown (uydurma/eksik tarih): ${key}`)
      } else if (!isIso(cr.createdAt)) err(`revision createdAt geçersiz: ${key}`)
    } else if (status === 'content_unavailable_legacy') {
      if (r.text !== null || r.options !== null || r.correctOptionId !== null) err(`content_unavailable_legacy revision içerik taşıyor (sahte içerik göstergesi): ${key}`)
      if (r.createdAt !== null) err(`content_unavailable_legacy revision createdAt dolu: ${key}`)
      if (!isObj(r.legacyProvenance) || !isIso(r.legacyProvenance.migratedAt)) err(`content_unavailable_legacy revision legacyProvenance eksik: ${key}`)
      if (r.primaryAtomId !== null && !atoms.has(r.primaryAtomId)) err(`legacy revision primaryAtomId çözülmüyor: ${key}`)
    } else err(`revision integrityStatus enum dışı: ${key}`)
  }

  // --- sorular ---
  const questions = new Map<string, (typeof c.questions)[number]>()
  for (const q of c.questions) {
    if (!isStr(q.id) || !isPosInt(q.currentVersion) || !isStr(q.source) || typeof q.archived !== 'boolean' || !isIso(q.createdAt)) err(`Question zorunlu alan eksik: ${String(q.id)}`)
    if (!(q.updatedAt === null || isIso(q.updatedAt))) err(`Question.updatedAt geçersiz: ${q.id}`) // null yalnız migration'dan (BL-13)
    if (questions.has(q.id)) err(`Tekrarlı soru: ${q.id}`)
    questions.set(q.id, q)
    if (!atoms.has(q.primaryAtomId)) err(`Question.primaryAtomId çözülmüyor: ${q.id}`)
    const cur = revisions.get(revKey(q.id, q.currentVersion))
    if (!cur) err(`Question.currentVersion revision'ı yok: ${q.id} v${q.currentVersion}`)
    else if (cur.primaryAtomId !== q.primaryAtomId) err(`Question.primaryAtomId ≠ currentRevision.primaryAtomId: ${q.id}`)
  }
  for (const r of revisions.values()) if (!questions.has(r.questionId)) err(`Revision'ın sorusu yok: ${r.questionId}`)

  // --- QuestionAtom / OptionAtom ---
  const primaryByQ = new Map<string, string[]>()
  for (const qa of c.questionAtoms) {
    if (!inEnum(QUESTION_ATOM_ROLES, qa.role)) err('QuestionAtom.role enum dışı')
    if (!questions.has(qa.questionId)) err(`QuestionAtom sorusu yok: ${qa.questionId}`)
    if (!atoms.has(qa.atomId)) err(`QuestionAtom atomu yok: ${qa.atomId}`)
    if (qa.role === 'primary') primaryByQ.set(qa.questionId, [...(primaryByQ.get(qa.questionId) ?? []), qa.atomId])
  }
  for (const q of questions.values()) {
    const p = primaryByQ.get(q.id) ?? []
    if (p.length !== 1) err(`QuestionAtom(primary) eksik veya birden çok: ${q.id}`)
    else if (p[0] !== q.primaryAtomId) err(`QuestionAtom(primary) ≠ Question.primaryAtomId: ${q.id}`)
  }
  for (const oa of c.optionAtoms) {
    if (!inEnum(OPTION_ATOM_RELATIONS, oa.relation)) err('OptionAtom.relation enum dışı')
    const q = questions.get(oa.questionId)
    if (!q) { err(`OptionAtom sorusu yok: ${oa.questionId}`); continue }
    if (!atoms.has(oa.atomId)) err(`OptionAtom atomu yok: ${oa.atomId}`)
    const cur = revisions.get(revKey(q.id, q.currentVersion))
    if (cur && isCompleteRevision(cur)) {
      if (!cur.options.some((o) => o.id === oa.optionId)) err(`OptionAtom seçeneği güncel sürümde yok: ${q.id}/${oa.optionId}`)
      if (cur.correctOptionId === oa.optionId) err(`OptionAtom doğru seçenekte: ${q.id}/${oa.optionId} (01 §2.8)`)
    }
  }

  // --- ham olaylar ---
  const attemptIds = new Set<string>()
  const sequences = new Set<number>()
  const attempts = e.attempts
  for (const a of attempts) {
    if (!isStr(a.id)) { err('Attempt.id eksik'); continue }
    if (attemptIds.has(a.id)) err(`Tekrarlı Attempt id: ${a.id}`)
    attemptIds.add(a.id)
    if (!isNonNegInt(a.sequence)) err(`Attempt.sequence geçersiz: ${a.id}`)
    else { if (sequences.has(a.sequence)) err(`Tekrarlı sequence: ${a.sequence}`); sequences.add(a.sequence) }
    if (!inEnum(ATTEMPT_KINDS, a.kind)) err(`Attempt.kind enum dışı: ${a.id}`)
    if (!isIso(a.timestamp) || !isStr(a.sessionId)) err(`Attempt timestamp/sessionId geçersiz: ${a.id}`)
    if (!atoms.has(a.primaryAtomIdAtAttempt)) err(`Attempt.primaryAtomIdAtAttempt çözülmüyor: ${a.id}`)
    if (!inEnum(ATTEMPT_MODES, a.mode)) err(`Attempt.mode enum dışı: ${a.id}`)
    // 05 §5a F02: yalnız external (yakalama) Attempt'ında support ve responseTimeMs "uygulanamaz" (null); başka modda null kabul edilmez
    const external = a.mode === 'external'
    if (!inEnum(OPERATIONS, a.operation)) err(`Attempt.operation enum dışı: ${a.id}`)
    if (!(external && a.support === null) && !inEnum(SUPPORTS, a.support)) err(`Attempt.support enum dışı: ${a.id}`)
    if (!(external && a.responseTimeMs === null) && !isNonNegInt(a.responseTimeMs)) err(`Attempt.responseTimeMs negatif/tamsayı değil: ${a.id}`)
    if (a.sourceInboxItemId !== undefined && !isStr(a.sourceInboxItemId)) err(`Attempt.sourceInboxItemId metin olmalı: ${a.id}`)
    if (a.kind === 'question') {
      const qa = a as QuestionAttempt
      if (!inEnum(CONFIDENCES, qa.confidence)) err(`QuestionAttempt.confidence geçersiz: ${a.id}`)
      if (!(qa.wrongReason === null || qa.wrongReason === undefined || inEnum(WRONG_REASONS, qa.wrongReason))) err(`wrongReason enum dışı: ${a.id}`)
      if (typeof qa.correct !== 'boolean' || typeof qa.changedAnswer !== 'boolean') err(`QuestionAttempt correct/changedAnswer eksik: ${a.id}`)
      if (!isPosInt(qa.questionVersion)) err(`questionVersion geçersiz: ${a.id}`)
      const rev = revisions.get(revKey(qa.questionId, qa.questionVersion))
      if (!rev) err(`Attempt'ın QuestionRevision'ı yok: ${a.id} → ${qa.questionId} v${qa.questionVersion}`)
      else if (isCompleteRevision(rev)) {
        if (qa.primaryAtomIdAtAttempt !== rev.primaryAtomId) err(`Attempt snapshot atomu ≠ revision.primaryAtomId: ${a.id}`)
        if (!rev.options.some((o) => o.id === qa.selectedOptionId)) err(`selectedOptionId revision seçeneklerinde yok: ${a.id}`)
        else if (qa.correct !== (qa.selectedOptionId === rev.correctOptionId)) err(`Attempt.correct revision ile çelişkili: ${a.id}`)
      }
    } else if (a.kind === 'recall') {
      const ra = a as { id: string; confidence: unknown; selfAssessment: unknown; atomId: unknown; primaryAtomIdAtAttempt: string }
      if (ra.confidence !== null) err(`RecallAttempt.confidence null olmalı: ${ra.id}`)
      if (!inEnum(SELF_ASSESSMENTS, ra.selfAssessment)) err(`selfAssessment enum dışı: ${ra.id}`)
      if (ra.atomId !== ra.primaryAtomIdAtAttempt) err(`RecallAttempt.atomId ≠ primaryAtomIdAtAttempt: ${ra.id}`)
    }
  }
  for (const a of attempts as Attempt[]) if (a.replayOfAttemptId !== undefined && !attemptIds.has(a.replayOfAttemptId)) err(`replayOfAttemptId bilinmeyen Attempt'a işaret ediyor: ${a.id}`)
  const voidTargets = new Set<string>()
  const voidIds = new Set<string>()
  for (const v of e.voids) {
    if (!isStr(v.id)) { err('AttemptVoid.id eksik'); continue }
    if (voidIds.has(v.id)) err(`Tekrarlı void id: ${v.id}`)
    voidIds.add(v.id)
    if (!attemptIds.has(v.targetAttemptId)) err(`AttemptVoid hedefi bilinmiyor: ${v.id} → ${v.targetAttemptId}`)
    if (voidTargets.has(v.targetAttemptId)) err(`Aynı hedefe birden çok void: ${v.targetAttemptId}`)
    voidTargets.add(v.targetAttemptId)
    if (!isNonNegInt(v.sequence)) err(`void.sequence geçersiz: ${v.id}`)
    else { if (sequences.has(v.sequence)) err(`Tekrarlı sequence (void): ${v.sequence}`); sequences.add(v.sequence) }
    if (!isIso(v.timestamp) || !inEnum(ATTEMPT_VOID_REASONS, v.reason)) err(`void timestamp/reason geçersiz: ${v.id}`)
  }

  // --- yalnız uyarı ---
  if (file.derived) warnings.push('Paketteki derived (önbellek) okunmaz; hafıza durumu REBUILD ile üretilir.')
  for (const i of c.inbox) if (isObj(i) && !isStr(i.id)) warnings.push('inbox öğesinde id eksik (yok sayıldı)')

  return { errors, warnings }
}

export type BackupValidation =
  | { ok: true; file: BackupFile; original: BackupFile; path: 'direct' | 'migrate'; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

/** 06 §8 adım 1–5 (commit öncesi; ana DB'ye dokunulmaz). */
export async function validateBackupText(text: string, hash: HashService, now: string): Promise<BackupValidation> {
  const parsed = parseBackupText(text) // 1
  if (parsed.kind === 'invalid') return { ok: false, errors: [parsed.error], warnings: [] }
  if (parsed.kind === 'recovery_dump') return { ok: false, errors: ['Bu bir kurtarma dökümü; normal yedek değil'], warnings: [] }
  return validateBackupFile(parsed.file, hash, now)
}

export async function validateBackupFile(original: BackupFile, hash: HashService, now: string): Promise<BackupValidation> {
  const warnings: string[] = []
  const matrix = checkFormatMatrix(original) // 2
  if (!matrix.ok) return { ok: false, errors: [matrix.error], warnings }
  // 3 — gelen formatın KENDİ doğrulayıcısı, migration'dan ÖNCE (B-31)
  if (original.backupFormatVersion >= 2) {
    if (!(await checksumMatches(original, hash))) return { ok: false, errors: ['Sağlama toplamı uyuşmuyor'], warnings }
  } else {
    warnings.push('Format 1: sağlama toplamı yok')
    const v1 = validateFormat1Shape(original)
    if (v1.length) return { ok: false, errors: v1, warnings }
  }
  // 4 — bellekte migration
  let file: BackupFile
  try {
    file = matrix.path === 'migrate' ? migrateBackupToCurrent(original, now) : original
  } catch (e) {
    return { ok: false, errors: [e instanceof BackupMigrationError ? e.message : 'Yedek dönüştürülemedi'], warnings }
  }
  // 5 — güncel şema
  const report = validateSnapshotV2(file)
  warnings.push(...report.warnings)
  if (report.errors.length) return { ok: false, errors: report.errors, warnings }
  return { ok: true, file, original, path: matrix.path, warnings }
}

/** Format-1 yapısal kurallar (BL-10 varsayımı): questions[] içerik alanları baş kayıtta; events dizileri var. */
export function validateFormat1Shape(file: BackupFile): string[] {
  const errors: string[] = []
  const c = file.content as unknown as Record<string, unknown>
  const e = file.events as unknown as Record<string, unknown>
  if (!isObj(c) || !Array.isArray(c['questions']) || !Array.isArray(c['atoms'])) errors.push('Format 1: content.questions / content.atoms dizi değil')
  if (!isObj(e) || !Array.isArray(e['attempts']) || !Array.isArray(e['voids'])) errors.push('Format 1: events.attempts / events.voids dizi değil')
  if (errors.length) return errors
  for (const q of c['questions'] as Record<string, unknown>[]) {
    if (!isStr(q['id']) || !isStr(q['text']) || !Array.isArray(q['options']) || !isStr(q['correctOptionId']) || !isStr(q['primaryAtomId'])) errors.push(`Format 1 soru alanları eksik: ${String(q['id'])}`)
  }
  return errors
}
