// 06 §8.3 — Eski yedek uyumluluğu: yayımlanmış format okunamaz hâle gelemez. migrateBackup(1 → 2) saf; 06 §6.2 ile AYNI kural:
// exact `complete` revision (version = question.version), içeriği bulunmayan sürümler için `content_unavailable_legacy`;
// güncel içerik eski sürüme kopyalanmaz; legacy sürüm tarihi uydurulmaz (BL-01).
import type { CompleteQuestionRevision, LegacyUnavailableQuestionRevision, Question, QuestionRevision } from '../../domain'
import { BACKUP_FORMAT_VERSION, type BackupFile } from './types'

export class BackupMigrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupMigrationError'
  }
}

/** Format 1 paketinde soru: içerik + version baş kayıtta (BL-10 varsayımı). */
interface LegacyQuestionRecord {
  id: string
  version?: number
  text: string
  options: { id: string; text: string }[]
  correctOptionId: string
  primaryAtomId: string
  source: string
  archived?: boolean
  createdAt: string
  updatedAt?: unknown
  [k: string]: unknown
}

export function migrateBackup1to2(file: BackupFile, now: string): BackupFile {
  if (file.backupFormatVersion !== 1) throw new BackupMigrationError(`migrateBackup(1→2) format ${file.backupFormatVersion} almaz`)
  const content = file.content as unknown as Record<string, unknown[]>
  const legacyQuestions = (content['questions'] ?? []) as LegacyQuestionRecord[]
  const revisions: QuestionRevision[] = []
  const questions: Question[] = []
  for (const q of legacyQuestions) {
    const version = typeof q.version === 'number' && q.version >= 1 ? q.version : 1
    const rev: CompleteQuestionRevision = {
      questionId: q.id,
      version,
      integrityStatus: 'complete',
      text: q.text,
      options: q.options,
      correctOptionId: q.correctOptionId,
      primaryAtomId: q.primaryAtomId,
      createdAt: version === 1 ? q.createdAt : null,
      legacyProvenance: { migratedAt: now, fromSchemaVersion: 1, createdAtSource: version === 1 ? 'legacy_created_at' : 'unknown' },
    }
    revisions.push(rev)
    const { text: _t, options: _o, correctOptionId: _c, version: _v, ...rest } = q
    questions.push({ ...(rest as unknown as Question), currentVersion: version, archived: q.archived ?? false, updatedAt: typeof q.updatedAt === 'string' ? q.updatedAt : null })
  }
  const pairs = new Map<string, { questionId: string; version: number; atoms: Set<string> }>()
  for (const a of file.events.attempts) {
    if (a.kind !== 'question') continue
    const key = `${a.questionId} ${a.questionVersion}`
    const p = pairs.get(key) ?? { questionId: a.questionId, version: a.questionVersion, atoms: new Set<string>() }
    p.atoms.add(a.primaryAtomIdAtAttempt)
    pairs.set(key, p)
  }
  for (const p of pairs.values()) {
    if (revisions.some((r) => r.questionId === p.questionId && r.version === p.version)) continue
    const rev: LegacyUnavailableQuestionRevision = {
      questionId: p.questionId,
      version: p.version,
      integrityStatus: 'content_unavailable_legacy',
      text: null,
      options: null,
      correctOptionId: null,
      primaryAtomId: p.atoms.size === 1 ? [...p.atoms][0]! : null,
      createdAt: null,
      legacyProvenance: { migratedAt: now, fromSchemaVersion: 1, createdAtSource: 'unknown' },
    }
    revisions.push(rev)
  }
  // 01 §2.7: her soru için tam bir QuestionAtom(primary); format-1 paketinde yoksa güncel primaryAtomId'den kurulur
  const qas = [...(file.content.questionAtoms ?? [])]
  for (const q of questions) {
    if (!qas.some((qa) => qa.questionId === q.id && qa.role === 'primary')) qas.push({ questionId: q.id, atomId: q.primaryAtomId, role: 'primary' })
  }
  const { checksum: _ck, ...rest } = file
  return {
    ...rest,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: 2,
    content: {
      ...file.content,
      // BL-13: format-1 atomlarında prompt yok → "" (çalışılabilir değil; İçerik'te "soru yüzü eksik")
      atoms: (file.content.atoms ?? []).map((a) => (typeof (a as { prompt?: unknown }).prompt === 'string' ? a : { ...a, prompt: '' })),
      questions,
      questionRevisions: [...(file.content.questionRevisions ?? []), ...revisions],
      inbox: file.content.inbox ?? [],
      atomRelations: file.content.atomRelations ?? [],
      optionAtoms: file.content.optionAtoms ?? [],
      questionAtoms: qas,
      hooks: file.content.hooks ?? [],
    },
    // format 1'de checksum yoktur; migrate edilmiş paket hash taşımaz (orijinal hash gelen dosyayı sınamak içindir)
  }
}

/** Zincir: gelen formatı güncel formata çevirir (1 → 2). İleri/bilinmeyen format → hata. */
export function migrateBackupToCurrent(file: BackupFile, now: string): BackupFile {
  let cur = file
  if (cur.backupFormatVersion === 1) cur = migrateBackup1to2(cur, now)
  if (cur.backupFormatVersion !== BACKUP_FORMAT_VERSION) throw new BackupMigrationError(`Bilinmeyen yedek formatı: ${file.backupFormatVersion}`)
  return cur
}
