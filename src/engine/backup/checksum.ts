// 06 §7 — Checksum kapsamı: `checksum` ve `derived` HARİÇ, yedeğin davranışı etkileyen bütün taşınabilir alanları
// (başlık dâhil). Hash HashService üzerinden (06 §11). Bütünlük içindir; kimlik doğrulama/şifreleme değildir.
import type { HashService } from '../../platform/services'
import { canonicalJson, sortSnapshotArrays } from './canonical'
import { CHECKSUM_OF, type BackupChecksum, type BackupFile } from './types'

/** Kanonik girdi: başlık + config + content + events, diziler 06 §7 anahtarlarıyla sıralı. */
export function checksumInput(file: BackupFile): string {
  const { checksum: _c, derived: _d, ...rest } = file
  return canonicalJson(sortSnapshotArrays(rest as BackupFile))
}

export async function computeChecksum(file: BackupFile, hash: HashService): Promise<BackupChecksum> {
  return { algorithm: 'sha256', value: await hash.sha256Hex(checksumInput(file)), of: CHECKSUM_OF }
}

export async function checksumMatches(file: BackupFile, hash: HashService): Promise<boolean> {
  if (!file.checksum || file.checksum.algorithm !== 'sha256') return false
  return (await hash.sha256Hex(checksumInput(file))) === file.checksum.value
}
