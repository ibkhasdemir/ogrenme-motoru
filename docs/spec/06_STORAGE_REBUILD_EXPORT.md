# 06_STORAGE_REBUILD_EXPORT.md — Depolama, REBUILD, Yedek ve Kurtarma

Referans: `00_ANAYASA.md` A3, A4, A19, A21, A22; `01_DOMAIN_MODEL.md`; `02_EVIDENCE_FSRS_ENGINE.md` §4.1, §5; ayrıntılı kurtarma tasarımı `13_BACKUP_RECOVERY_RELEASE.md`.

Revizyon 2: depo katmanı soyutlama sınırı olarak tanımlandı (§2, §11); QuestionRevision tabloları ve schemaVersion 2 migration'ı eklendi (§6); "export/import" yerine yedek/kurtarma sistemi (§7–§10); doğrulama sertleştirildi (§8.2).
Revizyon 3 (v1.5): geri yükleme sırası (önce orijinal checksum, sonra migration, §8); kalıcı geri yükleme günlüğü ve acil geri dönüş (§8.5–8.6); sabitlenmiş kurtarma noktaları (§9); veri nesli ve meta kuralları (§3, §10); yedek kaydetme sonuç durumları (§11); bilinmeyen alan koruma ve format/şema matrisi (§8.2, §8.3); kurtarma okuyucusu (§6.3); saat tutarsızlığı (§3.1).

## 1. İlkeler

- **Raw truth**: Attempt, AttemptVoid. Yalnız eklenir. Depo katmanında bu tablolar için update/delete API'si **yazılmaz**.
- **İçerik**: Subject, Topic, Atom, MemoryHook, Question, **QuestionRevision** (değiştirilemez), QuestionAtom, OptionAtom, AtomRelation, InboxItem. QuestionRevision yalnız eklenir; diğerleri düzenlenebilir (`01` sürüm kuralları).
- **Yapılandırma**: EvidencePolicy, SchedulerConfig, QueueConfig, `meta` (sayaç, son yedek bilgisi). Versiyonlu; yedeğe girer.
- **Türetilmiş**: ReviewEvent, MemoryState (ileride Coverage). Her an silinip REBUILD ile geri getirilebilir. Gerçek gibi saklanmaz.
- **Kurtarma noktası** (local recovery snapshot): ana veritabanından **ayrı** bir depoda tutulan tam yedek kopyaları (§9).
- Bugünkü gerçekleştirim IndexedDB (Dexie); fiziksel şema değişebilir; bu dosya sözleşmeyi, migration yolunu ve yedek formatını tanımlar.

## 2. Depo sınırı (Repository) — soyutlama kuralı

Motor (`engine/*`, `domain/*`) **doğrudan Dexie veya IndexedDB çağırmaz**; yalnız `Repository` arayüzü üzerinden çalışır. Gerçekleştirimler altyapı katmanındadır: bugün `DexieRepository` (tarayıcı, PWA), test için `MemoryRepository`; ileride gerekirse Capacitor/native depolama adaptörü **aynı arayüzü** uygular. Bağımlılık yönü: motor → arayüz; altyapı → arayüzü uygular (A22).

Erken soyutlama yasağı (`10` §2) burada da geçerlidir: arayüze yalnız gerçekten kullanılan işlemler konur; "ileride lazım olur" diye sorgu dili, generic CRUD veya unit-of-work eklenmez.

**İçerik / yapılandırma:** `list*`, `put*` (upsert), `archive*` (silme yerine); QuestionRevision için yalnız `appendRevision`, `listRevisions(questionId)`, `getRevision(questionId, version)`. Soru semantik düzenlemesi tek işlem: `reviseQuestion(questionId, patch)` → §5 tablosundaki transaction.

**Ham olaylar:** `listAttempts()` (sequence ASC), `appendAttempt(a)`, `listVoids()`, `appendVoid(v)`, `nextSequence()`. Başka metot yok.

**Meta:** `getMeta(key)`, `setMeta(key, value)` — sayaç, `lastExternalBackupAt`, `lastExternalBackupSequence`, `schemaVersion`.

**Yedek / kurtarma:** `snapshotAll()` (tam tutarlı okuma: içerik + olaylar + config), `replaceAll(snapshot)` (tek işlemde temizle ve yükle; sayacı en büyük sequence'a kur). Kurtarma noktaları ayrı `RecoveryStore` arayüzündedir (§9).

## 3. Sequence üretimi

- Tek monoton sayaç; Attempt ve AttemptVoid aynı sayacı paylaşır (A19). Boşluk olabilir; tekrar **olamaz**.
- Saklama: `meta.sequence`. Üretim ve olay yazımı **aynı transaction** içinde: `n ← meta.sequence; n+1 yaz; olayı sequence = n+1 ile ekle`.
- **Monotonluk bir veri nesli (generation) içinde geçerlidir.** `meta.generationId` (UUID) her `replaceAll` ve sıfırlamada değişir; aynı nesil içinde sayaç asla geri alınmaz. Geri yükleme yeni bir nesildir ve **açık istisnadır**: `replaceAll` sonrası sayaç = geri yüklenen paketin `max(attempts.sequence, voids.sequence)`'ı (boş pakette 0); aktif sayaç 1000 iken 100'de biten yedeğe dönmek sayacı 100'e kurar, bu veri geçmişinin değişmesidir, geri alma değildir. Nesil değişince bellekteki projeksiyonlar, oturum durumu ve `pendingReplay` geçersizdir (yeniden yükleme + REBUILD).
- `meta.generationStartSequence` = nesil başladığındaki sayaç değeri (hatırlatma sayımı için, §10).

### 3.1 Saat tutarsızlığı (clock skew)
Ham `timestamp` cihaz saatidir; çevrimdışı ortamda gerçek saat kesin bilinemez, **sessiz düzeltme yapılmaz**. Görünür uyarı kuralı: yeni Attempt'ın `timestamp`'i son ham olaydan 5 dakikadan fazla **geride** ise, veya herhangi bir `MemoryState.lastReview` şu andan 1 günden fazla **ileride** ise Bugün ekranında tek satır "Cihaz saati tutarsız görünüyor: N kayıt ileri tarihli" gösterilir; geri yükleme önizlemesinde de aynı uyarı. Kurtarma yolu (mevcut ham mekanizmayla): Veri ekranında "İleri tarihli kayıtlar" listesi (timestamp > now + 1 gün) ve tek dokunuşla `AttemptVoid { reason: "clock_skew" }`; Attempt silinmez, REBUILD sonrası kırpma (`02` §5.3) artık o kayıtları görmez, vade normale döner. Kapsam kullanıcı kararıdır; uygulama kendiliğinden void etmez.

## 4. Türetilmiş durumun yeri (v0 kararı)

MemoryState ve ReviewEvent diske yazılmaz; açılışta tam REBUILD, bellekte tutulur. 10.000 Attempt'a kadar milisaniyeler; tutarsızlık sınıfı hata ortadan kalkar; A4 her açılışta doğrulanır. İleride önbellek eklenirse `{ policyVersion, configVersion, engineVersion, lastSequence }` damgası taşır; damga uyuşmazsa silinir. Önbellek yedeğin zorunlu parçası olmaz.

## 5. Transaction sınırları ve çökme tutarlılığı

| İşlem | Transaction (tek rw) | Ortada çökme | Sonuç |
|---|---|---|---|
| Cevap kaydı | `meta` + `attempts` | commit öncesi | olay yok, sayaç artmamış; UI yeniden sunar |
| | | commit sonrası, bellek güncellenmeden | açılışta REBUILD işler; kayıp yok |
| Geri al | `meta` + `voids` | aynı | aynı |
| Atom ekleme | `atoms` (+ `subjects`/`topics` oluşuyorsa) | | ya tümü ya hiçbiri |
| Soru oluşturma | `questions` + `questionRevisions` (v1) + `questionAtoms` (primary) | | tutarlı üçlü |
| **Soru semantik düzenleme** (`reviseQuestion`) | `questionRevisions` (yeni v) + `questions` (currentVersion, primaryAtomId, updatedAt) + `questionAtoms` (primary güncelle; bağlam değiştiyse secondary'leri sil) + `optionAtoms` (bağlam değiştiyse tümünü sil; korunduysa yeni revision'da olmayan optionId'leri sil; doğru seçenekte ilişki bırakma) | | hiçbir anda `Question.primaryAtomId ≠ QuestionAtom(primary)` kalmaz; hiçbir anda doğru seçenek yanlış-şık ilişkisi taşımaz (`01` §2.7–2.8) |
| **Cevap anahtarı hata düzeltmesi** (`reviseQuestion` + `content_error`) | yukarıdaki + seçilen Attempt'lar için `voids` (reason content_error) + `meta` sayaç | | revision ve void'ler birlikte yazılır; yarım kalırsa hiçbiri (`01` §4.6) |
| Geri yükleme (`replaceAll`) | tüm ana tablolar | ortada | eski veri korunur; kurtarma deposuna dokunulmaz |
| Kurtarma noktası yazma | `recovery.snapshots` (+ retention silme) | | ana DB'ye dokunmaz |

Yazma sırası: önce disk (raw), sonra bellek (derived). Tersi yasak.

**Çift kayıt ve çoklu sekme:** Attempt id'si sunum anındaki `actionId`'den türetildiği için aynı cevabın ikinci `appendAttempt`'ı depo tarafından reddedilir (çift dokunma, "başarısız görünen" isteğin tekrarı → tek Attempt, I-20). Aynı origin'de iki bağlam (PWA + sekme) açıksa bellekteki iki projeksiyon ayrışabilir; v0 kuralı: uygulama görünürlük/odak kazandığında ve her yazmadan önce `meta.sequence`'ı okur; bellekteki bilinen sequence'tan büyükse olayları yeniden yükleyip REBUILD yapar (değişiklik algılama). Tek aktif yazıcı kilidi (Web Locks) v0'da zorunlu değildir; sequence transaction'ı zaten tekrarı önler (I-21). Kullanıcı başlatmalı yıkıcı işlemler (geri yükleme, içe aktarma, sıfırlama) **önce** kurtarma noktası yazılmadan başlamaz; şema migration'ı için kural §6.1'dedir (`13` §3).

## 6. Şema sürümü ve migration

### 6.1 Kurallar
- `schemaVersion` tamsayı; Dexie `version(n).stores({...})` ile eşleşir. Her artışta `upgrade()` yazılır.
- **Veritabanı silme migration değildir.** Şema değişikliğinde wipe yasaktır (A21). Migration başarısız olursa eski DB olduğu gibi kalır (Dexie upgrade transaction'ı geri alınır); uygulama açılışta hata ekranı gösterir ve yedek almayı önerir; veri kaybı yoktur.
- Ham olay tabloları yalnız alan **ekleyerek** değişir (varsayılan değerle doldurma); alan silme/yeniden adlandırma yasak. İçerik tabloları için alan ekleme/kaldırma serbest; kaldırılan alan geri yüklemede yok sayılır.
- Türetilmiş tablolar (varsa) migration'da silinir; REBUILD yeniden üretir.
- Enum'a değer eklemek migration gerektirmez; değer çıkarmak yasaktır.
- `appVersion` (semver) ile `schemaVersion` ayrıdır.
- **Migration ve kurtarma noktası (tek karar):** migration öncesi kurtarma noktası teknik olarak güvenli biçimde alınabiliyorsa (ör. uygulama migration ihtiyacını upgrade'den önce fark edip eski şemayla okuyabiliyorsa) alınır (`pre_migration`); IndexedDB sürüm yükseltmesi yüzünden ön nokta mümkün değilse **transaction rollback eski DB'yi koruyan birinci savunmadır**; migration başarılı ilk açılışta `post_migration` kurtarma noktası **zorunludur**; dış yedek hatırlatması korunur. "Ön nokta yoksa migration yasak" kuralı **yoktur**.

### 6.3 Kurtarma okuyucusu (migration açılamazken veri dışarı alma)
Normal depo açılışı migration hatası veriyorsa ya da DB daha yeni bir şemadaysa (`13` §6.5), aynı Repository üzerinden yedek alınamayabilir. Bu yüzden ayrı bir **RecoveryReader** vardır: veritabanını şema tanımı vermeden, salt-okunur açar (Dexie dynamic mode: `new Dexie(name).open()` — `version()` çağrılmaz, migration tetiklenmez, hiçbir şey yazılmaz), gördüğü tüm tabloları ve alanları olduğu gibi döker.
- Tanınan eski şemadan: `migrateBackup` zinciriyle normal geri yüklenebilir yedek üretir.
- Bilinmeyen (daha yeni) şemadan: **kurtarma dökümü** üretir: `kind: "recovery_dump"`, `observedSchemaVersion`, tablolar ham; dosya adı `ogrenme-motoru-recovery-dump-…json`. Bu dosya normal yedek **değildir**; normal geri yükleme onu "Bu bir kurtarma dökümü; normal yedek değil" diyerek reddeder; okunması ileride ayrı bir araçtır. Eski uygulama anlamadığı veriyi normalize etmez.
- Erişim: migration hata ekranı ve "daha yeni şema" salt-okunur ekranı; işlem DB sürümünü/içeriğini değiştirmez (B-37).

### 6.2 schemaVersion 1 → 2: QuestionRevision (sahte geçmiş üretmeden)
Mevcut gerçekleştirim (`09` Phase -1) soruyu tek tabloda `version` alanıyla tutar; eski sürümlerin metni yoktur. Politika: **eksik legacy geçmiş kabul edilir; sahte geçmiş üretilmez** (A9).

```
version(2): questionRevisions tablosu (anahtar [questionId+version]); questions tablosunda currentVersion, updatedAt
upgrade():
  her question q için:
    // exact reconstruction: mevcut içerik tam olarak q.version sürümünün snapshot'ıdır
    appendRevision({ questionId: q.id, version: q.version, integrityStatus: "complete",
                     text: q.text, options: q.options, correctOptionId: q.correctOptionId,
                     primaryAtomId: q.primaryAtomId,
                     // sürüm tarihi: v1 ise soru oluşturma tarihiyle aynıdır (kesin); v>1 ise BİLİNMİYOR → null, uydurulmaz
                     createdAt: q.version = 1 ? q.createdAt : null,
                     legacyProvenance: { migratedAt: now, fromSchemaVersion: 1,
                                         createdAtSource: q.version = 1 ? "legacy_created_at" : "unknown" } })
    q.currentVersion ← q.version
    q.updatedAt ← (kaynakta güvenilir updatedAt varsa o, yoksa null)   // createdAt kopyalanmaz
    text/options/correctOptionId baş kayıttan kaldırılır
  her (questionId, questionVersion) çifti için (kind = question olan Attempt'lardan, distinct):
    if getRevision(questionId, questionVersion) yoksa:        // o sürüm artık mevcut değil
      atoms ← { a.primaryAtomIdAtAttempt : a bu çifte ait }
      appendRevision({ questionId, version: questionVersion, integrityStatus: "content_unavailable_legacy",
                       primaryAtomId: |atoms| = 1 ? tek eleman : null,
                       text: null, options: null, correctOptionId: null,
                       createdAt: now, legacyProvenance: { migratedAt: now, fromSchemaVersion: 1 } })
  meta.schemaVersion ← 2
  migration raporu meta'ya yazılır: exact kurulan ve content_unavailable_legacy revision sayıları
```
- Legacy Attempt'ın `questionVersion`'ı mevcut `q.version` ile aynıysa exact revision zaten vardır; ek kayıt yazılmaz.
- Eski sürüm içeriği mevcut veriden gerçekten bulunabiliyorsa (ileride başka kaynaktan) aynen migrate edilir; bulunamıyorsa güncel içerik **kopyalanmaz**.
- Ham Attempt'lara dokunulmaz; REBUILD `primaryAtomIdAtAttempt` snapshot'ından çalıştığı için hafıza geçmişi kaybolmaz.
- `content_unavailable_legacy` revision'ı UI'da "Bu eski denemeye ait soru metni eski veri modelinde saklanmadığı için mevcut değil." olarak gösterilir (`07` S11). `createdAt = null` olan her revision "sürüm tarihi bilinmiyor" olarak gösterilir; `migratedAt` sürüm tarihi diye sunulmaz. Soru kimliğinin ilk oluşturma tarihi (`Question.createdAt`) korunur.

## 7. Taşınabilir yedek formatı (Portable External Backup)

Tek JSON dosyası; **platformdan bağımsız** (PWA, ileride iOS/Android native aynı formatı üretir ve okur). Raw truth **hiçbir zaman** eksik yazılamaz.

Dosya adı: `ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS.json` (yerel saat, milisaniye dâhil) **+** `backupId`'nin ilk 8 karakteri: `ogrenme-motoru-backup-2026-09-07-181503-042-8a1c3f9e.json`. Aynı saniyede alınan iki yedek bile farklı ada sahiptir; `backupId` ayrıca benzersizdir.

```json
{
  "backupFormatVersion": 2,
  "backupId": "8a1c…-uuid",
  "createdAt": "2026-09-07T18:00:00.000Z",
  "appVersion": "0.2.0",
  "schemaVersion": 2,
  "platform": "pwa",
  "config": {
    "evidencePolicy": { "policyVersion": 1 },
    "evidencePolicyHistory": [ { "policyVersion": 1, "since": "…" } ],
    "schedulerConfig": { "…": "02 §4", "resolvedWeights": [ 21 sayı ] },
    "schedulerConfigHistory": [ { "configVersion": 1, "since": "…" } ],
    "queueConfig": { "reviewCap": 25, "newPerDay": 10 }
  },
  "content": {
    "subjects": [], "topics": [], "atoms": [], "hooks": [],
    "questions": [], "questionRevisions": [], "questionAtoms": [], "optionAtoms": [], "atomRelations": [],
    "inbox": []
  },
  "events": { "attempts": [], "voids": [] },
  "derived": null,
  "checksum": { "algorithm": "sha256", "value": "hex…", "of": "canonical(backup without checksum and derived)" }
}
```

- **Checksum kapsamı:** `checksum` alanının kendisi ve isteğe bağlı `derived` **hariç**, yedeğin davranışı etkileyen bütün taşınabilir alanları: `backupFormatVersion`, `backupId`, `createdAt`, `appVersion`, `schemaVersion`, `platform`, `config`, `content`, `events`. Başlıkta (`schemaVersion`, `backupFormatVersion` vb.) tek bayt değişse checksum başarısız olur (B-03b). `derived` doğrulanmayan önbellek olduğu için hash dışındadır. Checksum bütünlük içindir; kimlik doğrulama veya şifreleme **değildir**.
- **Kanonik JSON:** nesne anahtarları özyinelemeli alfabetik; boşluksuz; sayılar/tarihler string olarak yazıldığı gibi. Her dizi için deterministik sıralama anahtarı:

| Dizi | Sıralama anahtarı |
|---|---|
| subjects, topics, atoms, hooks, questions, inbox | `id` |
| questionRevisions | `(questionId, version)` |
| questionAtoms | `(questionId, role, atomId)` |
| optionAtoms | `(questionId, optionId, atomId, relation)` |
| atomRelations | `(fromAtomId, type, toAtomId)` |
| attempts, voids | `(sequence, id)` |
| evidencePolicyHistory | `(kind, at, policyVersion, tam kayıt kanonik JSON)` |
| schedulerConfigHistory | `(kind, at, configVersion, tam kayıt kanonik JSON)` |
| atom.facets, revision.options | yazıldığı sıra korunur (sıra anlam taşır) |

Geçmiş kayıt türleri (her kaydın `kind`'ı var; `at` her türde zorunlu tek zaman anahtarıdır):
- `config_snapshot`: `{ kind, at, configVersion, config: {...tam config, resolvedWeights} }` — `at` = arşivlenme anı (eski `since`/`archivedAt` alanları bu tek alana taşındı).
- `scheduler_migration`: `{ kind, at, from: {engine, engineVersion, configVersion}, to: {…}, reason: "scheduler_migration" }`.
Sıralama son anahtarı tam kaydın kanonik JSON'udur → eşit sürüm/eşit zaman kayıtları bile deterministik sıralanır; karşılaştırma kod noktası sırasıyla (locale bağımsız). B-25b.

Böylece depo/platformun kayıt döndürme sırası ne checksum'ı ne round-trip eşitliğini etkiler (B-25). Hash `PlatformServices.HashService` üzerinden hesaplanır (§11).
- `resolvedWeights`: `02` §4; algoritma gerçekleştirimi değildir.
- `derived`: isteğe bağlı `{ memory, reviewEvents }`; geri yüklemede **okunmaz**, yalnız doğrulama karşılaştırması için.
- `platform`: bilgi amaçlı (`pwa` | `ios` | `android`); geri yüklemede davranışı etkilemez.
- `schemaVersion`: paketin içeriğinin fiziksel şeması. Geri yükleme sonrası ana DB'nin `meta.schemaVersion`'ı **kurulu uygulamanın gerçek şemasıdır** (migrate edilmiş); kaynak şema bilgisi `meta.restoreProvenance { sourceSchemaVersion, sourceFormatVersion, backupId, restoredAt }` içinde saklanır.
- **Desteklenen (backupFormatVersion, schemaVersion) matrisi** — hash geçerli olsa bile matris dışı kombinasyon reddedilir (B-35):

| backupFormatVersion | schemaVersion | Yol |
|---|---|---|
| 1 | 1 | `migrateBackup(1→2)` → şema 2 |
| 2 | 2 | doğrudan |
| bilinen format, bilinmeyen/ileri şema | — | red: "Bu yedek daha yeni bir veri şemasıyla alınmış" |
| bilinmeyen/ileri format | — | red |

- **Bilinmeyen alanlar:** desteklenen bir formattaki ham olay ve içerik kayıtlarında tanınmayan ek alanlar yorumlanmadan **olduğu gibi korunur** (import → depo → export'ta aynen); davranışı etkileyebilecek bilinmeyen format/şema/config sürümleri ise reddedilir. Güvenli koruma mümkün değilse tam yedek yüklemesi reddedilir; sessiz budama yoktur (B-30).
- `lastExternalBackupAt/Sequence` ve diğer cihaz meta alanları taşınabilir formata **girmez** (§10).
- Yedek ile senkron karıştırılmaz: yedek bir dosyadır; birleştirme (merge) yoktur; geri yükleme tam değiştirmedir.

## 8. Güvenli geri yükleme (Safe Restore)

Yedek aktif veritabanının üstüne **doğrudan yazılmaz**. Akış (`13` §5 ile aynı):
```
1.  Dosyayı parse et. Parse hatası → reddet. `kind = recovery_dump` → reddet (§6.3). Aktif DB'ye dokunulmadı.
2.  backupFormatVersion ve schemaVersion'ı oku; §7 matrisi dışı → reddet.
3.  GELEN DOSYANIN KENDİ FORMATININ doğrulayıcısıyla bütünlük: format ≥ 2 → orijinal checksum'ı orijinal kanonik girdi
    üzerinden yeniden hesapla; uyuşmazsa reddet. Format 1 → checksum yok; yalnız gerçek format-1 doğrulayıcısında
    "checksum yok" uyarısı + format-1 yapısal kurallar. (Migration'dan ÖNCE; migration sonrası içerik değiştiğinden
    orijinal hash migrate edilmiş içerikle karşılaştırılmaz, yeniden üretilen hash gelen dosyayı sınamaz.)
4.  Eski desteklenen format → BELLEKTE saf migrateBackup zinciriyle güncel formata çevir (§8.3).
5.  Güncel şemanın yapısal ve referans bütünlüğünü doğrula (§8.2); hata varsa reddet.
5b. normalizedSnapshot üret (bellekte, §8.4): scheduler uyumluysa paketin config'i aktif kalır;
    uyumsuzsa aktif config = kurulu uygulamanın güncel SchedulerConfig'i, paketinki history'ye arşivlenir.
6.  Dry-run REBUILD: bellekte, normalizedSnapshot'ın aktif config'i ile. Hata → reddet. Sonuç: dryRunMemory.
7.  Değişmez doğrulamaları: sequence benzersiz ve sayaç hesaplanabilir; her Question için currentVersion revision'ı var;
    Question.primaryAtomId = currentRevision.primaryAtomId = QuestionAtom(primary). Saat tutarsızlığı önizlemesi (§3.1).
8.  Kullanıcıya özet: yedek tarihi, app/schema sürümü, atom/soru/attempt sayısı, uyarılar, "mevcut verin değişecek". Onay bekle.
9.  RestoreJournal yaz (§8.5): { jobId, phase: "prepared", targetSummary, prePointId: null, startedAt }.
10. Mevcut durumdan otomatik kurtarma noktası: reason = pre_restore, pinned = jobId (§9). Yazılamazsa geri yükleme DURUR,
    journal "aborted". Journal.prePointId ← nokta id.
11. replaceAll(normalizedSnapshot) — tek atomik transaction; AYNI transaction meta.appliedJobId = jobId, meta.generationId = yeni,
    meta.generationStartSequence, meta.restoreProvenance yazar; aktif config bu snapshot'takidir.
12. Journal phase ← "committed".
13. REBUILD (aynı aktif config ile) → postMemory; scheduler migration ise açıkça işaretle (02 §4.1).
14. Doğrulama (her durumda): serializeMemory(postMemory) === serializeMemory(dryRunMemory)  — aynı aktif config, fark BEKLENMEZ;
    depodan okunan ham olaylar ve içerik, normalizedSnapshot ile KANONİK JSON olarak eşit (sayı eşitliği yeterli değil);
    sayaç = max sequence. Paketin isteğe bağlı `derived`'ı ile fark olabilir (eski motor), bu doğrulamaya girmez.
15. Journal phase ← "verified"; pin kaldırılır; retention uygulanır (§9).
16. Adım 11'den sonra herhangi bir hata (13/14) → ACİL GERİ DÖNÜŞ (§8.6): journal.prePointId'den, yeni nokta yazmadan.
```
**Bozuk yedek aktif veriyi asla değiştirmez**: adım 1–8'de red, adım 10 başarısızsa durma. Mesaj: "Yedek doğrulanamadı. Mevcut verine dokunulmadı."

### 8.5 Kalıcı geri yükleme günlüğü (RestoreJournal) ve açılışta çözümleme
Küçük kalıcı kayıt (recovery deposunda, ana DB'den ayrı): `{ jobId, kind: restore | recovery_point_restore | reset, phase: prepared | committed | verified | rolled_back | aborted, targetSummary, prePointId, startedAt, updatedAt }`. Ana veriyi değiştiren `replaceAll` transaction'ı `meta.appliedJobId` değerini **atomik** olarak aynı transaction'da yazar.

Açılış kuralı: journal'da `verified/rolled_back/aborted` olmayan bir iş varsa **normal çalışma başlamaz**, önce çözümlenir:
- `meta.appliedJobId ≠ jobId` → commit olmamış; journal `aborted`; eski veri zaten yerinde.
- `meta.appliedJobId = jobId` ve phase `committed` (doğrulama yapılmamış) → adım 13–14 yeniden koşulur; geçerse `verified`, geçmezse §8.6.
Yarım iş sessizce tamamlanmış sayılmaz (B-33). Pin'li ön nokta iş bitene kadar retention'dan korunur (§9).

### 8.6 Acil geri dönüş (emergency rollback) ≠ kullanıcı geri yüklemesi
- **Kullanıcı başlatmalı** geri yükleme/kurtarma noktasına dönüş: yeni `pre_restore` noktası **zorunlu** (adım 10); yazılamazsa başlamaz.
- **Acil geri dönüş** (başarısız işin telafisi): o işin journal'daki, önceden doğrulanmış ve pin'li `prePointId` noktasını kullanır; **yeni nokta üretmeyi zorunlu tutmaz** (kota dolmuş olabilir); payload doğrudan `replaceAll` ile geri yazılır (tek transaction, `meta.appliedJobId = jobId + ":rollback"`), REBUILD, doğrulama. **Tek otomatik deneme**; başarısızsa uygulama **yazma-kilitli kurtarma ekranına** geçer: "Geri yükleme tamamlanamadı; verin korunmuş kurtarma noktasındadır" + tek dokunuşla aynı noktaya dönüş düğmesi + kurtarma dökümü (§6.3). Kendini yeniden çağıran döngü yoktur (B-32).
### 8.4 Normalize edilmiş snapshot (scheduler uyumsuz yedek)
`isCompatible(backup.schedulerConfig, installed.schedulerConfig)` (`02` §4.1) false ise, commit'ten önce bellekte:
1. `backup.schedulerConfig` kaybolmaz: `schedulerConfigHistory`'ye `{ kind: "config_snapshot", at: now, configVersion: backup.configVersion, config: {...backupConfig} }` olarak arşivlenir (§7 kayıt türleri).
2. `schedulerConfigHistory`'ye `{ kind: "scheduler_migration", at: now, from: {engine, engineVersion, configVersion}, to: {…}, reason: "scheduler_migration" }` eklenir.
3. **Aktif `schedulerConfig` = kurulu uygulamanın gerçekten kullandığı güncel config** (kendi `configVersion`'ı ve `resolvedWeights`'i ile) olur.
4. `replaceAll(normalizedSnapshot)` bu aktif config ile commit edilir; REBUILD aynı aktif config ile yapılır.
5. Uygulama kapatılıp yeniden açıldığında DB'den okunan aktif config güncel/uyumlu config'tir; eski uyumsuz config bir daha aktif olmaz (B-19).
Uyumluysa normalize işlemi kimliktir (paketin config'i aktif kalır).

### 8.2 Doğrulama politikası (tam yedek için sert)
Aşağıdakiler **commit öncesi durdurur** (uyarıyla yükleme yok):
- `events.attempts[].id` tekrarı; `sequence` tekrarı (attempts + voids birlikte);
- bir Attempt'ın `(questionId, questionVersion)` için QuestionRevision bulunmaması (`content_unavailable_legacy` bir revision'dır, sayılır);
- `complete` revision'da `correctOptionId` seçeneklerde yok veya `options.length < 2`; `complete` revision'da `createdAt = null` iken `legacyProvenance.createdAtSource ≠ "unknown"` (uydurma/eksik tarih); `content_unavailable_legacy` revision'da `text/options/correctOptionId` **dolu** (sahte içerik göstergesi), `createdAt` dolu veya `legacyProvenance` eksik; herhangi bir sorunun güncel `OptionAtom.optionId = currentRevision.correctOptionId`;
- kopuk zorunlu ebeveyn referansı: `Atom.topicId`, `Topic.subjectId`, `Question.primaryAtomId`, `Attempt.primaryAtomIdAtAttempt` bir Atom'a çözülmüyor; `QuestionRevision.primaryAtomId`: `complete` revision'da zorunlu ve Atom'a çözülmeli; `content_unavailable_legacy` revision'da **null olabilir**, null değilse Atom'a çözülmeli (null bozuk paket değildir);
- `AttemptVoid.targetAttemptId` bilinmiyor; aynı hedefe birden çok void (mükerrer);
- semantik tutarlılık: bir revision içinde `options[].id` tekrarı; `complete` revision'a ait Attempt'ta `primaryAtomIdAtAttempt ≠ revision.primaryAtomId` veya `correct ≠ (selectedOptionId === revision.correctOptionId)`; `selectedOptionId` revision seçeneklerinde yok; `responseTimeMs`/`sequence`/`version` negatif, sonlu olmayan veya tamsayı olmayan; `replayOfAttemptId` bilinmeyen Attempt'a işaret ediyor; `content_unavailable_legacy` revision'lar için yalnız §8.2'deki legacy kuralları uygulanır (içerik karşılaştırması yapılmaz);
- `Question.currentVersion` revision'ı yok; `Question.primaryAtomId ≠ currentRevision.primaryAtomId`; QuestionAtom(primary) eksik veya farklı;
- checksum uyuşmazlığı; zorunlu alan eksikliği; enum dışı değer.
Yalnız uyarı: isteğe bağlı alanlarda bilinmeyen anahtar (yok sayılır), `derived` uyuşmazlığı (config farkında beklenir), `inbox` öğelerinde kopuk referans.
Bozuk paketten ham olay kurtarma ("salvage") ayrı ve gelecek bir özelliktir; normal geri yükleme bozuk paketi sessizce kabul etmez.

### 8.3 Eski yedek uyumluluğu
- Yayımlanmış bir yedek formatının sonradan okunamaz hâle gelmesi **yasaktır**. Her `backupFormatVersion` artışında saf `migrateBackup(v → v+1)` fonksiyonu yazılır; zincir halinde uygulanır (1 → 2 → 3 …).
- Bilinen: `migrateBackup(1 → 2)`: format 1 paketinde `questions[]` metin/seçenek/doğru alanlarını taşır; her soru için exact `complete` revision üretilir (`version = question.version`); Attempt'ların referansladığı, içeriği bulunmayan sürümler için `content_unavailable_legacy` revision üretilir (§6.2 ile **aynı** kural, `fromSchemaVersion: 1`); güncel içerik eski sürüme kopyalanmaz; `checksum` yoktur → doğrulama "format 1: checksum yok" uyarısıyla geçer, diğer bütünlük kuralları uygulanır.
- Sıra: önce gelen formatın kendi bütünlük doğrulaması (§8 adım 3), sonra bellekte migration (adım 4), sonra güncel şema doğrulaması (adım 5). Format 2 → 3 dönüşümü geldiğinde geçerli hash'li format-2 dosyası orijinal hash'iyle doğrulanır, sonra çevrilir; hash'i değiştirmeden bozulmuş içerik migration'dan önce reddedilir (B-31).
- Bilinmeyen ileri format → mevcut DB'ye dokunmadan red. Migration hiçbir zaman "önce sil sonra deneriz" şeklinde çalışmaz; tamamı bellekte biter, sonra §8 adım 5–15.

## 9. Kurtarma noktaları (Local Recovery Snapshot)

- **Cihaz dışı yedek DEĞİLDİR.** Aynı origin/IndexedDB temizliğinde (iOS Safari dâhil) kaybolabilir. Amacı yanlış geri yükleme, hatalı sürüm veya kullanıcı hatasından **hızlı** geri dönüş.
- Ayrı veritabanı: `ogrenme-motoru-recovery` (Dexie, `RecoveryStore` arayüzü). Ana DB'nin `replaceAll`'u bu depoya **dokunmaz**.
- Kayıt: `{ id, createdAt, reason, appVersion, schemaVersion, counts: { atoms, questions, attempts, voids }, payload }`; `payload` = §7 formatındaki tam yedek (string). Boyut ≈ tam yedek boyutu.
- `reason`: `pre_restore` | `pre_import` | `pre_reset` | `pre_migration` | `post_migration` | `daily` | `manual`.
- Otomatik oluşturma: her yıkıcı geri yükleme/içe aktarma öncesi; kullanıcı tüm veriyi sıfırlayacaksa öncesi; riskli migration öncesi (mümkünse) ve sonrası; günün ilk değişikliğinde bir `daily` nokta.
- Retention (rolling), her `reason` tam olarak bir sınıfta: **işlem sınıfı** = `pre_restore`, `pre_import`, `pre_reset`, `pre_migration`, `post_migration`, `manual` → en fazla 5; **günlük sınıf** = `daily` → en fazla 7; toplam en fazla 12. Yeni yazılınca aynı sınıfın **pin'siz** en eskisi silinir (B-28).
- **Pin (koruma):** kayıt `pinnedBy: jobId | null` taşır. Aktif işin ön noktası (`pre_*`) ve kullanıcının dönmek için seçtiği hedef nokta iş bitene kadar pin'lidir; retention pin'li kaydı **silemez**. Beş nokta varken en eskisine (p1) dönülürse: p1 hedef olarak pin'lenir, yeni `pre_restore` yazılır, budanan p2'dir (pin'siz en eski). İş `verified/rolled_back` olunca pin kalkar ve retention normal uygulanır; bu sırada silinen kayıt olabilir (B-34). Pin'li kayıt sayısı sınırı aşabilir; aşım geçicidir. 5.000 Attempt'lık bir DB ≈ 1.5 MB → 12 nokta ≈ 18 MB; kabul edilir. 50.000 Attempt'ta `daily` retention 3'e düşürülür (config).
- Kurtarma noktasından **kullanıcı başlatmalı** geri dönüş = §8 akışının aynısı (dosya yerine payload), adım 9–10 dâhil: mevcut durumdan yeni `pre_restore` noktası alınır; hedef nokta ve yeni ön nokta pin'lidir. Acil geri dönüş (§8.6) bu kurala tabi değildir.
- Sınırlar: tarayıcı depolama kotası; kota hatası alınırsa en eski `daily` silinip yeniden denenir; yine yazılamazsa yıkıcı işlem **durur**.

## 10. Yedek hatırlatma ve değişmez

- Ekran içi hatırlatma (bildirim değil): son dış yedekten beri **7 gün geçtiyse VEYA 250 yeni ham olay** yazıldıysa. Dış yedek **doğrulanmış** olarak kaydedildiğinde (§11 `saved` veya kullanıcı teyidi) `meta.lastExternalBackupAt`, `lastExternalBackupSequence` (yedeğin alındığı snapshot'ın max sequence'ı) ve `lastExternalBackupGenerationId` güncellenir. Kurtarma noktası yazmak bu alanları **değiştirmez**; yerel noktaya dönmek dış yedek sayılmaz.
- **Meta alan kuralları (geri yükleme / sıfırlama sonrası):**

| Alan | Kural |
|---|---|
| `sequence` | geri yüklenen veriden türetilir (§3 istisnası) |
| `generationId`, `generationStartSequence` | yeni nesil: sıfırlanır/yeniden üretilir |
| `schemaVersion` | kurulu fiziksel şema; kaynak şema `restoreProvenance`'ta |
| `lastExternalBackup*` | **sıfırlanır (null)**: işaretçi eski nesle aittir; fark hesaplanmaz; Bugün ekranı "Yedek durumu bilinmiyor · Yedek al" gösterir |
| `appliedJobId`, `restoreProvenance` | işlem tarafından yazılır |

- Hiç dış yedek alınmamış kullanıcı: `lastExternalBackup* = null` → hatırlatma, ilk Attempt'tan 7 gün sonra **veya** `sequence − generationStartSequence ≥ 250` olunca; negatif fark hiçbir durumda üretilmez (B-36).
- **Kırmızı çizgi:** `yedek → ana DB sil → geri yükle → REBUILD` sonrasında: içerik ve revision'lar eşit; ham olaylar bayt-eşdeğer (kanonik JSON); void'ler eşit; config eşit; uyumlu scheduler altında `serializeMemory` eşit; `nextSequence()` aynı. `08` B-01.

## 11. Platform servisleri sınırı (PlatformServices)

Domain varlığı değil, altyapı sınırıdır. Motor ve uygulama katmanı cihaz/tarayıcı yeteneklerini yalnız bu arayüzler üzerinden kullanır; **hiçbir domain/engine modülü `navigator`, `window`, `document`, `localStorage`, Capacitor eklentisi veya native SDK çağırmaz** (A22).

| Servis | v0 | Web gerçekleştirimi | İleride native |
|---|---|---|---|
| `Clock` | evet: `now()` (UTC duvar saati, olay zamanı) **ve** `monotonicMs()` (oturum bütçesi, `03` §6.3) | `Date` + `performance.now()`; uygulama gizlenince bütçe sayacı durur (`visibilitychange`); uyku sırasında `performance.now()` davranışı platforma göre değişir, bu yüzden gizli süre bütçeye sayılmaz | aynı |
| `IdGenerator` | evet | `crypto.randomUUID` | aynı |
| `HashService` | evet (yedek checksum) | Web Crypto SHA-256 | Capacitor/native crypto |
| `BackupFileService` | evet (yedek dosyası yaz/oku) | File System Access varsa `showSaveFilePicker` (kaydetme gözlemlenir); yoksa Blob indirme (gözlemlenemez) + `<input type=file>` | Capacitor Filesystem + Share (Files/iCloud Drive) |

`BackupFileService.save(file)` sonucu dört durumdan biridir ve UI/meta buna göre davranır (N08, B-38, E-21):
- `saved` — kaydetme doğrulandı (File System Access, native) → "Yedek alındı", meta güncellenir.
- `initiated` — indirme başlatıldı ama kaydetme gözlemlenemez (Blob/`download`) → "İndirme başlatıldı. Dosyanın kaydedildiğini doğrula" + `Kaydettim` teyit düğmesi; meta yalnız teyitle güncellenir; teyit yoksa yedek durumu "doğrulanmamış" gösterilir.
- `cancelled` / `failed` → meta değişmez; kesin başarı iddiası yok.
Yedek işaretçisi her durumda dosyanın alındığı snapshot'ın max sequence'ına bağlanır, kaydetme anına değil.
| `FileService` | hayır | — | — |
| `CameraService` | hayır (M4) | — | Capacitor Camera |
| `NotificationService` | hayır | — | Capacitor Local Notifications |
| `ShareService` | hayır | — | Capacitor Share |
| `NetworkStatusService` | hayır | — | — |
| `HapticsService` | hayır (`14` §15) | — | Capacitor Haptics |
| `SpeechService` | hayır (M4) | — | — |

Yalnız "evet" olanlar v0'da gerçekleştirilir; diğerleri arayüz olarak bile yazılmaz (`10` §2). Yedek formatı hiçbir servise bağlı değildir: PWA'da alınan yedek native'de, native'de alınan yedek PWA'da aynı migration zinciriyle geri yüklenir.

## 12. Depo boyutu ve bakım

- Attempt ≈ 300 bayt; 100.000 Attempt ≈ 30 MB; IndexedDB için sorun değil.
- Ham olay budaması **yoktur**; A3 değişikliği gerektirir, v0 dışıdır.
- iOS Safari uzun süre kullanılmayan PWA depolamasını silebilir: dış yedek hatırlatması (§10) ve Veri ekranındaki açıklama (`07` S12) bu yüzden vardır.
