// 06 §11 IdGenerator web gerçekleştirimi: crypto.randomUUID (UUID v4).
import type { IdGenerator } from '../services'

export class WebIdGenerator implements IdGenerator {
  newId(): string {
    return globalThis.crypto.randomUUID()
  }
}
