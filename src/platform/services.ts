// 06 §11 — PlatformServices sınırı. Domain varlığı değil; motor ve uygulama katmanı cihaz yeteneklerini yalnız bu
// arayüzler üzerinden kullanır (A22). Yalnız v0'da gerçekten kullanılan dört servis tanımlanır (10 §2, 11 kural 15):
// Clock, IdGenerator, HashService, BackupFileService. Diğerleri arayüz olarak bile yazılmaz.

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

/**
 * 06 §11 BackupFileService.save sonuç durumları (N08, B-38, E-21):
 * saved — kaydetme doğrulandı (File System Access / native) → "Yedek alındı", meta güncellenir
 * initiated — indirme/paylaşım başlatıldı ama kaydetme gözlemlenemez → "İndirme başlatıldı… doğrula" + Kaydettim
 * cancelled / failed — meta değişmez
 */
export type BackupSaveResult = 'saved' | 'initiated' | 'cancelled' | 'failed'

export interface BackupFileToSave {
  name: string
  content: string
  mime: string
}

export interface BackupFileService {
  save(file: BackupFileToSave): Promise<BackupSaveResult>
  /** kullanıcı dosya seçer; iptalde null. İçerik metin olarak döner. */
  pick(): Promise<{ name: string; content: string } | null>
}
