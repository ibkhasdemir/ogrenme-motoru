// 01_DOMAIN_MODEL.md §1 — Enum'lar. Bu üç sözlük (facet, operation, support) dışında öğrenme taksonomisi yoktur (04 §3).
// Saf TypeScript: DOM, Dexie, platform kavramı yok (00 A22).

export const ATOM_FACETS = [
  'fact', 'date', 'chronology', 'definition', 'cause_effect',
  'process', 'comparison', 'spatial', 'rule', 'exception',
] as const
export type AtomFacet = (typeof ATOM_FACETS)[number]

export const OPERATIONS = [
  'recall', 'explain', 'contrast', 'reverse', 'apply',
  'detect', 'connect', 'generate', 'order', 'discriminate',
] as const
export type Operation = (typeof OPERATIONS)[number]

export const SUPPORTS = ['none', 'cue', 'hook', 'visual', 'timeline', 'choices', 'partial'] as const
export type Support = (typeof SUPPORTS)[number]

export const CONFIDENCES = ['sure', 'unsure', 'guess'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const ATTEMPT_MODES = ['new', 'review', 'pretest', 'external'] as const
export type AttemptMode = (typeof ATTEMPT_MODES)[number]

export const WRONG_REASONS = ['unknown', 'confused', 'attention', 'skipped'] as const
export type WrongReason = (typeof WRONG_REASONS)[number]

export const SELF_ASSESSMENTS = ['again', 'hard', 'good'] as const
export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number]

export const HOOK_TYPES = ['logic', 'mnemonic', 'absurd', 'analogy', 'story', 'visual', 'warning', 'personal'] as const
export type HookType = (typeof HOOK_TYPES)[number]

export const QUESTION_ATOM_ROLES = ['primary', 'secondary'] as const
export type QuestionAtomRole = (typeof QUESTION_ATOM_ROLES)[number]

export const OPTION_ATOM_RELATIONS = ['contradicts', 'common_confusion', 'trap'] as const
export type OptionAtomRelation = (typeof OPTION_ATOM_RELATIONS)[number]

export const RELATION_TYPES = ['prerequisite', 'confusable'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export const PROVENANCE_TYPES = ['deneme', 'kitap', 'kisi', 'merak', 'ders', 'sosyal_medya', 'kendi'] as const
export type ProvenanceType = (typeof PROVENANCE_TYPES)[number]

/** 1 Again · 2 Hard · 3 Good · 4 Easy (Easy v0'da hiçbir yoldan üretilmez, 02 §1.2). */
export type Rating = 1 | 2 | 3 | 4

export const ATTEMPT_KINDS = ['question', 'recall'] as const
export type AttemptKind = (typeof ATTEMPT_KINDS)[number]

/** 01 §4.6: undo · clock_skew (06 §3.1) · content_error (K01). */
export const ATTEMPT_VOID_REASONS = ['undo', 'clock_skew', 'content_error'] as const
export type AttemptVoidReason = (typeof ATTEMPT_VOID_REASONS)[number]

/** 01 §2.5 QuestionRevision.integrityStatus */
export const INTEGRITY_STATUSES = ['complete', 'content_unavailable_legacy'] as const
export type IntegrityStatus = (typeof INTEGRITY_STATUSES)[number]

/** 01 §6.2 MemoryState.state: 0 New, 1 Learning, 2 Review, 3 Relearning */
export type MemoryStateCode = 0 | 1 | 2 | 3
