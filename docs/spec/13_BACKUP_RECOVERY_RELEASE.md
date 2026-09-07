# 13_BACKUP_RECOVERY_RELEASE.md — Yedek, Kurtarma ve Sürüm Güvenliği

Referans: `00_ANAYASA.md` A3, A4, A21, A22; `06_STORAGE_REBUILD_EXPORT.md` §6–§11; `08_TEST_PLAN.md` §5d, §7.1; `09` Phase -1, 10, 11. Bu dosya kurtarma konusunu tek yerde toplar; `06` sözleşmeyi, bu dosya senaryoları ve kuralları verir. Çelişkide `06` kazanır (numara kuralı, `11` kural 2).

## 1. Felaket modeli

| # | Felaket | Ne kaybolur | Koruyan katman (§2) |
|---|---|---|---|
| F1 | iOS/Safari veya tarayıcı IndexedDB temizliği (uzun süre kullanılmayan PWA, "site verilerini temizle") | ana DB **ve** kurtarma noktaları | yalnız cihaz dışı yedek (§4) |
| F2 | Yanlış yedek geri yükleme (eski/başka dosya) | mevcut içerik ve geçmiş, üstüne yazılırsa | pre_restore kurtarma noktası (§3) |
| F3 | Bozuk yedek dosyası (eksik, değiştirilmiş, kopuk referans) | hiçbir şey kaybolmamalı | doğrulama + dry-run (§5) |
| F4 | Şema migration hatası | eski veri, migration wipe yaparsa | migration = transaction; wipe yasak (§6) |
| F5 | Yeni uygulama sürümünde hata (motor yanlış yazıyor) | ham olaylar bozulmaz (append-only), türetilmiş bozulabilir | REBUILD; kod geri dönüşü (§8) |
| F6 | Service worker eski önbelleği (kullanıcı eski JS'te kilitli) | güncellemeler | sürümlü önbellek, güvenli güncelleme (§7) |
| F7 | Kullanıcı yanlışlıkla içerik değiştirmesi/arşivlemesi | içerik | soru sürümleri (A9), arşiv (silme yok), daily kurtarma noktası |
| F8 | Çalışan kodun yeni geliştirmeyle bozulması | kod | Git baseline ve faz checkpoint'leri (§8) |
| F9 | Cihaz kaybı / değişimi | her şey | cihaz dışı yedek; platformlar arası geri yükleme (§4.5) |

## 2. Koruma katmanları

```
Raw append-only events            → mevcut ham olay mutate edilmez; hatalı yeni olay void/kurtarma ile düzeltilir; projeksiyon her zaman yeniden üretilir (A3, A4)
        ↓
Atomic IndexedDB transactions     → yarım yazım yok; çökme = ya tümü ya hiçbiri (06 §5)
        ↓
Local rolling recovery snapshots  → yanlış işlemden dakikalar içinde geri dönüş (§3)
        ↓
Portable external JSON backups    → depolama temizliği ve cihaz kaybına karşı nihai kaynak (§4)
        ↓
Git code checkpoints / releases   → kod bozulursa çalışan sürüme dönüş; kod sürümü ↔ şema uyumu (§8)
```
Her katman bir üsttekinin çözmediği bir felaketi çözer; hiçbiri diğerinin yerine geçmez.

## 3. Cihaz içi kurtarma noktası (Local Recovery Snapshot)

- **Ne:** `06` §7 formatında tam yedeğin ayrı `RecoveryStore`'a (ayrı IndexedDB veritabanı) yazılmış kopyası. `06` §9.
- **Ne zaman (otomatik):** kullanıcı başlatmalı yıkıcı işlemlerde **zorunlu** ve öncesinde — geri yükleme/içe aktarma (`pre_restore`, `pre_import`), "Tüm veriyi sıfırla" (`pre_reset`); yazılamazsa işlem başlamaz. Şema migration'ında: öncesi teknik olarak güvenli biçimde alınabiliyorsa (`pre_migration`), alınamıyorsa transaction rollback birinci savunmadır; migration başarılı ilk açılışta `post_migration` **zorunlu** (`06` §6.1). Günün ilk değişikliğinde (`daily`). Kullanıcı isterse `manual`.
- **Retention:** iki sınıf, her `reason` tam olarak birinde: işlem sınıfı (`pre_restore`, `pre_import`, `pre_reset`, `pre_migration`, `post_migration`, `manual`) en fazla 5; günlük sınıf (`daily`) en fazla 7; toplam 12; aynı sınıfın **pin'siz** en eskisi silinir; aktif işin ön noktası ve seçili hedef nokta iş bitene kadar pin'lidir (`06` §9). Kota hatasında en eski pin'siz `daily` silinip yeniden denenir; yine olmazsa kullanıcı başlatmalı yıkıcı işlem durur (acil geri dönüş için bkz. `06` §8.6).
- **Ayrı depo neden:** ana DB'nin `replaceAll`'u tüm tablolarını temizler; kurtarma noktaları aynı DB'de olsaydı yanlış geri yükleme onları da silerdi.
- **Geri dönüş:** §5 akışının aynısı, kaynak dosya yerine payload; dönüşten önce mevcut durumdan yeni `pre_restore` alınır.
- **Sınırları:** aynı origin/IndexedDB temizliğinde kaybolur (F1); cihaz dışı yedek **değildir**; kullanıcıya bu açıkça yazılır (`07` S12).

## 4. Cihaz dışı yedek (Portable External Backup)

### 4.1 Format
`06` §7: `backupFormatVersion` 2, `backupId`, `createdAt`, `appVersion`, `schemaVersion`, `platform`, `config` (policy + history, scheduler + `resolvedWeights` + history, queue), `content` (revision'lar dâhil), `events` (tüm attempt + void), isteğe bağlı `derived`, `checksum`.

### 4.2 Hash
SHA-256, kanonik JSON (`06` §7: özyinelemeli alfabetik anahtarlar, her dizi için tanımlı sıralama anahtarı) üzerinden; kapsam = `checksum` ve `derived` hariç yedeğin tüm taşınabilir alanları (başlık dâhil). `HashService` ile hesaplanır. Geri yüklemede yeniden hesaplanır; uyuşmazlık = red; başlıkta tek bayt değişikliği de yakalanır. Amaç bütünlük (bozulma, kısmi kopya); kimlik doğrulama veya şifreleme değildir.

### 4.3 Adlandırma
`ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS-<backupId ilk 8>.json` (yerel saat). Aynı saniyede iki yedek bile çakışmaz; `backupId` ayrıca benzersizdir.

### 4.4 Doğrulama
`06` §8.2 sert liste. Raw truth eksik yedek üretilemez: yedek alma fonksiyonu `events.attempts.length` ve `voids.length` değerlerini `snapshotAll()` ile karşılaştırır; farklıysa dosya yazılmaz, hata verilir.

### 4.5 Saklama ve taşınabilirlik
- iPhone: paylaşım sayfasından **Dosyalar / iCloud Drive**; Android: İndirilenler / Drive. PWA'da `BackupFileService` web gerçekleştirimi (Blob indirme, File System Access varsa doğrudan yazma); native'de Capacitor Filesystem + Share.
- **Platformlar arası:** PWA yedeği → iOS native geri yükleme; PWA yedeği → Android native; native yedeği → PWA. Hepsi aynı format ve aynı `migrateBackup` zinciriyle. Format hiçbir platform depolama ayrıntısı içermez (`platform` alanı bilgi amaçlıdır). Kurtarma noktaları platforma özgü olabilir; taşınabilir yedek değildir.
- Bulut yedek/senkron v0 dışıdır; kullanıcı dosyayı kendi bulut sürücüsüne koyar.

### 4.6 Hatırlatma
Ekran içi: 7 gün **veya** 250 yeni ham olay (`06` §10). Bildirim değildir.

## 5. Güvenli geri yükleme (Safe Restore)

`06` §8 akışının özeti ve kuralları:
1. **Dry-run:** parse → format migration (bellekte) → checksum → bütünlük → dry-run REBUILD → değişmezler. Bu adımların hiçbiri ana DB'ye dokunmaz.
2. **Pre-restore snapshot:** mevcut durumdan `pre_restore` noktası; yazılamazsa geri yükleme başlamaz.
3. **Atomic replace:** `replaceAll` tek transaction; kurtarma deposuna dokunmaz.
4. **Rebuild:** normalize edilmiş snapshot'ın aktif config'i ile (`06` §8.4): scheduler uyumluysa paketin config'i; uyumsuzsa kurulu uygulamanın güncel config'i aktif olur, paketinki history'ye arşivlenir, `scheduler_migration` kaydı düşülür; yeniden açılışta aktif config güncel kalır.
5. **Verify (her durumda):** `serializeMemory(postCommitRebuild) === serializeMemory(dryRun)` (aynı aktif config; scheduler değişmiş olsa bile eşitlik zorunlu), ham olaylar ve içerik normalize snapshot ile kanonik JSON eşit, sayaç doğru. Paketin eski `derived`'ı ile fark beklenir ve doğrulamaya girmez.
6. **Rollback (acil, `06` §8.6):** commit'ten sonra herhangi bir hata → o işin pin'li `pre_restore` noktasından **yeni nokta yazmadan** tek otomatik deneme; başarısızsa yazma-kilitli kurtarma ekranı + tek dokunuşla aynı noktaya dönüş + kurtarma dökümü. Sonsuz yeniden çağrı yoktur.
7. **Kalıcı günlük (`06` §8.5):** RestoreJournal + `meta.appliedJobId` aynı transaction'da; açılışta tamamlanmamış iş çözülmeden normal çalışma başlamaz; ön nokta iş bitene kadar pin'li.
8. **Sıra (`06` §8):** önce gelen formatın kendi checksum/yapı doğrulaması, sonra bellekte migration, sonra güncel şema doğrulaması; `(format, şema)` matrisi dışı paket geçerli hash'le bile reddedilir.
Bozuk yedek aktif veriyi **asla** değiştirmez. Mesaj: "Yedek doğrulanamadı. Mevcut verine dokunulmadı."

## 6. Şema ve uygulama yükseltmesi

6.1 **Migration zorunlu, wipe yasak** (`06` §6.1). Her `schemaVersion` artışı `upgrade()` ister; ham olay tablolarında yalnız alan ekleme. **Sahte geçmiş yasak:** migration, mevcut veriden tam olarak kurulamayan geçmiş içeriği uydurmaz; eksik geçmiş `content_unavailable_legacy` gibi açık bir işaretle temsil edilir, Attempt ve hafıza geçmişi korunur (`06` §6.2, A9).
6.2 **Başarısız migration:** transaction geri alınır, eski DB olduğu gibi kalır; uygulama hata ekranı + **kurtarma okuyucusu** ile yedek/kurtarma dökümü (`06` §6.3: şema tanımsız, salt-okunur açılış; migration tetiklenmez); kullanıcı önceki uygulama sürümüne dönebilir (§8.4).
6.3 **Yedek uyumluluğu:** yayımlanmış format okunamaz hâle gelemez; `migrateBackup` zinciri; ileri format red (`06` §8.3).
6.4 **Scheduler motoru major/algoritma yükseltme kuralı** (`02` §4.1): pin değişikliği içeren PR şunları içermeden birleştirilmez: (a) `configVersion += 1`; (b) uyumluluk karşılaştırma fonksiyonunun yeni sürümü tanıması; (c) "scheduler migration" uyarı metni; (d) determinizm testlerinin yeni pinle yeniden geçmesi; (e) eski yedekle geri yükleme testi (B-19) — ham/içerik tam, MemoryState kurulu motorla; (f) release notunda açık kayıt. Sessiz yükseltme yasaktır.
6.5 **Uygulama sürümü ↔ şema:** her uygulama sürümü desteklediği `schemaVersion` aralığını bildirir; daha yeni şemalı bir DB açılırsa (kullanıcı eski sürüme döndüyse) uygulama **yazmaz**, salt-okunur uyarı gösterir ve **kurtarma dökümü** sunar (`06` §6.3; normal yedek değildir, anlaşılmayan veri normalize edilmez); asla düşürme (downgrade) migration'ı denemez.

## 7. PWA / service worker sürüm güvenliği (v0 varsayılan stratejisi — seçenek değil)

Revizyon (v1.5, N11): kabuk için "ağ-öncelikli" kuralı **kaldırıldı**; ağdan gelen yeni `index.html` ile henüz indirilmemiş varlıkların eşleşmesi yarım sürüm üretebilir. Kural artık **sürüm bütünlüğü**dür.

- **Build kimliği ve tam ön-önbellek:** her build bir `buildId` taşır; service worker `install`'da o build'in **tam varlık manifestini** (kabuk + tüm hash'li JS/CSS/ikon) önbelleğe alır; tek bir varlık indirilemezse `install` başarısız olur ve eski SW/eski build yerinde kalır. "Hazır" = manifestin tamamı önbellekte.
- **Kabuk ve varlıklar aktif SW'nin kendi önbelleğinden** (cache-first, `motor-shell-<buildId>`): bir build'in HTML'i her zaman aynı build'in varlıklarıyla eşleşir. İlk yüklemede (kontrol eden SW yokken) ağdan gelir.
- **Güncelleme:** uygulama açılışta arka planda `registration.update()` çağırır; yeni SW `install` (tam ön-önbellek) sonrası `waiting`'de bekler; `skipWaiting` çalışma ortasında çağrılmaz. Bugün/Veri ekranında "Yeni sürüm hazır → Yenile" çubuğu. Yenile: `skipWaiting` mesajı → `controllerchange` → **o istemci bir kez** yeniden yüklenir (döngü korumalı bayrak). Başka açık istemciler (ikinci sekme) varsa: yeni SW yalnız Yenile'ye basılan istemciyi devralır; diğerleri kendi `controllerchange`'inde birer kez yenilenir; kullanıcı Yenile'ye basmazsa yeni SW tüm istemciler kapanana kadar bekler — "bir sonraki açılışta kesin yeni sürüm" ifadesi yalnız **tüm istemciler kapandıktan sonraki** açılış için geçerlidir.
- **activate:** yalnız bu uygulamaya ait eski `motor-shell-*` önbellekleri silinir; aktivasyon ancak eski istemciler devralınırken/kapanınca gerçekleştiğinden çalışan eski istemcinin varlığı erken silinmez.
- **Kısmi indirme / ağ kesilmesi:** yeni build'in varlıklarından biri gelmediyse `install` başarısızdır → uygulama eski, bütün build ile çalışmaya devam eder; ağ kesildiğinde önbellekteki tam build çevrimdışı açılır. Boş ekran veya karışık sürüm oluşmaz (M-UP-08).
- **IndexedDB'ye, kurtarma deposuna, meta'ya veya herhangi bir kullanıcı verisine service worker hiçbir koşulda dokunmaz.** SW kodunda `indexedDB`, `deleteDatabase`, Dexie import'u bulunmaz (kod incelemesi).
- Yeni sürüm şema migration'ı gerektiriyorsa migration §6 kurallarıyla açılışta, kurtarma noktası bırakarak çalışır; güncellemede kullanıcı verisi hiçbir zaman temizlenmez.
- El ile kabul: `08` §7.1 M-UP-01…08.

## 8. Kod geri dönüşü (Git)

8.1 **Baseline:** çalışan mevcut kaynak varsa ilk iş node_modules/dist/gizli bilgiler hariç baseline commit (`09` Phase -1). Repo zaten varsa dirty tree raporlanır; `reset --hard`, `checkout --`, `clean -fd`, history rewrite yasak.
8.2 **Yeşil faz checkpoint'leri:** her faz yeşil olunca commit ("phase N green: …"). Testler bozulduğunda son yeşil checkpoint'e bakılır; kullanıcı değişiklikleri force-revert edilmez.
8.3 **Stabil sürüm etiketi:** Phase 12 sonunda `vX.Y.Z` etiketi + release notu (şema sürümü, yedek formatı, scheduler pini).
8.4 **Kod sürümü ↔ migration uyumu:** bir commit şema sürümünü artırıyorsa aynı commit migration'ı ve I-17 testini içerir. Kullanıcı eski etikete dönerse §6.5 salt-okunur kuralı devreye girer; veri kaybolmaz.
8.5 **No destructive reset:** ne Claude Code ne CI, kullanıcı çalışma ağacında yıkıcı Git komutu çalıştırmaz.

## 9. Kurtarma kabul testleri

`08_TEST_PLAN.md` §5d B-01…B-38 (otomatik), §7 M-08, §7.1 M-UP-01…08 (el ile). Kırmızı çizgi: **B-01** — `yedek → ana DB sil → geri yükle → REBUILD` sonrası içerik/revision'lar, ham olaylar (kanonik), void'ler, config eşit; uyumlu scheduler'da MemoryState eşit; `nextSequence` aynı. Bu test kırmızıyken hiçbir sürüm yayımlanmaz.
