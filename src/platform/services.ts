// 06 §11 — PlatformServices sınırı. Domain varlığı değil; motor ve uygulama katmanı cihaz yeteneklerini yalnız bu
// arayüzler üzerinden kullanır (A22). Yalnız v0'da gerçekten kullanılanlar tanımlanır (10 §2, 11 kural 15).

/** Yedek checksum'ı (06 §7). */
export interface HashService {
  sha256Hex(text: string): Promise<string>
}
