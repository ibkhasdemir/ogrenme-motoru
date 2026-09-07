# 02_EVIDENCE_FSRS_ENGINE.md — Kanıt → FSRS Motoru

Referans: `00_ANAYASA.md` A3–A7, A11, A15, A19. Domain: `01_DOMAIN_MODEL.md`.

Bu dosya motorun en kritik parçasını tanımlar. Akış:

```
Attempt ──▶ EvidencePolicy ──▶ ReviewEvent ──▶ FSRS Adapter ──▶ MemoryState
 (ham)        (saf fonksiyon)    (türetilmiş)    (ts-fsrs)        (türetilmiş)
```

Bu zincirin **tek** giriş noktası vardır: `applyAttempt(memory, attempt, policy, scheduler)`. Hem anlık kayıt (kullanıcı cevap verince) hem REBUILD aynı fonksiyonu çağırır. İki ayrı kod yolu yasaktır; aksi hâlde anlık durum ile REBUILD sonucu ayrışır ve A4 ihlal edilir.

## 1. EvidencePolicy

### 1.1 Tanım
`ratingFor(attempt, policy) → Rating | null`. Saf fonksiyondur; yan etkisi yoktur; yalnız Attempt alanlarına bakar (içerik tablolarına bakmaz — A6/A9 snapshot).

`null` = bu Attempt hafıza durumunu değiştirmez (ReviewEvent üretilmez).

### 1.2 policyVersion 1 — eşleme tablosu

| `kind` | `mode` | Sonuç | `confidence` / `selfAssessment` | Rating |
|---|---|---|---|---|
| herhangi | `pretest` | herhangi | herhangi | **null** |
| question | new/review/external | `correct = false` | herhangi | **1 Again** |
| question | new/review/external | `correct = true` | `guess` | **1 Again** |
| question | new/review/external | `correct = true` | `unsure` | **2 Hard** |
| question | new/review/external | `correct = true` | `sure` | **3 Good** |
| recall | new/review/external | — | `again` | **1 Again** |
| recall | new/review/external | — | `hard` | **2 Hard** |
| recall | new/review/external | — | `good` | **3 Good** |

Kurallar:
- **Easy (4) v0'da hiçbir yoldan üretilmez.** UI'da Easy düğmesi yoktur. Gerekçe: Easy'nin aralığı çok uzatması sınav hazırlığında erken "öğrendim" hissi yaratır; veri birikince policyVersion 2'de değerlendirilir.
- **Doğru + guess = Again.** Gerekçe (A7): FSRS "bilgiyi hatırladın mı" sorusunu modeller; kullanıcı "salladım" diyorsa hatırlama gerçekleşmemiştir, şık şansla tutmuştur. Again yerine "güncelleme yok" seçilseydi, ilk denemesi salladım-doğru olan atom hafıza durumu olmadan kalır (yetim kalır) ve kuyruğa asla vadeli olarak giremezdi. Again bunu çözer: atom öğrenme adımına girer, dakikalar içinde geri gelir.
- **Yanlış her güvende Again.** Güven bilgisi FSRS için önemsiz, analiz için kritiktir (A8); Attempt'ta saklanır, notu etkilemez.
- **Yalnız `primaryAtomIdAtAttempt` güncellenir.** QuestionAtom.secondary ve OptionAtom kayıtları hafıza durumunu **hiçbir koşulda** değiştirmez.
- `wrongReason` notu etkilemez.
- `support` notu etkilemez (v0 kararı). Anlamı açıkça: çengel gösterildikten sonra verilen Good = "çengelle hatırladım", ipucusuz hatırlama **değildir**; `support = hook` bunu ham veride ayırır. M1 verisiyle destekli/desteksiz sonuçlar ayrı değerlendirilmeden politika sertleştirilmez. Çengel içeriği cevabı doğrudan içermemelidir (S9 yardım metni); sistem bunu zorlayamaz, kullanıcı disiplinidir.
- `replayOfAttemptId` taşıyan Attempt (geri al sonrası tekrar) v1'de normal kanıttır (`03` §6.5); v2'de ayrı ele alınabilir.
- Bilinmeyen `policyVersion` → hata; sessizce varsayılana düşülmez.

### 1.3 Örnekler

**Örnek A — QuestionAttempt, doğru, tereddüt:**
```
attempt = { kind: question, mode: review, correct: true, confidence: unsure, primaryAtomIdAtAttempt: atm-1, ... }
ratingFor → 2 (Hard)
ReviewEvent = { attemptId, atomId: atm-1, rating: 2, reviewedAt: attempt.timestamp (kırpılmış) }
```

**Örnek B — QuestionAttempt, doğru, salladım, ilk deneme:**
```
attempt = { kind: question, mode: new, correct: true, confidence: guess, ... }
ratingFor → 1 (Again)
FSRS: New kart + Again → state Learning, learning_steps adımı 0, due ≈ +1 dk (§3.1a; değer kütüphaneden gelir, uygulama hesaplamaz)
```

**Örnek C — QuestionAttempt, yanlış, emin:**
```
attempt = { kind: question, mode: review, correct: false, confidence: sure, wrongReason: confused }
ratingFor → 1 (Again). confidence=sure analiz için "yanlış+emin" sınıfına düşer; FSRS için fark yok.
```

**Örnek D — RecallAttempt, çengel gösterildi, zorlandım:**
```
attempt = { kind: recall, mode: review, support: hook, selfAssessment: hard, confidence: null }
ratingFor → 2 (Hard). support notu etkilemez; Coverage için saklanır.
```

**Örnek E — Pretest:**
```
attempt = { kind: question, mode: pretest, correct: true, confidence: sure }
ratingFor → null. Attempt saklanır; ReviewEvent yok; MemoryState açılmaz (A5, A11).
```

**Örnek F — Void edilmiş Attempt:** EvidencePolicy'ye hiç ulaşmaz; REBUILD §5 adım 3'te filtrelenir.

## 2. ReviewEvent

`{ attemptId, atomId, rating, reviewedAt }`.
- `atomId` = `attempt.primaryAtomIdAtAttempt` (güncel Question.primaryAtomId **değil**).
- `reviewedAt` = `attempt.timestamp`, §5.3'teki monoton kırpma uygulanmış hâli.
- Bir Attempt en fazla bir ReviewEvent üretir.
- Türetilmiştir: silinebilir, REBUILD ile geri gelir. Diskte saklanması isteğe bağlıdır (`06`).

## 3. FSRS Adapter

### 3.1 Kütüphane gerçekleri (ts-fsrs 5.4.2, FSRS-6)
Uygulayıcının bilmesi gereken davranışlar; sürüm değişirse yeniden doğrulanır.

- `fsrs(params)` bir scheduler nesnesi üretir; `generatorParameters({...})` eksik alanları varsayılanla tamamlayıp tam parametre nesnesi verir (serileştirme için bu kullanılır).
- `createEmptyCard(now)` → `state = 0 (New)`, `reps = 0`, `last_review` yok.
- `scheduler.next(card, now, grade)` → `{ card, log }`. `grade` 1–4 (Manual=0 kullanılmaz). Geçersiz grade hata fırlatır.
- `scheduler.get_retrievability(card, now, false)` → 0..1 sayı. New kart için anlamsız/0 kabul edilir.
- Kart alanları: `due`, `stability`, `difficulty`, `reps`, `lapses`, `state` (0 New, 1 Learning, 2 Review, 3 Relearning), `learning_steps` (adım sayacı), `last_review`, `scheduled_days`, `elapsed_days` (v6'da kaldırılacak; kütüphane `elapsed`'ı `last_review` ile `now` farkından kendisi hesaplar, saklamak gerekmez).
- `enable_short_term = true` iken `learning_steps` ve `relearning_steps` uygulanır: New + Again/Hard/Good → Learning adımları (dakika), Review + Again → Relearning adımı.

**3.1a Pinli kütüphane sözleşme gerçekleri (5.4.2, `learning_steps = ["1m","10m"]`, `relearning_steps = ["10m"]`; 2026-09-07'de doğrulandı, `08` U-SC-04/05/12/13 ile korunur):**

| Durum | Not | Sonuç |
|---|---|---|
| New, adım 0 | Again | due ≈ +1 dk, Learning, adım 0 |
| New, adım 0 | Hard | due ≈ +6 dk ((1+10)/2 yuvarlama), Learning, adım 0 |
| New, adım 0 | Good | due ≈ +10 dk, Learning, adım 1 |
| Learning, adım 1 | Good | Review; aralık **öğrenme geçmişine bağlı**: `Good→Good` → 2 gün, `Again→Good→Good` ve `Hard→Good→Good` → tam 1 gün (stability adım geçmişiyle değişir) |
| Review | Again | Relearning, due ≈ +10 dk, lapses +1 |

Bunlar kütüphanenin davranışıdır, uygulamanın kuralı değil. **Uygulama dakikayı veya günü kendi hesaplamaz; `scheduler.next` tarafından yazılan `due`'yu kullanır.** Testler pinli davranışı **tam hazırlık dizisiyle** doğrular ("bir günden uzun" gibi genel eşikler yerine); genel değişmez: Review'a geçer, vade ileri gider, değer pinli scheduler çıktısıyla aynıdır. Uygulama bir testi geçirmek için aralığa gün eklemez. Pin değişirse bu tablo yeniden doğrulanır (§4.1).
Not: pinli `get_retrievability` bu ayarlarda ilk 24 saat içinde R = 1 döndürür; aynı gün vadeye düşen atomlar R'ye göre eşittir, kuyruk ikinci anahtar olarak `due ASC` kullanır (`03` §3.3).
- **`lapses` yalnız Review (2) durumundaki karta Again gelince artar.** Learning/Relearning'deki Again lapse saymaz. Testler buna göre yazılır.
- `enable_fuzz = true` aralıklara rastgelelik ekler → determinizmi bozar. v0'da **kapalı**.
- `w` (weights) verilmezse kütüphane varsayılanı; determinizm için export'a tam liste yazılır.

### 3.2 Adaptör sözleşmesi
```
createScheduler(config: SchedulerConfig) → Scheduler
Scheduler.emptyState(atomId, now)                       → MemoryState (New)
Scheduler.next(state, reviewedAt, rating)               → MemoryState  (vade yalnız burada yazılır — A15)
Scheduler.retrievability(state, now)                    → 0..1
```
- MemoryState ↔ Card dönüşümü adaptörün içindedir. `last_review`: `reps > 0` ise `lastReview`, değilse yok.
- Adaptör dışında hiçbir modül ts-fsrs'i import etmez.
- `due` değerini adaptör dışında yazan herhangi bir kod satırı sözleşme ihlalidir (A15). Kod incelemesinde `due =` ataması yalnız adaptörde bulunmalıdır.

## 4. SchedulerConfig

```json
{
  "configVersion": 1,
  "engine": "ts-fsrs",
  "engineVersion": "5.4.2",
  "algorithm": "FSRS-6",
  "requestRetention": 0.90,
  "maximumInterval": 365,
  "enableFuzz": false,
  "enableShortTerm": true,
  "learningSteps": ["1m", "10m"],
  "relearningSteps": ["10m"],
  "weights": null
}
```

- `engineVersion`: `package.json`'da tam pin (`"ts-fsrs": "5.4.2"`, `^` veya `~` **yok**). Kurulumda `npm view ts-fsrs version` ile doğrulanır; uyuşmazsa `BLOCKERS.md`.
- `weights: null` = kütüphane varsayılanı. Yedek alınırken `generatorParameters()` çıktısındaki tam `w` listesi `resolvedWeights` olarak ayrıca yazılır (`06` §7), böylece kütüphane varsayılanı ileride değişse de eski yedek aynı parametrelerle yeniden üretilebilir.
- **`resolvedWeights` ile algoritma gerçekleştirimi farklı şeylerdir.** Ağırlıklar bir sayı listesidir; algoritma (FSRS-6'nın formülleri, learning-step davranışı, kütüphanenin yuvarlama ve tarih hesabı) koddur ve `engine + engineVersion` ile tanımlanır. Aynı ağırlıklar farklı bir kütüphane sürümünde farklı `due` üretebilir.
- `maximumInterval = 365`: sınav ufku; bir yılı aşan aralık üretilmez.
- Değişiklik → `configVersion += 1` → REBUILD. Eski config yedekte saklı kalır (`schedulerConfigHistory`).

### 4.1 Uyumluluk ve REBUILD garantisi

Bayt bayt aynı MemoryState garantisi **yalnız** şu üç koşul birlikte sağlandığında geçerlidir:
1. aynı ham olaylar (attempts + voids, void filtresi sonrası),
2. aynı `EvidencePolicy.policyVersion`,
3. **uyumlu scheduler gerçekleştirimi + aynı config**: aynı `engine`, aynı `engineVersion` (tam pin), aynı `algorithm`, aynı `resolvedWeights`, aynı adımlar/aralıklar, `enableFuzz = false`.

Bir yedekte `engineVersion = "5.4.2"` yazması, o kütüphane sürümünün yeni uygulamada mevcut olduğu anlamına **gelmez**. Kurallar:
- Uygulama, yedeğin `engine + engineVersion + algorithm` üçlüsünü kendi kurulu scheduler'ıyla karşılaştırır. Eşleşiyorsa REBUILD "uyumlu" damgasıyla yapılır ve MemoryState eşitliği doğrulanabilir.
- Eşleşmiyorsa uygulama **eski motoru kullanıyormuş gibi davranamaz**. Geri yükleme commit edilmeden önce **bellekte normalize edilmiş snapshot** üretilir (`06` §8.4): yedeğin schedulerConfig'i kaybolmaz, `schedulerConfigHistory`'ye `config_snapshot` olarak arşivlenir ve `scheduler_migration` kaydı (`06` §7 kayıt türleri) eklenir; **aktif schedulerConfig = kurulu uygulamanın gerçekten kullandığı güncel config** olur (kendi `configVersion`'ı ve `resolvedWeights`'iyle); `replaceAll` bu aktif config ile commit edilir; REBUILD aynı aktif config ile yapılır; uygulama kapatılıp açıldığında DB'den okunan aktif config hâlâ güncel/uyumlu config'tir, eski uyumsuz config bir daha aktif olmaz. Ham olaylar ve içerik olduğu gibi yüklenir (hiçbir zaman kaybolmaz); kullanıcıya gösterilir; o yedekten türetilen MemoryState eşitliği **beklenmez**.
- Scheduler'ın major sürümü veya algoritması (örn. FSRS-6 → FSRS-7, ts-fsrs 5 → 6) bir migration stratejisi (`13` §6.4) yazılmadan **sessizce yükseltilemez**; `package.json` pini değişen bir PR, `13` §6.4 adımlarını içermeden birleştirilmez.
- Aynı major içinde yalnız yama sürümü değişse bile pin değişimi `configVersion += 1` ve REBUILD gerektirir; determinizm testi (U-RB-01) yeni pinle yeniden geçmelidir.

v0: ts-fsrs **5.4.2**, tam pin. Bu bölüm gelecekteki yükseltmeleri düzenler, bugünkü pini gevşetmez.

### 4.2 Determinizm için zorunlu ayarlar
| Ayar | Değer | Neden |
|---|---|---|
| `enableFuzz` | false | rastgelelik yok |
| `engineVersion` | tam pin | algoritma/gerçekleştirim değişimi sonucu değiştirir (§4.1) |
| `weights` | sabit (null → `resolvedWeights` yedekte) | |
| review zamanı | `Attempt.timestamp` (kırpılmış) | cihaz saati değil |
| sıra | `Attempt.sequence ASC` | timestamp eşitliğinde belirsizlik yok |
| kart durumu | yalnız `applyAttempt` yazar | ikinci yol yok |

## 5. REBUILD

### 5.1 Tanım
`rebuild(attempts, voids, policy, config) → { reviewEvents, memory: Map<atomId, MemoryState> }`. Saf fonksiyon; depoya yazmaz. Çağıran, sonucu bellekte tutar veya türetilmiş önbelleğe yazar (`06`).

### 5.2 Algoritma
```
1. reviewEvents ← boş liste          // türetilmiş temizlendi
2. memory ← boş harita               // türetilmiş temizlendi
3. voided ← { v.targetAttemptId : v ∈ voids }
4. ordered ← attempts sıralı: sequence ASC   // A19; timestamp'e bakılmaz
5. scheduler ← createScheduler(config)
6. her attempt ∈ ordered için:
     6a. attempt.id ∈ voided ise atla         // A3
     6b. rating ← ratingFor(attempt, policy)  // Attempt'ın kendi alanlarından (§1)
     6c. rating = null ise atla               // pretest
     6d. atomId ← attempt.primaryAtomIdAtAttempt   // snapshot (A6)
     6e. prev ← memory[atomId]
         if prev yok:
             reviewedAt ← attempt.timestamp
             prev ← scheduler.emptyState(atomId, reviewedAt)
         else:
             reviewedAt ← clamp(attempt.timestamp, prev.lastReview)   // §5.3; attempt.timestamp değişmez
     6f. (kırpma yukarıda; ayrı adım yok)
     6g. next ← scheduler.next(prev, reviewedAt, rating)
     6h. next.lastAttemptKind ← attempt.kind; next.lastQuestionId ← (question ise) attempt.questionId
     6i. memory[atomId] ← next
     6j. reviewEvents.push({ attemptId, atomId, rating, reviewedAt })
7. sonucu döndür
8. doğrulama (test): aynı girdiyle ikinci çağrı → serializeMemory eşit
```

`applyAttempt` = adım 6a–6j'nin tek attempt için hâli. Anlık kayıt: `appendAttempt(attempt)` başarıyla diske yazıldıktan **sonra** `applyAttempt` bellekteki projeksiyona uygulanır.

### 5.3 Monoton kırpma
FSRS review'ları zaman sırasıyla bekler. `sequence` sırası ile `timestamp` sırası nadiren ayrışabilir (external mod yakalama anı; cihaz saati geri alınmış). Kural: bir atom için `reviewedAt = max(attempt.timestamp, prev.lastReview)`. Kırpma yalnız hesap için kullanılır; `Attempt.timestamp` değişmez. Kırpma uygulandıysa ReviewEvent.reviewedAt kırpılmış değeri taşır.

### 5.4 Karmaşıklık
Attempt sayısı N, atom sayısı M: O(N log N) sıralama + O(N) replay. 10.000 Attempt için milisaniyeler mertebesi; v0'da uygulama açılışında tam REBUILD yapılabilir (`06` §4).

### 5.5 Policy / config değişince
- Yeni `policyVersion` veya `configVersion` → tam REBUILD zorunlu.
- Ham olaylar **değişmez**; yalnız türetilmiş durum değişir (T6).
- Eski sürümler yedekte korunur; geri yüklenen bir paketin config'i ile uygulamanın güncel config'i farklı ama scheduler **uyumluysa** (§4.1) paketin config'i ile REBUILD yapılır ve kullanıcıya bilgi verilir; scheduler uyumsuzsa §4.1'deki scheduler migration uygulanır (`06` §8, `13` §5).
- Policy'nin Attempt bazında "o anki sürüm"ü kullanılmaz: tüm geçmiş, güncel policy ile yeniden yorumlanır. Bu bilinçli bir karardır: policy hafıza modelinin yorumudur, olayın kendisi değil; olay snapshot'ları (`correct`, `confidence`, `selfAssessment`) yeterlidir.

### 5.6 İçerik semantiği neden snapshot'tan okunur
Question.primaryAtomId sonradan değişebilir (A9). REBUILD güncel Question'a bakarsa altı ay önceki cevap başka bir atoma yazılır ve o atomun hafızası yalan söyler. Bu yüzden `6d` güncel kayda değil `primaryAtomIdAtAttempt`'a bakar; `correct` de yazma anında dondurulmuştur. REBUILD içerik tablolarına **hiç dokunmadan** çalışabilmelidir (test: yalnız attempts + voids + policy + config ile çağrılır).

## 6. Anlık akış (kullanıcı cevap verince)

```
1. Attempt nesnesi kur (id, sequence ← depo sayacı, timestamp ← now, snapshot alanları)
2. depo.appendAttempt(attempt)        // tek işlem; başarısızsa hiçbir şey değişmez
3. reviewEvent ← applyAttempt(memory, attempt, policy, scheduler)
4. UI'yı güncelle
```
Adım 2 başarılı, adım 3 çökerse: açılışta REBUILD projeksiyonu geri getirir (`06` §5).

## 7. Geri al (AttemptVoid)
```
1. hedef ← UI'nın elindeki undoToken.targetAttemptId (sabit hedef; 03 §6.5); hedef zaten void ise / token süresi geçmişse işlem yok (null); önceki kayda DÜŞÜLMEZ
2. depo.appendVoid({ targetAttemptId: hedef.id, sequence ← sayaç, timestamp, reason: "undo" })   // reason: undo | clock_skew (06 §3.1)
3. tam REBUILD (bellekte)            // tek kaydı geri sarmak yerine deterministik yeniden üretim
```
Void edilen Attempt'ın ReviewEvent'i REBUILD sonrası yoktur; MemoryState o atom için önceki değerine döner (ilk denemeyse silinir).

## 8. Kabul kriterleri (bu dosyaya özel)
- Tablo §1.2'deki dokuz satırın her biri testte birebir doğrulanır.
- Easy hiçbir girişle üretilmez.
- Aynı girdi → iki REBUILD bayt bayt aynı (`serializeMemory`: atomId'ye göre sıralı JSON).
- Anlık yol ile REBUILD aynı MemoryState'i verir.
- Kod tabanında `due` ataması yalnız adaptörde bulunur.
