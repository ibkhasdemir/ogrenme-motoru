# 09_IMPLEMENTATION_PLAN.md — Uygulama Planı (Revizyon 2: mevcut kod üzerinde audit + fix)

Referans: `08_TEST_PLAN.md` (test kimlikleri), `11_CLAUDE_CODE_RULES.md`, `13_BACKUP_RECOVERY_RELEASE.md` §8 (Git).

**İki başlangıç yolu; Phase -1 hangisi olduğunu tespit eder:**
- **Yol A — mevcut kod var** (beklenen durum: `ogrenme-motoru-v0.zip`'ten açılmış TypeScript/Vite/Vitest/Dexie/ts-fsrs 5.4.2 gerçekleştirimi, 25 test): sıfırdan iskele kurulmaz; mevcut kod **baseline** kabul edilir; her faz "audit + minimum yama". Whole-project rewrite yasaktır (`11`).
- **Yol B — kaynak kod yok** (`package.json` ve `src/` bulunmuyor): `BASELINE_AUDIT.md`'ye "uygulama yok" yazılır; geçmişte çalıştığı söylenen kod varmış gibi değerlendirilmez; Phase 0 iskele olarak uygulanır (paketleri pinle, iskele testi) ve fazlar "yeni gerçekleştirim" olarak ilerler. Belgelerde sayılan "bilinen kod hataları" Yol B'de yalnız tasarım uyarısıdır.

Her faz: yapılacak modüller, bağımlılık, yeşile çevrilecek testler, done kriteri. Faz bitince Git checkpoint (`13` §8). Kırmızı test bırakıp sonraki faza geçilmez.

## Phase -1 — Baseline Audit (mevcut gerçekleştirimi koru)
1. Dosya ağacını incele (`src/`, `tests/`, `docs/`, `public/`, `package.json`).
2. `package.json` varsa `npm install`, `npm test`, `npm run build` — sonuçları olduğu gibi kaydet; yoksa Yol B'ye geç.
3. Git: repo değilse `git init` + `.gitignore` (node_modules, dist, secrets) + **baseline commit** ("baseline: mevcut çalışan gerçekleştirim"). Repo ise `git status`; dirty tree varsa raporla, hiçbir şeyi reset/checkout/clean ile silme.
4. Mevcut kodu spec fazlarıyla eşleştir (hangi modül hangi faz).
5. **Platform coupling audit:** `src/domain/**` ve `src/engine/**` içinde `window`, `document`, DOM tipleri, `localStorage`, doğrudan IndexedDB/Dexie erişimi, service worker, `navigator`, tarayıcı dosya API'leri ara. Bulunanlar için minimum adapter/refactor planla (UI/app/store katmanında bulunmaları normaldir).
6. `BASELINE_AUDIT.md` yaz: çalışanlar · spec'e uyanlar · eksikler · bilinen hatalar (Yol A'da beklenen, doğrulanmadan yazılmaz: oturum kuyruk snapshot'ı `03`; buildQueue/selectNext sıralama farkı `03` §3.5; prompt isteğe bağlı `01` §2.3; arşivli soru filtresi yok `03` §4.2; sürüm kayıt anında bağlanıyor `01` §4.2a; QuestionRevision yok `01`; export formatı 1 ve checksum yok `06`; kurtarma noktası yok; service worker önbellek adı sabit `13` §7; yedek dosya adında saat yok; geri al sonrası aynı öğenin tekrar sunulması selectNext'e bırakılmış `03` §6.5; Resolver yakınlığı timestamp ile `03` §4.3; U-SC-04 varsayımı yanlış `02` §3.1a) · platform coupling bulguları · önerilen yama sırası.
7. Done: baseline commit var; audit dosyası var; testler baseline'daki hâliyle koşuyor.

## Phase 0 — Proje disiplini
- `package.json` pinleri doğrula (`ts-fsrs` 5.4.2, `^` yok); script'ler; `docs/spec` yerinde; `BLOCKERS.md` şablonu.
- Testler: mevcut suite yeşil (kırmızı varsa audit'e yaz, düzeltme sonraki fazlarda).
- Done: `npm test && npm run build` yeşil; checkpoint.

## Phase 1 — Domain tipleri (audit + fix)
- `01` ile fark listesi: Subject/Topic varlıkları, `Question` baş kaydı + `QuestionRevision`, `confidence` recall'da null, `confidenceAtFailure`, `changedAnswer`, `QuestionRevision.integrityStatus` + `legacyProvenance`, `AttemptVoid.reason`.
- Testler: tip derlemesi; A-01 (statik tarama).
- Done: `tsc` temiz; domain saf TypeScript.

## Phase 1b — Kurtarma altyapısı çekirdeği (Phase 2'den ÖNCE; N13)
- Modüller: kanonik JSON + `HashService` (web: Web Crypto), `RecoveryStore` (ayrı Dexie DB; yaz/oku/pin/retention), `snapshotAll`, RestoreJournal kaydı. Arayüz **yok**; yalnız çekirdek.
- Gerekçe: Phase 2 migration'ı `post_migration` noktası (B-26) ister; nokta yazmak bu çekirdeği ister. Tam güvenli geri yükleme arayüzü Phase 10'da kalır.
- Testler: B-25, B-25b, B-28, B-34 (pin), B-15 (retention); journal yazma/okuma birimi.
- Done: bir nokta yazılıp geri okunuyor; retention ve pin çalışıyor; checkpoint.

## Phase 2 — Depo (audit + fix) ve schemaVersion 2 migration
- `06` §2 sözleşmesi: `appendRevision/listRevisions/getRevision`, `reviseQuestion` transaction'ı, `snapshotAll`, `getMeta/setMeta`, `replaceAll` (recovery'ye dokunmaz).
- **Migration 1 → 2** (`06` §6.2): revision tablosu; güncel sürüm exact `complete` revision; içeriği bulunmayan eski sürümler `content_unavailable_legacy` (güncel içerik kopyalanmaz); rapor. Wipe yok.
- `RecoveryReader` (`06` §6.3): şema tanımsız salt-okunur açılış; kurtarma dökümü.
- Testler: I-05, I-14, I-15, I-17, U-QR-03, U-QR-06, U-QR-07…11, I-QA-02, A-02, A-06, B-26 (Phase 1b çekirdeğiyle gerçek post_migration noktası; mock değil), B-37.
- Done: eski v1 veritabanı açılıp migrate oluyor; baseline verisi korunuyor; checkpoint.

## Phase 3 — Attempt olay sistemi (audit + fix)
- `changedAnswer`, `confidenceAtFailure` (yalnız external), `AttemptVoid.reason`, `questionVersion = currentVersion`.
- Testler: I-04, I-09, I-10, I-11, I-12, I-13, I-20, I-22, I-QA-08 (QuestionAttempt revision'dan kurulur).

## Phase 4 — EvidencePolicy (audit)
- Mevcut politika `02` §1.2 ile birebir mi? Değişiklik beklenmiyor.
- Testler: U-EP-01…10.

## Phase 5 — Scheduler adaptörü (audit)
- Pin, fuzz, `resolvedWeights` üretimi, uyumluluk karşılaştırma fonksiyonu (`02` §4.1: `isCompatible(backupConfig, installedConfig)`).
- Testler: U-SC-01…15 (U-SC-13a/b/c tam hazırlık dizileriyle; "bir günden uzun" gibi genel eşik yok).

## Phase 6 — REBUILD (audit)
- Değişiklik beklenmiyor; `serializeMemory` kanonik.
- Testler: U-RB-01…12.

## Phase 7 — Dinamik seçim (fix — gerçek hata)
- `03` §3.3 `selectNext`, §3.5 `buildQueue`, günlük tavanlar Attempt geçmişinden; oturumdan kuyruk snapshot'ını kaldır (`03` §6).
- Testler: U-DQ-01…16, U-DS-01…12, U-UN-01…08, E-16.
- Done: Again → 1 dk → hemen gelir; tavanlar delinmez; due yazılmaz; checkpoint.

## Phase 8 — Resolver + hatırlama kartı (audit + fix)
- Güncel revision ile sunum; I-QA-05.
- Testler: U-RS-01…06, U-QR-01, U-QR-02, U-QR-04, U-QR-05, U-QR-12, I-QA-01, I-QA-03, I-QA-04, I-QA-06, I-QA-07, I-QA-09, I-QA-10.

## Phase 8b — Motor cephesi (audit + fix)
- `reviseQuestion`, yedek/geri yükleme motor API'si (`06` §8 adımları saf fonksiyonlar olarak: `validateBackup`, `migrateBackup`, `dryRunRebuild`), PlatformServices arayüzleri (Clock, IdGenerator, HashService, BackupFileService) ve web gerçekleştirimleri.
- Testler: I-01, I-02, I-03, I-06 (B-01'e evrilir), I-07, I-08, I-16, I-18, A-03, A-04.

## Phase 9 — Minimal mobil arayüz (audit + fix)
- `07` §1.1 ergonomi, §1.2 kurulabilirlik, dinamik oturum, S11 sürüm geçmişi, S3 cevap öncesi sızıntı yok.
- Testler: E-01…E-09, E-12, E-15, E-16, E-17.

## Phase 9b — Visual System Foundation (`14`)
- Tasarım token'ları (renk/boşluk/yarıçap/tipografi/hareket), tipografi ölçeği, semantik renk rolleri, yeniden kullanılabilir mobil bileşenler (düğme, seçenek kartı, çip, sayfa başlığı, sheet), light/dark temeli, erişilebilirlik (odak, kontrast, hedef boyutu), iOS/Android görünüm alanı denetimi.
- Kural: işlevsel akış (Phase 9) bitmeden başlamaz; **haftalarca tasarım sistemi yapılmaz** — kontrollü iyileştirme, mevcut ekranların token'a taşınması.
- Testler: V-01…V-15 (el ile, `docs/PHONE_CHECK.md`), E testleri hâlâ yeşil.

## Phase 10 — Yedek ve kurtarma (yeni; `06` §7–§10, `13`)
- 10a: taşınabilir yedek (format 2, checksum, dosya adı), `migrateBackup(1→2)`, sert doğrulama, dry-run.
- 10b: kurtarma deposu (`RecoveryStore`), rolling retention, otomatik noktalar (pre_restore/pre_reset/pre_migration/daily).
- 10c: iki aşamalı güvenli geri yükleme (önce orijinal checksum, sonra migration), RestoreJournal + açılış çözümlemesi, acil geri dönüş (yeni nokta istemeden, tek deneme, kurtarma ekranı), `BackupFileService` sonuç durumları, meta nesli kuralları, S12 arayüzü, hatırlatma eşiği.
- **Sıra kuralı:** 10b tamamlanıp B-11/B-12/B-14/B-15 yeşil olmadan 10c'deki yıkıcı yol (replaceAll'a giden düğme) etkinleştirilmez (`11` Backup first).
- Testler: B-01…B-38 (B-03b, B-05c dâhil), E-10, E-11, E-13, E-14, E-21, A-05.
- **Test–faz bağımlılık kontrolü:** her faz yalnız kendinden önceki fazların modüllerine dayanır; bir testin ilerideki modülü beklediği görülürse `BLOCKERS.md`'ye yazılır, test o faza taşınır, mock ile "yeşil" ilan edilmez.
- Done: kırmızı çizgi B-01 geçer; checkpoint; sürüm etiketi adayı.

## Phase 11 — Çevrimdışı PWA ve güncelleme güvenliği (`13` §7)
- Service worker (`13` §7 sabit strateji): build başına tam ön-önbellek (eksik varlık = install başarısız); kabuk ve varlıklar aktif build önbelleğinden; arka planda güncelleme kontrolü; yeni SW bekler, çalışan oturum sessizce değişmez; Bugün/Veri ekranında "Yeni sürüm hazır → Yenile" → tek istemci, tek yenileme; activate'te yalnız eski `motor-shell-*` önbellekleri silinir; IndexedDB/kurtarma deposuna dokunulmaz.
- Testler (otomatik): E-18; SW kaynak dosyasında `indexedDB`/`deleteDatabase`/Dexie yok (statik tarama, A-01 benzeri).
- Manifest/iOS meta denetimi.
- Testler (el ile): M-01…M-10, M-UP-01…08 (`docs/PHONE_CHECK.md`).

## Phase 12 — Kabul ve kapanış
- Tüm U/I/E/B/A testleri yeşil; kod incelemesi kriterleri (`08` §0); `BLOCKERS.md` boş veya kullanıcı kararı bekleyen maddeler işaretli; `README.md` (kurulum, telefonda açma, yedek/geri yükleme).
- Git: stabil sürüm etiketi (`v0.2.0`), release notu.
- Done: `00_ANAYASA.md` §1 başarı testi telefonda "evet"; yedek → sil → geri yükle telefonda denendi.

## Faz dışı kurallar
- `10_V0_NON_GOALS.md`'deki bir şey "gerekli" görünürse yapılmaz; `BLOCKERS.md`'ye yazılır.
- Çalışan davranış yalnız spec veya test gerektiriyorsa değişir; önce testle hata kanıtlanır, sonra minimum değişiklik.
- Her yeşil fazda geri dönülebilir checkpoint; testler bozulursa son yeşil checkpoint'e **bakılır**, kullanıcı değişiklikleri force-revert edilmez.
