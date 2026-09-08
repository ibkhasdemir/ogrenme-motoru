// 06 §11 Clock web gerçekleştirimi: Date (UTC duvar saati) + performance.now() (monoton). Uyku sırasında geçen süre
// bütçeye sayılmaz: uygulama gizlenince Session.pause() çağrılır (03 §6.3) — bu, UI katmanının işidir.
import type { Clock } from '../services'

export class WebClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }

  monotonicMs(): number {
    return performance.now()
  }
}
