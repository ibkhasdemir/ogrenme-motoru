# 08_TEST_PLAN.md — Test Planı

Referans: tüm spec dosyaları. Her test, ilgili anayasa maddesi ve spec bölümünü referanslar. Test-first: faz kodu yazılmadan önce ilgili testler yazılır (`09_IMPLEMENTATION_PLAN.md`).

Revizyon 2: ilk çalışan gerçekleştirimde bulunan gerçek hataları doğrudan yakalayan sınıflar eklendi — U-QR (soru sürümü), I-QA (QuestionAtom tutarlılığı), U-DS (dinamik oturum), B (yedek/kurtarma), A (mimari/platform), V (görsel, el ile), M-UP (PWA güncelleme). Test sayısı yaklaşık 130.

**Test hilesi yasağı (`11` kural):** spec'e uymayan gerçekleştirimi korumak için test gevşetilmez; testi geçirmek için ham veri silinmez/sıfırlanmaz; kullanıcı verisi test fixture'ı değildir.

## 0. Altyapı

- **Birim / entegrasyon:** Node ortamında test koşucusu; depo için bellek içi Repository; IndexedDB için `fake-indexeddb`.
- **Uçtan uca:** jsdom + `fake-indexeddb` ile gerçek UI modülünü yükleyip DOM üzerinden dokunma; ayrıca telefon üzerinde el ile kontrol listesi (§5).
- **Saat:** tüm motor testleri enjekte edilen `now()` kullanır; gerçek saat yasak.
- **Kimlik:** enjekte edilen deterministik `newId()` (`id-1`, `id-2`, …).
- **Yardımcı:** `serializeMemory(memory)` = atomId'ye göre sıralı JSON; determinizm karşılaştırmaları bununla yapılır.
- **Sabitler:** MIN = 60 000 ms, DAY = 86 400 000 ms. Fixture: 1 subject, 1 topic, 1 atom (facet date), 1 soru (3 seçenek, doğru = ilk).

### 0.1 Kabul testi kimlikleri (T1–T20)
Aşağıdaki U/I/E/M testleri bu kabul testlerini gerçekler; her satırın en az bir otomatik veya el ile testi vardır.

| T | Kabul kriteri | Gerçekleyen testler |
|---|---|---|
| T1 | Açılışta gösterilecek iş varsa kullanıcı ders/konu/mod seçmez; Başla'ya en fazla tek dokunuşla ilk öğeye gider | E-01 |
| T2 | Doğru+emin → due ileri; yanlış → Again → due scheduler'dan; kodda elle vade yok | I-01, I-02, U-SC-08 |
| T3 | Doğru+salladım → Again; atom yetim kalmaz | U-EP-03, I-03 |
| T4 | primaryAtom değişince eski Attempt eski atomu gösterir | U-RB-07, I-08 |
| T5 | Aynı girdi → iki REBUILD bayt bayt aynı; anlık yol = REBUILD | U-RB-01, U-RB-02 |
| T6 | Policy/config değişince MemoryState değişir, ham olaylar değişmez | U-RB-10, U-RB-11 |
| T7 | Pretest ReviewEvent üretmez | U-EP-07, U-RB-06 |
| T8 | Uçak modunda tam döngü | M-01 |
| T9 | Soru girişi 5 zorunlu alanla kaydeder | E-08, I-16 |
| T10 | Yedek → sil → geri yükle → REBUILD eşleşir | B-01 (I-06'nın yerini aldı), E-10, E-11 |
| T11 | Sorusuz atom hatırlama kartı; öz değerlendirme FSRS'yi günceller | U-RS-01, I-12 |
| T12 | Geri al → AttemptVoid; Attempt silinmez; REBUILD'de etkisi yok | U-RB-04, I-07 |
| T13 | Aynı timestamp → sequence sırası, deterministik | U-RB-03 |
| T14 | Görünür sete alınmayan vadeli atomun due'su değişmez | U-DQ-05 |
| T15 | Mikro mod süre dolunca yeni öğe getirmez; aynı kuyruk | E-09 |
| T16 | Hafıza durumu olmayan atoma yakalama Attempt yazmaz | M2'de (v0 dışı) |
| T17 | Hafıza durumu olan atoma "Hatırlayamadım" → external/Again, timestamp yakalama anı | M2'de (v0 dışı) |
| T18 | External Again sonrası görünür sete tavan; due değişmez | M2'de (v0 dışı) |
| T19 | Her Attempt operation/support taşır; kullanıcı girişi yok | I-11 |
| T20 | Aynı atom art arda aynı sunumla gelmez (soru ↔ kart) | U-RS-02 |

Kod incelemesi kriterleri (otomatik değil, PR kontrol listesi): `due =` ataması yalnız scheduler adaptöründe; depo katmanında Attempt/Void/QuestionRevision için update/delete yok; ts-fsrs import'u yalnız adaptörde; `package.json`'da `"ts-fsrs": "5.4.2"` (`^`/`~` yok); service worker'da IndexedDB/`indexedDB.deleteDatabase` çağrısı yok; önbellek adı build sürümü içeriyor; bileşenlerde ham hex yok (token kullanımı); domain/engine dizinlerinde tarayıcı/Dexie import'u yok (A-01, A-02 ile otomatik).

## 1. Birim testleri — EvidencePolicy (`02` §1)

| ID | Senaryo | Girdi | Beklenen |
|---|---|---|---|
| U-EP-01 | yanlış + emin | question, correct=false, sure | 1 |
| U-EP-02 | yanlış + salladım | question, correct=false, guess | 1 |
| U-EP-03 | doğru + salladım (T3 çekirdeği) | question, correct=true, guess | 1 |
| U-EP-04 | doğru + tereddüt | question, correct=true, unsure | 2 |
| U-EP-05 | doğru + emin | question, correct=true, sure | 3 |
| U-EP-06 | recall again/hard/good | recall, selfAssessment | 1 / 2 / 3 |
| U-EP-07 | pretest (T7) | mode=pretest, her kombinasyon | null |
| U-EP-08 | Easy asla | tüm kombinasyonlar | ≠ 4 |
| U-EP-09 | bilinmeyen policyVersion | policyVersion=99 | hata fırlatır |
| U-EP-10 | wrongReason notu etkilemez | correct=false, her wrongReason | 1 |

## 2. Birim testleri — Scheduler adaptörü (`02` §3–4)

| ID | Senaryo | Beklenen |
|---|---|---|
| U-SC-01 | config pin | `SchedulerConfig.engineVersion` === `node_modules/ts-fsrs/package.json`.version (test kütüphane sürümünü okur) |
| U-SC-02 | fuzz kapalı | aynı state + aynı reviewedAt + aynı rating → 100 çağrıda aynı `due` |
| U-SC-03 | emptyState | state=0, reps=0, retrievability sonlu (0 kabul) |
| U-SC-04 | New + Good (pinli sözleşme, `02` §3.1a) | state=1 (Learning), learning_steps=1, due ≈ +10 dk; değer motor tarafından değil `scheduler.next` tarafından yazılır |
| U-SC-05 | New + Again (pinli sözleşme) | state=1, learning_steps=0, due ≈ +1 dk |
| U-SC-12 | New + Hard (pinli sözleşme) | state=1, learning_steps=0, due ≈ +6 dk ((1+10)/2 yuvarlama) |
| U-SC-13a | Learning çıkışı, `Good→Good` (tam dizi, her cevap kendi vadesinde) | 2. Good sonrası state=2 (Review), due = now + **2 gün** (pinli çıktı) |
| U-SC-13b | Learning çıkışı, `Again→Good→Good` | 3. cevap sonrası state=2, due = now + **tam 1 gün**; `Hard→Good→Good` de 1 gün |
| U-SC-13c | genel değişmez | her iki dizide Review'a geçer, due ileri gider, değer `scheduler.next` çıktısıyla birebir; motor aralığa gün eklemez (statik tarama: engine'de gün/dakika sabiti yok) |
| U-SC-15 | gün içi R eşitliği | pinli `get_retrievability` ilk 24 saatte R=1; kuyruk ikinci anahtar olarak due ASC kullanır (U-DQ-02 ile) |
| U-SC-14 | motor due hesaplamaz | `src/engine/**` içinde `learning_steps`/dakika sabitleriyle due üreten kod yok (statik tarama); tek `due =` ataması adaptörde |
| U-SC-06 | Learning + Again lapse saymaz | lapses = 0 (kütüphane davranışı, `02` §3.1) |
| U-SC-07 | Review + Again lapse sayar | önce Review'a çıkar (iki Good, günler arayla), sonra Again → lapses=1, state=3, due ≈ +10 dk |
| U-SC-08 | Good due ileri (T2) | Review durumundaki kart + Good → state=2 kalır, due > reviewedAt (ileri gider) ve değer pinli `scheduler.next` çıktısıyla birebir; sabit gün eşiği yok (Relearning'den çıkan kartlarda 1 gün görülür) |
| U-SC-09 | retrievability düşer | aynı state, now+1g vs now+30g → R azalır |
| U-SC-10 | maximumInterval | çok yüksek stability → due ≤ now + 365 gün |
| U-SC-11 | `w` null → resolvedWeights | export'ta 21 (FSRS-6) elemanlı sayı listesi |

## 3. Birim testleri — REBUILD (`02` §5)

| ID | Senaryo | Beklenen |
|---|---|---|
| U-RB-01 | determinizm (T5) | 6 attempt (karışık sonuç, aralıklı zaman); `rebuild` iki kez → `serializeMemory` eşit |
| U-RB-02 | anlık yol = REBUILD (T5) | aynı attempt'lar `applyAttempt` ile sırayla uygulanır; `rebuild` sonucu ile eşit |
| U-RB-03 | sequence sırası, timestamp değil (T13) | aynı timestamp'li 2 attempt (Again, Good); girdi listesi ters verilir → sonuç aynı; reviewEvents rating sırası [1,3] |
| U-RB-04 | void filtre (T12) | 1 attempt + void → memory boş, reviewEvents boş |
| U-RB-05 | çift void | aynı hedefe 2 void → tek kez etkili |
| U-RB-06 | pretest atlanır (T7) | pretest attempt → reviewEvents boş, memory boş |
| U-RB-07 | snapshot atomu (T4) | attempt.primaryAtomIdAtAttempt=A, güncel Question.primaryAtomId=B → memory[A] var, memory[B] yok |
| U-RB-08 | içerik tablosuz çalışır | `rebuild(attempts, voids, policy, config)` içerik parametresi almadan çalışır |
| U-RB-09 | monoton kırpma | timestamp geriye giden 2. attempt → reviewedAt = 1. attempt'ın lastReview'u; hata yok |
| U-RB-10 | policy değişimi (T6) | aynı attempt'lar, policyVersion 1 vs (test amaçlı sahte) 2 → memory farklı; attempts JSON'u değişmemiş |
| U-RB-11 | config değişimi (T6) | requestRetention 0.9 vs 0.8 → memory farklı; attempts değişmemiş |
| U-RB-12 | lastAttemptKind | son attempt recall → memory.lastAttemptKind = recall |

## 4. Birim testleri — DailyQueue ve Resolver (`03`)

| ID | Senaryo | Beklenen |
|---|---|---|
| U-DQ-01 | vadeli önce, düşük R önce | 2 vadeli atom, biri zayıf → zayıf ilk |
| U-DQ-02 | R eşitliği | aynı R'li iki atom → önce `due` ASC (en eski vade), sonra atomId ASC |
| U-DQ-03 | due = now | vadeli |
| U-DQ-04 | reviewCap = günlük benzersiz tavan | 5 vadeli, cap 2, bugün tekrar yok → `buildQueue` 2 döner; `selectNext` ilkini döner |
| U-DQ-04b | tavan bugün başlamış atomu engellemez | cap 2, bugün 2 atom tekrar edilmiş, biri yeniden vadeli → `selectNext` onu döner; üçüncü yeni vadeli gelmez |
| U-DQ-05 | tavan due'yu değiştirmez (T14) | U-DQ-04/04b sonrası tüm `due` değerleri aynı |
| U-DQ-06 | yeni sıra | sortOrder 3,1,2 → 1,2,3 sırayla; subject/topic sortOrder öncelikli |
| U-DQ-07 | newPerDay | 5 yeni, newPerDay 2, bugün başlatılan 0 → 2; 2 → 0 (Attempt geçmişinden sayılır) |
| U-DQ-11 | selectNext = buildQueue[0] | aynı girdiyle `selectNext` sonucu `buildQueue`'nun ilk öğesidir; ikisi aynı `eligibleDue`/`eligibleNew` yardımcılarını çağırır (kod incelemesi) |
| U-DQ-13 | karşı örnek: continuation öncelik almaz | A bugün çalışılmış, yeniden vadeli, R=0.90; B eski backlog, R=0.20; kota var → `selectNext` = B ve `buildQueue[0]` = B; A listede ikinci; A kotadan kesilmemiş |
| U-DQ-14 | negatif kota yok | bugün 8 yeni başlatıldı, `newPerDay` 5'e indirildi → kalan yeni 0; Bugün ekranı "0 yeni"; `reviewCap` benzer; ayarlar negatif/sonsuz değeri reddeder |
| U-DQ-15 | gece yarısı continuation | 23:59 New+Again (due 00:00), saat 00:09 → `startedToday` boş; atom `state = Learning` olduğu için `reviewCap = 0`'da bile uygun |
| U-DQ-16 | prompt'suz atom kuyruğa girmez | `prompt` boş (migrate edilmiş) atom → `eligibleNew`/`eligibleDue` dışı; prompt doldurulunca girer |
| U-DQ-12 | yeni yalnız vadeli yokken | 1 vadeli + 3 yeni → `selectNext` vadeli; vadeli cevaplanıp vadesi ileri gidince → yeni |
| U-DQ-08 | pretest yeni sayacına girmez | pretest attempt'lı atom hâlâ `new` olarak gelir |
| U-DQ-09 | arşivli atom | archived=true → kuyrukta yok, memory korunur |
| U-DQ-10 | saf fonksiyon | iki çağrı aynı dizi |
| U-RS-01 | sorusuz atom → kart (T11) | `{kind: recall}` |
| U-RS-02 | dönüşüm (T20) | soru → (attempt question) → kart → (attempt recall) → soru |
| U-RS-03 | en eski soru | 3 soru, biri hiç çözülmemiş → o; sonra en küçük `lastTrySequence`; eşitlikte questionId ASC |
| U-RS-07 | arşivli soru aday değil | atomun tek sorusu arşivlendi → `resolve` kart; arşivli sorunun Attempt geçmişi ve sürümleri duruyor; arşivi kaldırınca yeniden aday |
| U-RS-08 | sunulan sürüm sabit | v1 sunulur (action.questionVersion = 1); sunum sırasında soru v2 olur (doğru seçenek değişir); cevap → Attempt.questionVersion = 1, `correct` v1'e göre, `primaryAtomIdAtAttempt` v1'in atomu; undo tekrarı da v1 |
| U-RS-04 | primaryAtom taşındı | sorunun bağı B'ye geçti → A için kart, B için soru |
| U-RS-05 | Resolver yazmaz | çağrı sonrası depo ve memory değişmemiş |
| U-RS-06 | yakınlık sequence ile | 3 soru; cihaz saati geriye alınarak (timestamp'ler azalan) attempt'lar yazılır → rotasyon `sequence`'a göre doğru devam eder; timestamp'e göre sıralansaydı bozulurdu |

## 5. Entegrasyon testleri — Motor + depo

| ID | Senaryo | Beklenen |
|---|---|---|
| I-01 | Good due ileri (T2) | doğru+emin → memory.due > now |
| I-02 | Again zamanlaması (T2) | yanlış → due − now ∈ (0, 15 dk]; kodda elle vade yok (kod incelemesi) |
| I-03 | guess davranışı (T3) | doğru+salladım → reviewEvent rating 1; memory var (yetim değil) |
| I-04 | mode (A11) | ilk attempt `new`, ikinci `review`; pretest `pretest` |
| I-05 | immutable Attempt (A3) | aynı id ikinci `appendAttempt` reddedilir; döndürülen nesne dondurulmuş; depo API'sinde update/delete yok |
| I-06 | yedek/geri yükleme/REBUILD round trip (T10, `06` §10) | 3 attempt + 1 void → yedek JSON → boş depo → güvenli geri yükleme → `serializeMemory` eşit; attempts/voids eşit; bir sonraki `sequence` = max+1. Tam kırmızı çizgi B-01'dedir; I-06 onun motor düzeyindeki çekirdeğidir |
| I-07 | AttemptVoid (T12) | `undo(targetAttemptId)` → void yazılır, attempt kalır, memory eski hâline döner; aynı hedefe ikinci istek `null` (önceki kayda düşme yok) |
| I-22 | saat tutarsızlığı | cihaz saati +30 gün → cevap → saat düzeltilir → Bugün'de uyarı ve N ileri tarihli kayıt; "geçersiz kıl" → `AttemptVoid reason: clock_skew`; REBUILD sonrası atom vadesi gerçek zamana döner; sessiz düzeltme yok |
| U-UN-01 | soru undo → exact tekrar | soru cevabı → geri al → sunulan action aynı questionId ve void edilen Attempt'ın questionVersion'ı; selectNext çağrılmamış |
| U-UN-02 | recall undo → exact tekrar | kart öz değerlendirmesi → geri al → aynı atomun hatırlama kartı yeniden sunulur |
| U-UN-03 | düzeltme tekrarı önce gelir | başka bir vadeli atomun R'si daha düşükken geri al → yine aynı action sunulur; sonraki cevaptan sonra `selectNext` normal (düşük R atom gelir) |
| U-UN-04 | tekrar due yazmaz | geri al ve tekrar sunum sonrası tüm `MemoryState.due` değerleri REBUILD sonucuyla aynı; tekrar cevap verilince normal Attempt/`scheduler.next` |
| U-UN-05 | tekrar durumu persist edilmez | geri al → tekrar sunumundan çık (uygulama yeniden başlatılır) → `pendingReplay` yok; normal `selectNext` güvenli devam eder; void ve REBUILD kalıcı |
| U-UN-06 | geri al penceresi ve tek kullanım | kayıttan 31 sn sonra geri al → reddedilir (void yok); aynı action için ikinci geri al → reddedilir |
| U-UN-07 | tekrar bağı | tekrar sunumdan doğan Attempt `replayOfAttemptId` = void edilen Attempt id; normal Attempt'ta alan yok; REBUILD'de her ikisi doğru işlenir |
| U-UN-08 | undo hedefi sabit | A sonra B cevaplanır; B'nin token'ıyla iki `undo(B)` isteği → yalnız B void, ikinci istek null; A'ya düşülmez; yanlış cevapta neden → S5 → geri al da aynı token mantığıyla çalışır |
| I-08 | atom semantik sürüm (A9/A10, T4) | soru primaryAtom'u değiştirilince yeni revision (v+1); eski attempt eski atomu taşır; REBUILD her iki atomu doğru kurar |
| I-09 | soru sürümü snapshot | attempt.questionVersion = **sunulan** sürüm (LearningAction.questionVersion); kayıt anındaki currentVersion farklı olsa bile değişmez; sonraki düzenleme etkilemez |
| I-10 | `correct` dondurulmuş | attempt sonrası doğru seçenek değiştirilir (yeni revision) → eski attempt.correct değişmez |
| I-11 | operation/support otomatik (T19) | soru attempt: discriminate/choices; kart çengelli: recall/hook; kart çengelsiz: recall/none |
| I-12 | recall attempt | selfAssessment hard → rating 2; confidence null |
| I-13 | question attempt | initial ≠ selected → changedAnswer true |
| I-14 | IndexedDB kalıcılık | Dexie depo: yaz → yeni motor örneği aç → attempts sequence [1,2]; REBUILD eşit; sayaç devam (3) |
| I-15 | transaction: sayaç + olay | `appendAttempt` içinde sayaç artışı aynı transaction (Dexie transaction içinde iki tablo) |
| I-16 | isteğe bağlı gelişmiş metadata | soru yalnız 5 alanla kaydolur; OptionAtom/secondary boş; sonradan eklenince sürüm artmaz |
| I-17 | migration güvenliği (`06` §6.2) | schemaVersion 1 veritabanı (soru içi version, 2 soru, 3 attempt, biri eski sürüme referanslı) → version 2 açılır; attempts/voids bayt bayt aynı; her soru için currentVersion exact revision'ı var; eksik eski sürüm için `content_unavailable_legacy` revision var, içerik alanları null; REBUILD migration öncesiyle eşit; migration ortada hata fırlatılırsa (simülasyon) DB v1 hâlinde ve okunabilir kalır |
| I-18 | geri yükleme config farkı (`06` §8, `02` §4.1) | pakette requestRetention 0.8, uyumlu scheduler → REBUILD paketin config'iyle; dry-run ile eşit; uyarı döner |
| I-19 | (B sınıfına taşındı) | bkz. B-05…B-09 |
| I-20 | çift dokunma tek Attempt | aynı `actionId` ile `answerQuestion` iki kez (çift tap / yeniden deneme) → tek Attempt; ikinci çağrı reddedilir, sequence tüketilmez |
| I-21 | çoklu bağlam değişiklik algılama | iki motor örneği aynı Dexie DB'de; biri Attempt yazar; diğeri odak kazanınca `meta.sequence` farkını görür → olayları yükler, REBUILD; MemoryState eşit |

## 5a. Birim — Soru sürümü (QuestionRevision) (`01` §2.5–2.8, A9)

| ID | Senaryo | Beklenen |
|---|---|---|
| U-QR-01 | semantik düzenleme yeni sürüm üretir | text değişir → revision v2 yaratılır; v1 fiziksel olarak hâlâ vardır ve içeriği değişmemiştir |
| U-QR-02 | eski attempt eski soruyu çözer | v1'e verilen attempt → `getRevision(questionId, 1)` eski metin/seçenek/doğru/ana atomu verir |
| U-QR-03 | revision üzerine yazılamaz | `appendRevision` aynı (questionId, version) ile ikinci kez → reddedilir; depo API'sinde revision update/delete yok |
| U-QR-04 | seçenek ekleme/çıkarma geçmişi bozmaz | v2'de bir seçenek çıkarılır, bir yenisi eklenir → v1'deki seçenek kümesi aynı; v1'e verilen attempt.selectedOptionId v1 içinde çözülür, v2'de olmaması hata değildir |
| U-QR-05 | metadata değişikliği sürüm üretmez | source/trapType değişir → currentVersion aynı, revision sayısı aynı |
| U-QR-06 | soru oluşturma v1 revision üretir | addQuestion → Question(currentVersion 1) + Revision(v1) + QuestionAtom(primary) |
| U-QR-07 | legacy: current ile aynı sürüm exact kurulur | v1 DB'de soru version=3, attempt questionVersion=3 → migration sonrası Revision(3) `complete`, metin/seçenek/doğru güncel içerikle birebir; ek kayıt yok |
| U-QR-08 | legacy: eski sürüm içeriği bilinmiyor | attempt questionVersion=1, soru version=3 → Revision(1) `content_unavailable_legacy`; text/options/correctOptionId null; `legacyProvenance.fromSchemaVersion = 1`; primaryAtomId yalnız tüm attempt snapshot'ları aynıysa dolu |
| U-QR-09 | sahte geçmiş yok | U-QR-08 sonrası `getRevision(q, 1).text` null; hiçbir API güncel metni v1 metni olarak döndürmez; UI mesajı "eski veri modelinde saklanmadığı için mevcut değil" |
| U-QR-10 | legacy eksik içerik hafızayı bozmaz | U-QR-08 kurulumunda REBUILD migration öncesi ile `serializeMemory` eşit; Attempt sayısı aynı; Attempt'ın `primaryAtomIdAtAttempt` değişmemiş |
| U-QR-12 | legacy sürüm tarihi uydurulmaz | v1 DB'de soru version=3, createdAt 1 Eylül → Revision(3).createdAt = null, `createdAtSource = "unknown"`, `migratedAt` ayrı; Question.createdAt korunur; version=1 soruda Revision(1).createdAt = soru createdAt (kesin); UI "sürüm tarihi bilinmiyor"; REBUILD ve Attempt'lar değişmez |
| U-QR-11 | content_unavailable elle üretilemez | uygulama API'si (`reviseQuestion`, `addQuestion`) `content_unavailable_legacy` revision oluşturamaz; doğrulama içerik dolu legacy kaydı reddeder (B-05b) |

## 5b. Entegrasyon — QuestionAtom tutarlılığı (`01` §2.7, `06` §5)

| ID | Senaryo | Beklenen |
|---|---|---|
| I-QA-01 | primary A→B | düzenleme sonrası Question.primaryAtomId = B; QuestionAtom(primary) = B; Revision(v1).primaryAtomId = A; eski Attempt.primaryAtomIdAtAttempt = A; Revision(v2).primaryAtomId = B |
| I-QA-02 | tek transaction | `reviseQuestion` içinde 3. adımda hata fırlatılır (simülasyon/mocked table) → hiçbir tablo değişmemiş: Question v1'de, revision v2 yok, QuestionAtom = A |
| I-QA-03 | değişmez doğrulaması | rastgele düzenleme dizisi sonrası her Question için `primaryAtomId = currentRevision.primaryAtomId = QuestionAtom(primary).atomId` |
| I-QA-04 | OptionAtom temizliği | v2'de çıkarılan seçeneğe bağlı OptionAtom aynı transaction'da silinir; kalan seçeneklerinki korunur |
| I-QA-05 | Resolver güncel bağ | primary A→B sonrası `resolve(A)` kart, `resolve(B)` soru |
| I-QA-06 | seçenek metni değişince yeni optionId | v2'de bir seçeneğin metni değiştirilir → yeni `optionId`; değişmeyen seçenekler aynı id; v1'de eski id ve eski metin durur |
| I-QA-07 | eski OptionAtom yeni seçeneğe yapışmaz | I-QA-06 sonrası eski optionId'ye bağlı OptionAtom silinmiş; yeni optionId için OptionAtom yok (kullanıcı yeniden onaylayana kadar); korunan seçeneklerin OptionAtom'ları yerinde |
| I-QA-09 | bağlam değişince ilişkiler sıfırlanır | v1 "1839'da ilan edilen?" doğru=Tanzimat, Islahat'ta common_confusion; v2 "1856'da ilan edilen?" doğru=Islahat, seçenek id'leri aynı → v2 sonrası Islahat'ta OptionAtom yok, tüm OptionAtom ve secondary silinmiş; yalnız seçenek sırası değişen revision'da ilişkiler korunur; doğru seçeneğe OptionAtom yazma isteği reddedilir; işlem tek transaction |
| I-QA-10 | cevap anahtarı düzeltmesi (K01) | Attempt v1: seçilen B, anahtar A → correct=false; anahtar B olarak düzeltilir, "hatalıydı" = Evet → etkilenen Attempt'a `AttemptVoid reason: content_error` yazılır, REBUILD sonrası o atomun hafızası o olaysız; ham `correct` değişmemiş; yeni Good üretilmemiş; "Hayır" seçilirse hiçbir void yok ve hafıza aynı |
| I-QA-08 | QuestionAttempt revision'dan kurulur | Question baş kaydında text/options/correctOptionId yokken cevap → `correct` ve `primaryAtomIdAtAttempt` `QuestionRevision(id, currentVersion)`'dan; `content_unavailable_legacy` güncel sürümse sunum reddedilir, Attempt yazılmaz |

## 5c. Birim — Dinamik oturum seçimi (`03` §3.3, §6)

| ID | Senaryo | Beklenen |
|---|---|---|
| U-DS-01 | Again sonrası bekletme yok | 20 vadeli atom; ilk öğe Again → due ≈ +1 dk; saat 1 dk ilerletilir; bir sonraki `selectNext` o atomu (R en düşükse) döndürür; 19 öğenin bitmesini beklemez |
| U-DS-02 | vadesi gelmemiş atom erken gelmez | aynı kurulum, saat ilerletilmez → `selectNext` o atomu döndürmez |
| U-DS-03 | dinamik seçim reviewCap'i delmez | cap 3; oturumda 30 kez `selectNext` çağrılır ve cevaplanır → gün içinde tekrarına başlanan distinct atom ≤ 3; öğrenme adımıyla geri gelenler sayıma girmez |
| U-DS-04 | dinamik seçim newPerDay'i delmez | newPerDay 2; vadeli yokken 10 çağrı → başlatılan distinct yeni atom ≤ 2 |
| U-DS-05 | queue due yazmaz | 50 `selectNext` çağrısı → tüm `MemoryState.due` değişmemiş |
| U-DS-06 | void sonrası yeniden sunum | ilk deneme Again → void → `selectNext` atomu `new` olarak döndürür |
| U-DS-07 | bütçe kontrolü öğe başında | budget 3 dk; 2:50'de öğe başlar, 3:20'de biter → sonraki `nextItem` "budget" ile biter |
| U-DS-08 | oturum snapshot yok | oturum sırasında yeni atom eklenir ve vadeli kalmaz → `selectNext` yeni eklenen atomu (sortOrder uygunsa) döndürür |
| U-DS-09 | continuation tavanla kesilmez | reviewCap tamamen dolu (quota = cap); bugün `new` başlatılan atom New+Again → due ≈ +1 dk; saat due'ya ilerletilir → atom eligible ve `selectNext` onu döndürür; `quota` boyutu artmamış |
| U-DS-10 | reviewCap = 0 | bugün new başlamış atomun learning continuation'ı due olduğunda gelir; eski backlog'dan hiçbir atom gelmez |
| U-DS-12 | bütçe monoton saat | 3 dk oturum; duvar saati ±1 saat oynatılır → bütçe değişmez; uygulama gizliyken sayaç durur |
| U-DS-11 | reviewQuotaAtoms doğru sayılır | bugün new başlayan atomun aynı gün mode=review Attempt'ı `quota`'ya girmez; yalnız eski backlog atomları sayılır; `buildQueue` = (continuation ∪ kalan kota kadar en düşük R backlog) tek `(R, atomId)` sırasıyla ++ yeni |

## 5d. Entegrasyon — Yedek ve kurtarma (`06` §7–§10, `13`)

| ID | Senaryo | Beklenen |
|---|---|---|
| B-01 | kırmızı çizgi round-trip | yedek → ana DB sil → geri yükle → REBUILD: içerik+revision'lar eşit; ham olaylar kanonik JSON eşit; void'ler eşit; config eşit; `serializeMemory` eşit; `nextSequence` aynı |
| B-02 | aynı saniyede iki yedek | sahte saat aynı saniyede iki yedek alır → farklı dosya adı (SSS + backupId ilk 8) ve farklı backupId |
| B-03 | checksum: olay baytı bozuk | `events` içinde bir bayt değiştirilir → red; ana DB `snapshotAll()` çıktısı bayt-eşdeğer kalır |
| B-03b | checksum: başlık bozuk | yalnız `schemaVersion` veya `backupFormatVersion` değiştirilir (gövde aynı) → red; DB değişmez |
| B-04 | duplicate sequence | iki attempt aynı sequence → red; DB değişmez |
| B-05 | eksik QuestionRevision | attempt (q-1, v2) var, revision yok → red |
| B-05b | sahte legacy revision | `content_unavailable_legacy` revision'ında text/options dolu veya `legacyProvenance` yok → red; `complete` revision'ında content null → red |
| B-05c | legacy primaryAtomId null geçerli | `content_unavailable_legacy` revision'ında `primaryAtomId = null` → geri yükleme **kabul**; null değil ve Atom'a çözülmüyorsa → red; `complete` revision'ında null → red |
| B-06 | bilinmeyen void hedefi | → red (tam yedekte uyarı değil) |
| B-07 | correctOptionId seçeneklerde yok | → red |
| B-08 | kopuk ebeveyn referansı | Atom.topicId çözülmüyor → red |
| B-09 | duplicate attempt id | → red |
| B-10 | dry-run REBUILD başarısız | scheduler `next` mock'la hata fırlatır → red; DB değişmez |
| B-11 | pre_restore noktası oluşur | başarılı geri yükleme öncesi recovery store'da reason=pre_restore kayıt; payload eski durumun tam yedeği |
| B-12 | pre_restore yazılamazsa durur | recovery store kota hatası (mock) → geri yükleme başlamaz; DB değişmez |
| B-13 | commit sonrası hata → geri dönüş | replaceAll başarılı, REBUILD adımında hata (mock) → journal'daki pin'li pre_restore noktasından otomatik geri dönüş; DB eski duruma bayt-eşdeğer; journal `rolled_back` |
| B-14 | kurtarma noktasından dönüşte yeni nokta | noktaya dönmeden önce mevcut durumdan yeni pre_restore noktası oluşur; hedef nokta ve yeni ön nokta iş boyunca pin'li kalır; iş bitince retention uygulanır |
| B-15 | rolling retention | 6 manuel nokta → en eskisi silinir, 5 kalır; 8 daily → 7 kalır; toplam ≤ 12 |
| B-16 | format 1 yedeği geri yüklenir | format 1 (soru içi sürüm, checksum yok) → bellekte migrate → exact revision'lar + eksik sürümler için `content_unavailable_legacy` → doğrulama → başarılı geri yükleme; güncel metin eski sürüme kopyalanmamış (U-QR-09 ile aynı iddia) |
| B-17 | ileri format reddedilir | backupFormatVersion 99 → hata; DB değişmez |
| B-18 | config paketten uygulanır | I-18 ile aynı; ayrıca `schedulerConfigHistory` paketinki korunur |
| B-19 | scheduler uyumsuz yedek (normalize) | pakette engineVersion "9.9.9" → normalizedSnapshot: aktif schedulerConfig = kurulu güncel config (configVersion + resolvedWeights doğru); paketin config'i `schedulerConfigHistory`'de arşivli + `scheduler_migration` satırı; ham/içerik kayıpsız; REBUILD aktif config ile; **uygulama kapatılıp yeniden açılır (re-init)** → DB'den okunan aktif config hâlâ kurulu güncel config, eski uyumsuz config aktif değil; ikinci REBUILD aynı aktif config ile `serializeMemory` deterministik eşit; kullanıcıya uyarı |
| B-20 | replaceAll recovery'ye dokunmaz | ana DB replaceAll sonrası recovery store kayıt sayısı aynı |
| B-21 | yedek hatırlatma eşiği | lastExternalBackupSequence'tan beri 250 olay → uyarı true; 249 → false; 7 gün → true; kurtarma noktası yazmak sayacı sıfırlamaz |
| B-22 | yedek formatı depodan bağımsız | MemoryRepository ile alınan yedek DexieRepository'ye ve tersi geri yüklenir; B-01 eşitliği |
| B-23 | derived okunmaz | pakette sahte `derived` → geri yükleme sonrası MemoryState REBUILD'den gelir, paketteki sahte değerden değil |
| B-24 | sıfırlama öncesi nokta | "Tüm veriyi sıfırla" → önce pre_reset noktası; sıfırlama sonrası noktadan dönüş veriyi geri getirir |
| B-25 | kanonik sıra depodan bağımsız | aynı veriyi farklı kayıt sırasıyla döndüren iki depo (mock) → kanonik JSON ve checksum aynı; B-01 eşitliği |
| B-25b | geçmiş kayıtları sıralama | eşit configVersion'lı iki `config_snapshot` (farklı `at`/içerik), eşit `at`'li iki `scheduler_migration`, ters depo sırası → aynı kanonik JSON; sıralama kod noktası düzeni, locale bağımsız |
| B-26 | migration kurtarma kuralı | pre_migration alınamayan simülasyonda migration transaction'ı geri alınır, DB v1 okunabilir; başarılı migration sonrası ilk açılışta post_migration noktası zorunlu olarak var |
| B-29 | dry-run = commit sonrası (her durumda) | uyumsuz scheduler'lı yedek normalize edilir; commit sonrası bir ham kaydı sayıyı koruyarak değiştiren hata enjekte edilir (mock) → doğrulama kanonik JSON farkını yakalar, acil geri dönüş başlar; hatasız yolda `serializeMemory(post) === serializeMemory(dryRun)` |
| B-30 | bilinmeyen alan korunur | geçerli Attempt'a ek `x_note` alanı + doğru hash → geri yükleme kabul; export'ta alan aynen; bilinmeyen `schedulerConfig.configVersion` → red |
| B-31 | checksum migration'dan önce | (gelecek format-3 okuyucusu simülasyonu) geçerli hash'li format-2 → çevrilir ve kabul; olay içeriği hash değiştirilmeden bozulmuş format-2 → migration çağrılmadan red |
| B-32 | acil geri dönüş yeni nokta istemez | ön nokta yazıldı → commit → doğrulama hatası → RecoveryStore tüm yazmalarda kota hatası (mock) → mevcut pin'li noktadan geri dönüş yine denenir ve başarır; ikinci başarısızlıkta kurtarma ekranı; çağrı sayısı = 1 |
| B-33 | journal ile çökme çözümü | üç kesme noktası: ön noktadan sonra / commit'ten hemen sonra / doğrulamadan önce → yeniden açılışta ya doğrulanmış yeni durum ya eski durum; `meta.appliedJobId` ile journal tutarlı; yarım iş tamamlanmış sayılmaz |
| B-34 | pin'li retention | 5 nokta varken en eskisine (p1) dön → p1 ve yeni pre_restore iş boyunca mevcut; budanan p2; iş bitince pinler kalkar |
| B-35 | format/şema matrisi | format 2 + schemaVersion 99, hash doğru (yeniden hesaplanmış fixture) → red; format 1 + şema 1 → migrate ve kabul |
| B-36 | sayaç ve meta nesli | aktif sayaç 1000, yedek max 100 → geri yükleme sonrası sayaç 100, `generationId` yeni; `lastExternalBackup*` null; hatırlatma farkı asla negatif değil; yerel noktaya dönüş dış yedek sayılmaz; hiç yedek yokken 250 olay → hatırlatma |
| B-37 | kurtarma okuyucusu | migration hatası simülasyonu → RecoveryReader şema tanımsız açar, DB sürümü/içeriği değişmez; eski şemadan normal yedek; daha yeni şemadan `recovery_dump`; normal geri yükleme dump'ı reddeder |
| B-38 | yedek kaydetme sonucu | `initiated` → işaretçi güncellenmez, teyitle güncellenir; `saved` → güncellenir; `cancelled`/`failed` → değişmez; işaretçi snapshot sequence'ına bağlı |
| B-27 | semantik doğrulama | revision içinde tekrarlı option id / Attempt.correct revision ile çelişkili / selectedOptionId revision'da yok / mükerrer void hedefi / negatif responseTimeMs / bilinmeyen replayOfAttemptId → her biri red; DB değişmez |
| B-28 | retention sınıfları | 3 pre_restore + 2 manual + 2 post_migration + 9 daily yazılır → işlem sınıfı 5, daily 7, toplam 12; her reason tam bir sınıfta |

## 5e. Mimari / platform kontrolleri (`00` A22, `06` §2, §11)

| ID | Senaryo | Beklenen |
|---|---|---|
| A-01 | domain/engine DOM import etmez | statik tarama: `src/domain/**`, `src/engine/**` içinde `window`, `document`, `navigator`, `localStorage`, `indexedDB`, `location`, `fetch` tanımlayıcıları ve DOM tipleri yok (test, dosyaları okuyup regex ile denetler) |
| A-02 | engine Dexie import etmez | `src/engine/**` ve `src/domain/**` içinde `from 'dexie'` yok; ts-fsrs yalnız scheduler adaptöründe |
| A-03 | motor bellek içi depoyla çalışır | tüm U/I motor testleri MemoryRepository ile geçer; Dexie yalnız I-14/I-15/I-17 ve B testlerinde |
| A-04 | PlatformServices mock'lanabilir | HashService ve BackupFileService sahteleriyle yedek alma/geri yükleme motor testleri çalışır |
| A-05 | yedek formatı platformdan bağımsız | B-22 + `platform` alanı davranışı etkilemez |
| A-06 | çekirdek paket sınırı | `src/engine` ve `src/domain` yalnız birbirini, `src/store/repository` arayüzünü ve PlatformServices arayüzlerini import eder; **tek istisna** scheduler adaptörü modülünün `ts-fsrs` import'u (A-02 ile tutarlı); başka üçüncü taraf/DOM import'u yok (import grafiği testi) |
| A-07 (gelecek, el ile) | Capacitor kabuğu | aynı çekirdek paketi değiştirilmeden Capacitor iOS ve Android kabuğunda başlatılabilmelidir; v0'da yapılmaz, kabul kriteri olarak kayıtlıdır |

## 6. Uçtan uca (jsdom) — UI akışı (`07`)

| ID | Senaryo | Beklenen |
|---|---|---|
| E-01 | T1 | veri yüklü açılış → "Başla" görünür; tek dokunuşla ilk öğe ekranda; ders/konu/mod seçimi sorulmaz |
| E-02 | yeni atom akışı | Başla → Oku → "Okudum" → soru/kart |
| E-03 | soru akışı | seçenek → Cevapla → Güven (doğru cevap görünmüyor) → Sonuç |
| E-04 | yanlış → neden | Yanlış. → dört çip (cevap gizli); çip → sonuç ekranı (cevap açık) → Devam → sonraki öğe |
| E-05 | doğru → devam | Doğru. → Devam → sonraki öğe |
| E-06 | geri al | Sonuç → Geri al (30 sn içinde) → aynı soru (aynı sürüm) bir kez yeniden sunulur; deneme sayısı aynı, geri alma +1; kart akışında öz değerlendirme sonrası kısa ömürlü "Geri al" görünür ve aynı kartı yeniden sunar; 30 sn sonra düğme yok |
| E-19 | yanlışta önce neden, sonra cevap | yanlış seçenek → güven → "Yanlış." + dört çip; doğru seçenek işaretli DEĞİL, atom açıklaması YOK; çip → Attempt diske → doğru seçenek ve açıklama görünür → Devam |
| E-20 | soru yüzü zorunlu | Atom ekle: prompt boş → hata metni; dolu → kaydedilir; İçerik'te prompt'suz (migrate) atom "soru yüzü eksik" etiketiyle |
| E-21 | yedek kaydetme mesajları | `saved` → "Yedek alındı"; `initiated` → "İndirme başlatıldı… doğrula" + Kaydettim; iptal → mesaj yok, işaretçi değişmez; geri yükleme sonrası "Yedek durumu bilinmiyor" |
| E-07 | kart akışı | Çengeli göster → Cevabı aç → Hatırladım → sonraki |
| E-08 | soru girişi (T9) | 4 alanla Kaydet → hata metni; 5 alanla → kaydedildi |
| E-09 | mikro mod aynı seçim (T15) | 3 dk seç; saat ilerletilir → aktif öğe biter, yenisi gelmez, "Süre doldu" |
| E-10 | yedek dosyası | Yedek al → indirme adı `ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS-<backupId8>.json`; "Yedek alındı." |
| E-11 | geri yükleme akışı | dosya seç → "Doğrulanıyor" → özet → "Bu yedeğe geri dön" → "Doğrulandı: …" |
| E-12 | Veri ekranı | dört bölüm ve sürüm satırı (5.4.2, fuzz kapalı, şema 2) görünür |
| E-13 | bozuk yedek mesajı | bozuk dosya → "Yedek doğrulanamadı. Mevcut verine dokunulmadı." ve sayılar değişmez |
| E-14 | kurtarma noktası listesi | pre_restore sonrası listede tarih · neden · sayılar; "Bu noktaya dön" akışı |
| E-15 | soru sürüm geçmişi | İçerik → soru → düzenle → uyarı metni; sürüm geçmişinde v1 ve v2 tam içerik |
| E-16 | oturum içinde yeniden gelen atom | Again → saat 1 dk ileri → Devam → aynı atom yeniden sunulur (eski liste beklenmez) |
| E-17 | legacy sürüm mesajı | migrate edilmiş veride İçerik → soru → sürüm geçmişi → eski sürüm satırı "…eski veri modelinde saklanmadığı için mevcut değil"; güncel metin o satırda yok |
| E-18 | güncelleme çubuğu yeri | bekleyen SW varken Bugün'de "Yeni sürüm hazır · Yenile" görünür; çalışma ekranlarında (S2–S8) görünmez; Yenile'ye basmadan sayfa kendiliğinden yenilenmez |

## 7. El ile kontrol listesi (telefon)

| ID | Adım | Beklenen |
|---|---|---|
| M-01 (T8) | Uygulamayı bir kez aç, uçak modu, kapat-aç, tam döngü | çalışır; veri kalır |
| M-02 | Ana ekrana ekle | standalone açılır, ikon doğru |
| M-03 | Cevap sonrası uygulamayı öldür, yeniden aç | son cevap kayıtlı (raw önce disk) |
| M-04 | Yanlış nedeni ekranında (S6) öldür | o cevap yok **ve doğru cevap görülmemişti**; öğe yeniden sunulur; sonuç ekranında (S5) öldürülürse cevap zaten diskte |
| M-05 | 1 dk öğrenme adımı | oturum bitince "N atom 15 dk içinde" görünür; bekleyince Başla vadeli getirir |
| M-06 | Düğme boyutları | tek elle ulaşılır; yanlış dokunuş yok |
| M-07 | Gece yarısı | bugün sayıları sıfırlanır; vadeler değişmez |
| M-08 | Yedek dosyası Dosyalar'a kaydedilir ve geri yüklenir | iPhone: paylaşım sayfasından iCloud Drive'a; Android: İndirilenler → geri yükleme başarılı |
| M-09 | Geri yükleme sırasında öldür | commit'ten hemen sonra uygulama öldürülür → yeniden açılışta "yarım kalan geri yükleme çözümleniyor" → tutarlı durum |
| M-10 | Kurtarma ekranı | (sahte migration hatası ile) normal açılış başarısızken kurtarma dökümü alınabilir; DB değişmez |

### 7.1 PWA güncelleme (el ile, `13` §7) — M-UP-01…08

| ID | Adım | Beklenen |
|---|---|---|
| M-UP-01 | v1 kurulu iPhone PWA + veri var; yeni sürüm deploy edilir; çevrimiçi açılış | eski build kendi önbelleğinden açılır; arka planda yeni build tam indirilir; bekleyen SW; Bugün'de "Yeni sürüm hazır → Yenile"; çalışma sırasında sessiz değişim yok |
| M-UP-02 | güncelleme sonrası | IndexedDB verisi korunmuş; sayılar aynı |
| M-UP-03 | eski önbellek | activate sonrası yalnız eski uygulama-kabuğu önbellekleri silinmiş; IndexedDB'ye dokunulmamış |
| M-UP-04 | çevrimdışı yeni sürüm | uçak modunda yeni sürüm açılır ve tam döngü çalışır |
| M-UP-05 | DB wipe yok | hiçbir sürüm geçişi veriyi silmez; şema migration'ı gerekiyorsa çalışır ve kurtarma noktası bırakır |
| M-UP-06 | eski JS'te kilitlenme yok | Yenile'ye basılırsa hemen; basılmazsa **tüm istemciler kapandıktan sonraki** açılışta yeni sürüm; ikinci sekme açıkken bekleme davranışı gözlenir |
| M-UP-07 | hash'li varlıklar | değişmeyen `assets/*.js` ağ olmadan önbellekten gelir; değişen varlık yeni adıyla ağdan gelir |
| M-UP-08 | yarım sürüm yok | yeni build deploy; bir JS varlığı sunucuda engellenir → yeni SW install başarısız, eski build çalışmaya devam eder; ağ kesilir → eski tam build çevrimdışı açılır; ikinci eski sekme açıkken Yenile → yalnız o istemci yenilenir; boş ekran / karışık sürüm yok |

### 7.2 Görsel ve erişilebilirlik (el ile, `14`)

| ID | Kontrol | Beklenen |
|---|---|---|
| V-01 | iPhone görünüm alanı (≈390×844) | tüm ekranlar taşmadan; birincil eylem alt yarıda |
| V-02 | küçük Android (≈360×640) | soru + 4 seçenek + Cevapla tek ekranda ya da rahat kaydırmayla |
| V-03 | büyük telefon (≈430×930) | satır uzunluğu < 80 karakter; boşluklar orantılı |
| V-04 | dark mode | semantik roller anlamını korur; kontrast AA |
| V-05 | light mode | aynı |
| V-06 | büyük yazı (sistem %150+) | düzen parçalanmaz; düğmeler taşmaz |
| V-07 | safe-area/çentik | alt düğmeler ana göstergenin üstünde; üst içerik çentiğin altında |
| V-08 | klavye açıkken form | odaklanan alan görünür; Kaydet erişilebilir |
| V-09 | yatay yön | temel kullanılabilirlik; kırılma yok |
| V-10 | renk körlüğü simülasyonu (protan/deutan/tritan) | doğru/yanlış/tereddüt yalnız renkle değil ikon+metin+kenarlıkla ayrılır |
| V-11 | reduced-motion | hareketler kapanır; akış aynı |
| V-12 | çevrimdışı standalone | ana ekrandan açılış, uçak modu, tam döngü |
| V-13 | cevap öncesi sızıntı yok | S3'te seçenekler nötr; doğru seçenek yeşil/vurgulu değil; istisna/uyarı rengi soru gövdesinde cevabı ele vermiyor |
| V-14 | kritik anlam yalnız renkle taşınmıyor | tarih/istisna/uyarı vurguları ikon veya tipografiyle de ayırt edilebilir |
| V-15 | vurgu enflasyonu yok | bir ekranda en fazla 2–3 vurgu rolü aynı anda |

## 8. Fazlara dağılım
`09_IMPLEMENTATION_PLAN.md` her fazın hangi test kimliklerini yeşile çevirmesi gerektiğini listeler. Kırmızı test bırakıp sonraki faza geçilmez (`11` kural 9).
