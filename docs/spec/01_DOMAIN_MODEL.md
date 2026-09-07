# 01_DOMAIN_MODEL.md — Domain Modeli

Referans: `00_ANAYASA.md` A1–A3, A6, A9–A13, A19. Bu dosya kavramları ve alanları tanımlar; fiziksel tablolar `06_STORAGE_REBUILD_EXPORT.md`'de.

## 0. Sözlük (tüm dosyalarda aynı isimler kullanılır)

| Kavram | Anlam | Grup |
|---|---|---|
| Subject | Ders | içerik |
| Topic | Konu (bir Subject'e ait) | içerik |
| Atom | Tek anlamlı bilgi birimi | içerik |
| AtomFacet | Atomun bilgi türü etiketi (çoklu) | enum |
| MemoryHook | Atoma bağlı hafıza çengeli | içerik |
| Question | Mantıksal soru kimliği: mevcut sürüm işaretçisi + düzenlenebilir metadata | içerik |
| QuestionRevision | Bir sürümün tam, değiştirilemez semantik snapshot'ı (metin, seçenekler, doğru, ana atom) | içerik |
| QuestionOption | Bir QuestionRevision içindeki seçenek | içerik |
| QuestionAtom | Soru ↔ atom bağı (primary/secondary) | içerik |
| OptionAtom | Seçenek ↔ atom bağı (yanlış şıkkın hangi atomla karıştığı) | içerik |
| AtomRelation | Atom → atom ilişkisi | içerik |
| Provenance | Köken bilgisi (gömülü nesne) | içerik |
| InboxItem | Öğrenme Kutusu taslağı (v0 dışı, alan tanımı burada) | taslak |
| Attempt | Öğrenme olayı; QuestionAttempt \| RecallAttempt | ham olay |
| AttemptVoid | Bir Attempt'ı geçersiz kılan olay | ham olay |
| EvidencePolicy | Attempt → not eşlemesi, versiyonlu | yapılandırma |
| SchedulerConfig | FSRS yapılandırması, versiyonlu | yapılandırma |
| QueueConfig | Günlük görünür set tavanları | yapılandırma |
| ReviewEvent | Attempt'tan türetilen FSRS review'u | türetilmiş |
| MemoryState | Atom başına FSRS hafıza durumu | türetilmiş |
| DailyQueueItem | Günlük görünür setin bir öğesi | türetilmiş |
| LearningAction | Bir atomun somut sunumu: soru veya hatırlama kartı | türetilmiş |
| Coverage | Atom başına (operation, support) başarı projeksiyonu — v0 dışı | türetilmiş |
| PlatformServices | Domain varlığı değil; cihaz/tarayıcı yeteneklerinin arayüz sınırı (`06` §11) | altyapı |

Ortak kurallar:
- **Domain tipleri saf TypeScript'tir.** Bu dosyadaki hiçbir tipte `window`, `document`, DOM, `navigator`, Safari, Capacitor, iOS, Android, native plugin, IndexedDB/Dexie kavramı bulunmaz; domain modülü bunları import etmez (A22). Renk, yazı tipi, tema gibi UI kavramları da domain'de yoktur (`14`).
- Kimlikler `id`: UUID v4 string. İçerik kimlikleri anlam taşır (A10): anlam değişirse yeni id.
- Zamanlar ISO 8601 UTC string (`2026-09-07T09:00:00.000Z`).
- "Otomatik" işaretli alanlar kullanıcıdan asla sorulmaz; sistem yazar (A12).
- "Değişmez" işaretli alanlar yazıldıktan sonra değiştirilemez.

## 1. Enum'lar

```
AtomFacet        = fact | date | chronology | definition | cause_effect | process | comparison | spatial | rule | exception
Operation        = recall | explain | contrast | reverse | apply | detect | connect | generate | order | discriminate
Support          = none | cue | hook | visual | timeline | choices | partial
Confidence       = sure | unsure | guess
AttemptMode      = new | review | pretest | external
WrongReason      = unknown | confused | attention | skipped
SelfAssessment   = again | hard | good
HookType         = logic | mnemonic | absurd | analogy | story | visual | warning | personal
QuestionAtomRole = primary | secondary
OptionAtomRelation = contradicts | common_confusion | trap
RelationType     = prerequisite | confusable
ProvenanceType   = deneme | kitap | kisi | merak | ders | sosyal_medya | kendi
Rating           = 1 (Again) | 2 (Hard) | 3 (Good) | 4 (Easy)
```

`discriminate` çoktan seçmeli sorunun işlemidir (şıklardan seçmek). `partial` = kısmi cevap gösterildi (boşluk doldurma gibi). Bu üç sözlük (facet, operation, support) dışında öğrenme taksonomisi yoktur (`04_RE_EXPOSURE_DESIGN.md`).

## 2. İçerik

### 2.1 Subject
- Amaç: dersleri sıralamak ve gruplamak.
- Kimlik: `id`.
- Zorunlu: `id`, `name`, `sortOrder` (tamsayı, otomatik: mevcut max + 1).
- Değişmez: `id`.
```json
{ "id": "sub-1", "name": "Tarih", "sortOrder": 1 }
```

### 2.2 Topic
- Zorunlu: `id`, `subjectId`, `name`, `sortOrder` (otomatik).
```json
{ "id": "top-1", "subjectId": "sub-1", "name": "Osmanlı yenileşme", "sortOrder": 1 }
```

### 2.3 Atom
- Amaç: öğrenme birimi (A1). Hafıza durumu bu kimliğe bağlıdır.
- Kimlik: `id` — semantik kimlik (A10).
- Zorunlu: `id`, `topicId`, `text` (tek cümle), **`prompt`** (hatırlama kartının soru yüzü: cevabı vermeyen, aynı konudaki diğer atomlardan ayırt edilebilen tek anlamlı soru; örn. "Tanzimat Fermanı hangi yıl ilan edildi?"), `facets` (en az bir; kullanıcı seçmezse `["fact"]`), `sortOrder` (otomatik), `archived` (varsayılan false), `createdAt` (otomatik).
- İsteğe bağlı: `why`, `how`, `confusedWith` (serbest metin), `provenance`.
- **Çalışılabilirlik:** `prompt` boş olan atom (yalnız eski veriden gelebilir) kuyruğa girmez; İçerik ekranında "soru yüzü eksik" olarak listelenir ve tamamlanınca çalışılabilir olur. Konu adı ölçüm sorusu **sayılmaz**.
- Değişmez: `id`, `createdAt`. `text`'in anlamı değişemez; anlam değişirse yeni Atom + eski `archived: true`.
- Kullanıcı girmez: `id`, `sortOrder`, `createdAt`, `archived`.
```json
{
  "id": "atm-tanzimat-yil", "topicId": "top-1",
  "text": "Tanzimat Fermanı 1839 yılında ilan edildi.",
  "prompt": "Tanzimat Fermanı hangi yıl ilan edildi?",
  "facets": ["date", "fact"], "sortOrder": 12, "archived": false,
  "createdAt": "2026-09-07T09:00:00.000Z"
}
```

### 2.4 MemoryHook
- Amaç: atoma bağlı çengel; tür açık uçlu, kolon değil kayıt.
- Zorunlu: `id`, `atomId`, `type` (HookType), `content`.
- Kullanıcı girer: `type`, `content`.
```json
{ "id": "hk-1", "atomId": "atm-karadeniz-yagis", "type": "logic",
  "content": "Paralel dağ + nemli deniz havası + yükselme = yağış." }
```

### 2.5 Question (baş kayıt) ve QuestionRevision (sürüm snapshot'ı)

**Question** mantıksal kimliktir: mevcut sürüm işaretçisi ve sürüm gerektirmeyen metadata.
- Zorunlu: `id`, `currentVersion` (tamsayı ≥ 1), `primaryAtomId` (= mevcut revision'ın primaryAtomId'si; denormalize, aynı transaction'da güncellenir), `source`, `archived` (varsayılan false), `createdAt`, `updatedAt`.
- İsteğe bağlı: `provenance`, `trapType`, `questionType`.
- Değişmez: `id`, `createdAt`.
```json
{ "id": "q-1", "currentVersion": 2, "primaryAtomId": "atm-tanzimat-amac", "source": "kendi",
  "archived": false, "createdAt": "2026-09-07T09:05:00.000Z", "updatedAt": "2026-09-20T11:00:00.000Z" }
```

**QuestionRevision** belirli bir sürümün tam semantik snapshot'ıdır. **Değiştirilemez**; asla üzerine yazılmaz, silinmez.
- Kimlik: `(questionId, version)`.
- `integrityStatus`: `complete` (varsayılan; alan yoksa complete kabul edilir) | `content_unavailable_legacy`.
- `complete` için zorunlu: `questionId`, `version`, `text`, `options` (QuestionOption[] tam snapshot, en az 2), `correctOptionId` (options içinde olmalı), `primaryAtomId`, `createdAt` (**bilinmiyorsa `null`**; yalnız migration'dan gelen ve gerçek sürüm tarihi olmayan revision'larda, `legacyProvenance.createdAtSource = "unknown"` ile — `06` §6.2. Uygulama içinde oluşturulan her revision'da dolu).
- `content_unavailable_legacy` için: `questionId`, `version`, `createdAt: null` (sürüm tarihi bilinmiyor; migration anı `legacyProvenance.migratedAt`'tadır, sürüm tarihi diye gösterilmez), `legacyProvenance { migratedAt, fromSchemaVersion, createdAtSource: "unknown" }` zorunlu; `primaryAtomId` yalnız o sürüme ait tüm Attempt snapshot'ları aynı atomu gösteriyorsa o atom, aksi hâlde `null`; `text`, `options`, `correctOptionId` **yoktur** (null). Bu kayıt eski veri modelinde saklanmamış geçmişi açıkça temsil eder; içerik **uydurulmaz** (A9). Yalnız migration üretir (`06` §6.2, §8.3); uygulama içinden elle oluşturulamaz.
```json
{ "questionId": "q-1", "version": 1,
  "text": "Tanzimat Fermanı hangi yıl ilan edilmiştir?",
  "options": [ { "id": "o-1", "text": "1839" }, { "id": "o-2", "text": "1856" }, { "id": "o-3", "text": "1876" } ],
  "correctOptionId": "o-1", "primaryAtomId": "atm-tanzimat-yil", "createdAt": "2026-09-07T09:05:00.000Z" }
```

**Sürüm kuralı (A9):** `text`, `options` (metin, ekleme, çıkarma, sıra), `correctOptionId` veya `primaryAtomId` değişirse: mevcut revision'a dokunulmaz; `version = currentVersion + 1` ile yeni QuestionRevision yaratılır; `Question.currentVersion`, `Question.primaryAtomId`, `updatedAt` ve QuestionAtom(primary) **tek transaction** içinde güncellenir (§2.7). `source`, `trapType`, `questionType`, `archived` değişikliği sürüm üretmez.

**Seçenek kimlikleri (kesin kural):**
- Seçeneğin metni/anlamı **gerçekten değişmemişse** aynı `optionId` korunur (analiz sürekliliği).
- Seçeneğin metni/anlamı **değişiyorsa** bu artık yeni bir semantik seçenektir ve **yeni `optionId`** alır; eski id eski revision'da kalır.
- Eklenen seçenek yeni `id` alır; çıkarılan seçenek yalnız eski revision'da durur.
- Attempt'taki `selectedOptionId` her zaman `QuestionRevision(questionId, questionVersion)` içinde çözülür; güncel revision'da olmaması normaldir.
- Bu kural OptionAtom'un bayatlamasını önler (§2.8): id yalnız anlam korunuyorsa yaşar.

**Geçmişi görüntüleme:** bir Attempt'ın gördüğü soru = `QuestionRevision(attempt.questionId, attempt.questionVersion)`. Eski metin, eski seçenekler, eski doğru cevap ve eski ana atom bu kayıttan yeniden gösterilebilir; yanlış geçmişi analiz edilebilir. Revision `content_unavailable_legacy` ise UI ve analiz şunu söyler: "Bu eski denemeye ait soru metni eski veri modelinde saklanmadığı için mevcut değil." Güncel soru metni hiçbir koşulda eski sürümün metniymiş gibi gösterilmez. Attempt'ın kendisi ve FSRS geçmişi etkilenmez (hafıza `primaryAtomIdAtAttempt` snapshot'ından kurulur, revision içeriğinden değil).

### 2.6 QuestionOption
- QuestionRevision içinde gömülü: `id`, `text`. Kimlik revision içinde benzersiz.

### 2.7 QuestionAtom
- Amaç: soru ↔ atom bağı, **güncel** sürüme göre (sorgu indeksi). Geçmiş sürümlerin ana atomu QuestionRevision'dadır; QuestionAtom sürüm taşımaz.
- Zorunlu: `questionId`, `atomId`, `role`.
- Her sorunun tam olarak bir `primary` kaydı vardır. **Değişmez tutarlılık kuralı:** her an `Question.primaryAtomId = QuestionRevision(currentVersion).primaryAtomId = QuestionAtom(primary).atomId`. Ana atom düzenlemesi tek transaction'da (1) yeni QuestionRevision yazar, (2) Question baş kaydını günceller, (3) QuestionAtom(primary) satırını günceller. Hiçbir anda `Question.primaryAtomId = B` iken `QuestionAtom(primary) = A` kalamaz; ortada çökme ya tümünü ya hiçbirini bırakır (`06` §5).
- `secondary` kayıtları isteğe bağlı, güncel sürüme ait, yalnız analiz. Soru **anlamı** değişince (`text`, `correctOptionId` veya `primaryAtomId` değişen revision) kör biçimde güncel sayılmaz: aynı transaction'da silinir, kullanıcı "+ Gelişmiş"ten yeniden onaylar. Yalnız bağlamı koruyan revision'larda (seçenek sırası/ekleme; metin, doğru cevap, ana atom aynı) korunur.
```json
{ "questionId": "q-1", "atomId": "atm-tanzimat-yil", "role": "primary" }
```

### 2.8 OptionAtom
- Amaç: yanlış şıkkın hangi atomla karıştığını işaretlemek; ileride hata nedeni tahmini. v0'da isteğe bağlı, "gelişmiş" alanı.
- Zorunlu: `questionId`, `optionId`, `atomId`, `relation`.
- Sürüm kapsamı (en basit tutarlı model): OptionAtom **güncel sürüme** aittir, `questionVersion` taşımaz. Bir seçeneğin "yanlış şık / karıştırma" anlamı seçenek metnine değil, **soru köküne ve cevap anahtarına** da bağlıdır. Yeni revision üretilirken aynı transaction'da:
  - **bağlam değişti** (`text`, `correctOptionId` veya `primaryAtomId` değişti) → o sorunun **tüm** OptionAtom ve secondary QuestionAtom satırları silinir; kullanıcı "+ Gelişmiş"ten yeniden onaylar (I-QA-09);
  - **bağlam korundu** (yalnız seçenek sırası değişti/seçenek eklendi) → `optionId`'si yeni revision'da bulunan satırlar korunur; çıkarılan veya metni değiştiği için yeni id alan seçeneklerin satırları silinir; eski OptionAtom yeni id'ye **otomatik taşınmaz**;
  - **değişmez:** hiçbir revision'da `OptionAtom.optionId = revision.correctOptionId` olamaz (doğru seçenekte yanlış-şık ilişkisi yok; kaydetme reddeder, B-27).
  Geçmiş analiz için gerekirse OptionAtom'un kendisi revision'a bağlanır (ileride; v0 dışı).
```json
{ "questionId": "q-1", "optionId": "o-2", "atomId": "atm-islahat-yil", "relation": "common_confusion" }
```

### 2.9 AtomRelation
- Zorunlu: `fromAtomId`, `toAtomId`, `type`. `prerequisite`: from'u anlamak için to gerekir. `confusable`: ikisi karıştırılır (simetrik kabul edilir).
```json
{ "fromAtomId": "atm-tanzimat-yil", "toAtomId": "atm-islahat-yil", "type": "confusable" }
```

### 2.10 Provenance (gömülü nesne)
- Amaç: köken. MemoryHook.personal içine gömülmez.
- Alanlar: `type` (ProvenanceType), `note?`, `ref?` (görsel/dosya referansı), `date` (otomatik), `context?` (kişisel bağlam: "Ahmet sordu").
```json
{ "type": "deneme", "note": "2026 AGS deneme 3, soru 34", "date": "2026-09-07T09:00:00.000Z" }
```

## 3. Taslak

### 3.1 InboxItem (v0 dışı; alan tanımı ileride tutarlılık için)
- Zorunlu: `id`, `rawText`, `capturedAt` (otomatik), `status` (pending | processed | discarded).
- İsteğe bağlı: `imageRef`, `audioRef`, `provenance`.
- Olay **değildir**: hiçbir projeksiyona girmez; düzenlenebilir ve silinebilir. Ayrıntı `05_LEARNING_CAPTURE.md`.

## 4. Ham olaylar (append-only)

### 4.1 Attempt — ortak alanlar (base)
Tüm alanlar yazıldıktan sonra **değişmez**.

| Alan | Tip | Kaynak | Açıklama |
|---|---|---|---|
| `id` | string | otomatik | UUID; sunum anında üretilen `LearningAction.actionId`'den türetilir (aynı sunuma ikinci kayıt aynı id'yi alır ve depo tarafından reddedilir → çift dokunma/yeniden deneme güvenli, I-20) |
| `kind` | `question` \| `recall` | otomatik | discriminant |
| `replayOfAttemptId` | string? | otomatik | yalnız geri al sonrası tekrar sunumdan doğan Attempt'ta; void edilen Attempt'ın id'si (`03` §6.5). Ham, değiştirilemez bağ. |
| `sequence` | tamsayı | otomatik | kesin işlem sırası, monoton artan, boşluk olabilir (A19) |
| `timestamp` | ISO | otomatik | gerçek zaman; external modda yakalama anı |
| `sessionId` | string | otomatik | uygulama açılışında üretilen oturum kimliği |
| `primaryAtomIdAtAttempt` | string | otomatik snapshot | o anda ölçülen atom (A6) |
| `mode` | AttemptMode | otomatik | `new`: atomun hafıza durumu yok; `review`: var; `pretest`: kullanıcı/akış açıkça pretest dedi; `external`: yakalama akışından gelen gerçek başarısızlık |
| `confidence` | Confidence \| null | kullanıcı (soru) / null (recall) | QuestionAttempt'ta zorunlu; RecallAttempt'ta null |
| `operation` | Operation | otomatik | soru → `discriminate`; hatırlama kartı → `recall` |
| `support` | Support | otomatik | soru → `choices`; kart → çengel gösterildiyse `hook`, yoksa `none` |
| `responseTimeMs` | tamsayı | otomatik | soru: sunumdan güven dokunuşuna kadar; kart: sunumdan "Cevabı aç" dokunuşuna kadar (hatırlama anı). Sonuç okuma ve öz değerlendirme süresi dâhil değildir. |
| `wrongReason` | WrongReason? | kullanıcı | yalnız yanlış soru cevabında |

### 4.2 QuestionAttempt
Ek alanlar (hepsi değişmez):

| Alan | Kaynak | Açıklama |
|---|---|---|
| `questionId` | otomatik | |
| `questionVersion` | otomatik snapshot | cevap anındaki `Question.currentVersion` (A9) |
| `initialSelectedOptionId` | otomatik | ilk dokunulan seçenek |
| `selectedOptionId` | kullanıcı | onaylanan seçenek |
| `changedAnswer` | otomatik | `initialSelectedOptionId !== selectedOptionId` (türetilebilir; yazma anında sabitlenir) |
| `correct` | otomatik snapshot | `selectedOptionId === revision.correctOptionId` (revision = §4.2a'daki `QuestionRevision(questionId, questionVersion)`); cevap anında hesaplanır ve dondurulur; soru sonradan değişse bile değişmez |

**4.2a QuestionAttempt kurulum akışı (semantik kaynak revision'dır; Question baş kaydında metin/seçenek/doğru yoktur):**
```
0. Sunum anında (Resolver, 03 §4.2): action ← { questionId, questionVersion = Question.currentVersion, actionId }
   → sürüm burada SABİTLENİR; kullanıcı bu revision'ı görür
1. version  ← action.questionVersion                        // kayıt anındaki currentVersion DEĞİL
2. revision ← QuestionRevision(questionId, version)
3. revision.integrityStatus = "complete" olmalıdır; değilse soru sunulamaz (uygulama hatası, Attempt yazılmaz)
4. correct  ← selectedOptionId === revision.correctOptionId
5. Attempt'a yazılır: questionVersion = version, primaryAtomIdAtAttempt = revision.primaryAtomId, correct, id ← from(actionId)
```
Kullanıcı v1'i açmışken soru başka bir pencerede v2 olsa bile cevap, seçenekler, doğruluk ve ana atom v1'e aittir (U-RS-08). Geri al tekrar sunumu da aynı sabit sürümü kullanır (`03` §6.5). Snapshot'ın kaynağı **revision**dır, baş kayıt değil.

```json
{
  "id": "att-101", "kind": "question", "sequence": 101,
  "timestamp": "2026-09-07T10:12:03.120Z", "sessionId": "ses-7",
  "primaryAtomIdAtAttempt": "atm-tanzimat-yil", "mode": "review",
  "confidence": "unsure", "operation": "discriminate", "support": "choices",
  "responseTimeMs": 8400, "wrongReason": null,
  "questionId": "q-1", "questionVersion": 1,
  "initialSelectedOptionId": "o-2", "selectedOptionId": "o-1",
  "changedAnswer": true, "correct": true
}
```

### 4.3 RecallAttempt
Ek alanlar:

| Alan | Kaynak | Açıklama |
|---|---|---|
| `atomId` | otomatik | = `primaryAtomIdAtAttempt` (okunabilirlik için tekrar; ikisi her zaman eşit) |
| `selfAssessment` | kullanıcı | again \| hard \| good |

| `confidenceAtFailure` | kullanıcı (yalnız `mode = external`) | Dışarıdan yakalanan gerçek başarısızlıkta kullanıcının o anki güveni ("bundan emindim" → `sure`). Yalnız external modda anlamlıdır; diğer modlarda yoktur. `provenance.note` içine gömülmez; yapılandırılmış ham veridir (yanlış+emin analizi, A8). |

`confidence` bu türde `null`; öz değerlendirme zaten güven yargısıdır, ikinci bir soru sorulmaz. External başarısızlıkta güven bilgisi `confidenceAtFailure` ile taşınır.

```json
{
  "id": "att-102", "kind": "recall", "sequence": 102,
  "timestamp": "2026-09-07T10:14:40.000Z", "sessionId": "ses-7",
  "primaryAtomIdAtAttempt": "atm-karadeniz-yagis", "atomId": "atm-karadeniz-yagis",
  "mode": "review", "confidence": null, "operation": "recall", "support": "hook",
  "responseTimeMs": 15200, "selfAssessment": "hard"
}
```

### 4.4 Pretest
Ayrı tür yoktur. `mode = "pretest"` olan QuestionAttempt veya RecallAttempt. Kaydedilir, ReviewEvent üretmez (A5).

### 4.5 External / capture
Yakalama (InboxItem) Attempt değildir. Yalnız `05_LEARNING_CAPTURE.md`'deki koşulda, hafıza durumu olan bir atomun gerçek hatırlama başarısızlığı `mode = "external"` bir RecallAttempt (`selfAssessment: "again"`, `timestamp` = yakalama anı, isteğe bağlı `confidenceAtFailure`) üretir. Yeni Attempt türü açılmaz. v0'da bu akış yoktur; `external` değeri enum'da ayrılmıştır, migration gerektirmez.

### 4.6 AttemptVoid
- Amaç: hatalı dokunuşu geçersiz kılmak (A3). Attempt silinmez.
- Zorunlu (değişmez): `id`, `targetAttemptId`, `sequence` (Attempt'larla aynı sayaç), `timestamp`, `reason` (`undo` | `clock_skew` | `content_error`), isteğe bağlı `note` (content_error için: hangi soru/sürüm, ne düzeltildi).
- **`content_error` (K01 kararı):** eski cevap anahtarı/içerik hatalıysa yalnız yeni revision üretmek geçmiş ölçümü onarmaz (REBUILD snapshot'tan okur, A6/A9). Normal düzenleme ile "eski anahtar hatalıydı" düzeltmesi ayrılır: kullanıcı `correctOptionId` değiştirirken "Eski cevap anahtarı hatalı mıydı?" sorulur; **Evet** ise etkilenen denemeler (o sorunun önceki sürümlerine verilmiş ve doğruluğu yeni anahtara göre farklı çıkan Attempt'lar) önizlenir; onayla her biri için `AttemptVoid { reason: "content_error", note }` yazılır ve REBUILD yapılır. Ham `correct` alanı **sessizce değiştirilmez**; yeni Good olayı **üretilmez** (ölçülmemiş başarı uydurulmaz); etkilenen ölçüm yalnız güvenilmez sayılıp kanıttan çıkarılır. Eski kayıtlar ve gerekçe görüntülenebilir kalır (S11). **Hayır** ise yalnız yeni revision oluşur, geçmiş değişmez.
- v0'daki girişler: cevaptan hemen sonraki ekrandaki "Geri al" (soru sonucu ekranı, doğru ve yanlış cevapta; hatırlama kartı öz değerlendirmesinden sonra kısa ömürlü görünür bir "Geri al", `07` S7) ve saat tutarsızlığı listesi (`06` §3.1). Geri alma hedefi UI'daki `undoToken` ile **sabittir**; kayan "son Attempt" hedefi yoktur. Aynı Attempt iki kez void edilemez (ikinci istek reddedilir, olay yazılmaz).
- **Undo bir scheduler kararı değil, tek seferlik düzeltme tekrarıdır (correction replay):** void + REBUILD sonrası, void edilen Attempt'ı üreten **aynı** LearningAction (aynı `questionVersion`) bir kez yeniden sunulur; bu tekrar hiçbir `due` yazmaz; kullanıcı yeniden cevaplayınca `replayOfAttemptId` taşıyan normal Attempt oluşur ve `selectNext` normal devam eder (`03` §6.5). Geri al kayıttan sonraki 30 saniye içinde ve her action için bir kez mümkündür; amaç yanlış dokunuşu düzeltmektir, cevabı gördükten sonra yeni sınama üretmek değil. Tekrar sunumu geçici (transient) UI durumudur; uygulama kapanırsa persist edilmesi zorunlu değildir, normal kuyruk devam eder.
```json
{ "id": "void-3", "targetAttemptId": "att-101", "sequence": 103,
  "timestamp": "2026-09-07T10:12:20.000Z", "reason": "undo" }
```

## 5. Yapılandırma (versiyonlu, yedeğe girer)

### 5.1 EvidencePolicy
`{ "policyVersion": 1 }` — eşleme tablosu `02_EVIDENCE_FSRS_ENGINE.md`'de. Sürüm değişirse REBUILD.

### 5.2 SchedulerConfig
Alanlar ve v0 değerleri `02_EVIDENCE_FSRS_ENGINE.md` §4. `configVersion` ile versiyonlu.

### 5.3 QueueConfig
`{ "reviewCap": 25, "newPerDay": 10 }` — `03_DAILY_QUEUE_ENGINE.md`.

## 6. Türetilmiş (silinip yeniden üretilebilir, A4)

### 6.1 ReviewEvent
`{ attemptId, atomId, rating (1–3), reviewedAt }` — `reviewedAt` atom başına monoton kırpılmış zaman (`02` §5.3).

### 6.2 MemoryState
Atom başına: `atomId`, `due`, `stability`, `difficulty`, `reps`, `lapses`, `state` (0 New, 1 Learning, 2 Review, 3 Relearning), `learningSteps`, `lastReview`, `lastAttemptKind` (question | recall), `lastQuestionId?`. Yalnız scheduler adaptörü yazar (A15).
```json
{ "atomId": "atm-tanzimat-yil", "due": "2026-09-10T10:12:03.120Z", "stability": 3.1, "difficulty": 5.4,
  "reps": 3, "lapses": 0, "state": 2, "learningSteps": 0, "lastReview": "2026-09-07T10:12:03.120Z",
  "lastAttemptKind": "question", "lastQuestionId": "q-1" }
```

### 6.3 DailyQueueItem
`{ atomId, reason: due | new, retrievability: number | null }` — `03_DAILY_QUEUE_ENGINE.md`.

### 6.4 LearningAction
`{ kind: "question", questionId, questionVersion, actionId }` veya `{ kind: "recall", atomId, actionId }`. `questionVersion` sunum anında sabitlenir (§4.2a); `actionId` kayıt kimliğinin kaynağıdır (§4.1).

### 6.5 Coverage (v0 dışı)
Atom başına `(operation, support) → { attempts, successes, lastAt }`. Attempt'lar üstünde projeksiyon; ayrı ham tablo değildir. v0'da hesaplanmaz; veri (operation, support) bugünden toplanır.

## 7. Snapshot kuralı özeti (A6, A9)

Attempt'a kopyalanan alanlar: `primaryAtomIdAtAttempt`, `questionVersion`, `correct`, `selectedOptionId`, `initialSelectedOptionId`. Projeksiyonlar içerik semantiğini **her zaman Attempt'taki snapshot'tan** okur, güncel Question/Atom kaydından değil; sorunun tam içeriği gerektiğinde `QuestionRevision(questionId, questionVersion)` okunur. Bu sayede REBUILD içerik düzenlemelerinden etkilenmez ve geçmiş cevaplar eski soruyla birlikte görüntülenebilir.

## 8. Platform sınırı (özet)
Domain ve motor yalnız `Repository` ve `PlatformServices` **arayüzlerine** bağımlıdır; gerçekleştirimler (Dexie, tarayıcı dosya API'si, ileride Capacitor eklentileri) altyapı katmanındadır ve bu arayüzleri uygular. Bağımlılık yönü: UI/PWA/native kabuk → uygulama → motor/domain; altyapı → arayüzler. Motor hiçbir zaman PWA veya Capacitor'ı import etmez. Ayrıntı `06` §11.
