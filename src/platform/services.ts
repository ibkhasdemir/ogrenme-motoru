// 06 §11 — PlatformServices sınırı. Domain varlığı değil; motor ve uygulama katmanı cihaz yeteneklerini yalnız bu
// arayüzler üzerinden kullanır (A22). Yalnız v0'da gerçekten kullanılanlar tanımlanır (10 §2, 11 kural 15).

/** Yedek checksum'ı (06 §7). */
export interface HashService {
  sha256Hex(text: string): Promise<string>
}

/** UUID v4 üretimi (01 §0). Testler deterministik `id-1, id-2…` enjekte eder (08 §0). */
export interface IdGenerator {
  newId(): string
}

/** 06 §11 Clock: `now()` UTC duvar saati (olay zamanı), `monotonicMs()` oturum bütçesi (03 §6.3). */
export interface Clock {
  now(): string
  monotonicMs(): number
}
