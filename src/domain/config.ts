// 01_DOMAIN_MODEL.md §5 — Yapılandırma (versiyonlu, yedeğe girer).

/** 01 §5.1 / 02 §1 */
export interface EvidencePolicy {
  policyVersion: number
}

/** 02 §4 */
export interface SchedulerConfig {
  configVersion: number
  engine: string
  engineVersion: string
  algorithm: string
  requestRetention: number
  maximumInterval: number
  enableFuzz: boolean
  enableShortTerm: boolean
  learningSteps: string[]
  relearningSteps: string[]
  /** null = kütüphane varsayılanı */
  weights: number[] | null
  /** yedekte generatorParameters() çıktısındaki tam liste (02 §4). */
  resolvedWeights?: number[]
}

/** 03 §2 */
export interface QueueConfig {
  reviewCap: number
  newPerDay: number
}

/** 02 §4 — v0 değerleri. Pin: package.json "ts-fsrs": "5.4.2". */
export const SCHEDULER_CONFIG_V1: SchedulerConfig = {
  configVersion: 1,
  engine: 'ts-fsrs',
  engineVersion: '5.4.2',
  algorithm: 'FSRS-6',
  requestRetention: 0.9,
  maximumInterval: 365,
  enableFuzz: false,
  enableShortTerm: true,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  weights: null,
}

/** 02 §1.2 */
export const EVIDENCE_POLICY_V1: EvidencePolicy = { policyVersion: 1 }

/** 03 §2 */
export const QUEUE_CONFIG_DEFAULT: QueueConfig = { reviewCap: 25, newPerDay: 10 }
