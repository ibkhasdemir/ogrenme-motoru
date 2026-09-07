# 05_LEARNING_CAPTURE.md — Dışarıdan Gelen Öğrenme Olayları (v0 dışı; alan tanımları v0'da hazır)

Referans: `00_ANAYASA.md` A11, A16–A18; `01_DOMAIN_MODEL.md` §2.10, §3.1, §4.5.

## 1. Neden var

Öğrenme masa başında düzenli olmuyor: bir öğretmen bir şey söyler, denemede garip bir soru gelir, arkadaş sorar, sosyal medyada bir bilgi geçer, aklına bir şey takılır. Normal sistemde "sonra bakarım" → unutulur. Burada: yakalanır, sonra işlenir, günler sonra farklı biçimde önüne gelir. Bu, uygulamayı kapalı bir soru bankasından yaşayan bir bilgi sistemine çeviren özelliktir.

## 2. Temel ayrım: yakalama ≠ ölçüm (A17)

Kullanıcı yazabilir, fotoğraf çekebilir, soru yapıştırabilir, sesle sorabilir, başka yerde yanlış yaptığı soruyu ekleyebilir, yalnız merak ettiği bir şeyi sorabilir. **Bunların hiçbiri otomatik olarak Attempt değildir.**

Beş olay türü:

| Tür | Ne oldu | Atom durumu | Ürettiği şey |
|---|---|---|---|
| **Inquiry** (merak) | Bir şey merak edildi; sınav başarısızlığı yok | herhangi | yalnız içerik (atom/soru/çengel). Attempt **yok**. |
| **Learning Capture** | Öğrenilmek istenen bilgi not edildi | hafıza durumu **yok** | içerik; atom `sortOrder` başına alınır. Attempt **yok**. |
| **Failed external question** | Dışarıda bir soru çözülemedi / hatırlanamadı | hafıza durumu **var** | içerik (soru eklenebilir) + `RecallAttempt { mode: external, selfAssessment: again }` |
| **Correction** | Kullanıcı yanlış bildiğini fark etti (kendi inancı yanlış çıktı) | hafıza durumu var | içerik + `RecallAttempt { mode: external, selfAssessment: again, confidenceAtFailure: sure }`; yanlış+emin sınıfı yapılandırılmış alanla işaretlenir (`01` §4.3), `provenance.note`'a gömülmez |
| **External Question Attempt** | Dışarıdaki bir çoktan seçmeli soru uygulamaya girilip **o an** çözüldü | herhangi | normal `QuestionAttempt` (mode: hafıza durumu yoksa `new`, varsa `review`); external değildir çünkü ölçüm uygulama içinde yapıldı |

Kural: **Yalnız hafıza durumu olan bir atomun gerçek hatırlama başarısızlığı Again üretir.** Hafıza durumu olmayan atoma yakalama hiçbir Attempt yazmaz; o atom ilk denemesini normal döngüde (`mode: new`) yapar. Böylece FSRS geçmişine "henüz öğretilmemişti, bilemedi" şeklinde sahte başarısızlık yazılmaz (A5, A11 ile tutarlı).

`Attempt.timestamp` = yakalama anı (hatırlama o an başarısız oldu); `sequence` = işleme sırası (A19). Monoton kırpma `02` §5.3.

## 3. Öğrenme Kutusu (Learning Inbox)

### 3.1 Yakalama
Her ekrandan `+ Yakala`: metin, fotoğraf, ses, yapıştırma. O anda düzenleme **zorunlu değildir**. Sonuç: `InboxItem { status: pending }`.

### 3.2 InboxItem olay değildir
Hiçbir projeksiyona girmez; düzenlenebilir, silinebilir (`discarded`). A3 yalnız Attempt/AttemptVoid için geçerlidir. Kaydet'e kadar hiçbir hafıza etkisi yoktur.

### 3.3 İşleme (Kaydet) — manuel (M2)
```
1. Kullanıcı atomu seçer (arama) veya yeni atom açar.
   - Mevcut atom bulunursa yeni atom açılmaz; bağlanır (duplicate önleme).
2. Öğe soruysa: beş zorunlu alanla Question olur (`07` S10), primaryAtom = seçilen atom.
3. Provenance otomatik yazılır (§5).
4. Atomun hafıza durumu var mı?
   - Yok → bitti (Learning Capture / Inquiry). Attempt yok. Atom sortOrder başına alınır.
   - Var → tek soru: "Bu neden geldi?"
        ○ Merak ettim      → Attempt yok
        ○ Hatırlayamadım   → RecallAttempt external/again
        ○ Yanlış yaptım    → RecallAttempt external/again; ek tek dokunuş "Bundan emin miydin?" (Evet → confidenceAtFailure: sure, Hayır → unsure)
        ○ Karıştırdım      → RecallAttempt external/again + AtomRelation.confusable önerisi (kullanıcı onaylar)
5. InboxItem.status ← processed.
```
Soru yalnız hafıza durumu olan atomda sorulur; yeni atomda hiç sorulmaz (A12).

### 3.4 Akıllı işleme (M4, LLM)
```
fotoğraf/metin/ses
  → OCR / STT
  → LLM: açıklama + ana atom eşleştirme (mevcut atom araması, benzerlik) veya yeni atom önerisi
        + soru önerisi (beş alan dolu) + çengel önerisi + ilişki önerisi (confusable/prerequisite)
  → kullanıcı ekranı: her öneri ayrı ayrı ✓ / ✗ / düzenle
  → Kaydet → §3.3 adım 3–5
```
- **Yapay zekâ onaysız kalıcı bilgi modelini değiştiremez** (A18). Öneriler InboxItem içinde taslak olarak durur; Kaydet'e kadar Atom/Question/Relation yazılmaz.
- Aynı atom zaten varsa duplicate atom açmak yerine mevcut atoma bağlama önerilir; "Bunun için zaten bir atomun var: …" gösterilir.
- Halüsinasyon/yanlış sınıflandırma riski kullanıcı onayıyla sınırlanır; onaylanan içerik de A9/A10 sürüm kurallarına tabidir.
- LLM soru üretirken facet → işlem tablosu (`04` §5) filtredir.

## 4. Görünürlük ve pekiştirme

- Dış başarısızlık sonrası ilişkili atomların görünür sete alınması **vadeleri değiştirmez** (A16).
- **Pekiştirme demeti (reinforcement bundle)** — ileride: external Again sonrası, o atom için en fazla aynı gün 1 farklı soru + ertesi günün görünür setine 1 confusable atom. Tavan 2. "Bir soru sordun diye ertesi sabah 24 ekstra konu" olmaz.
- **Mini onarım oturumu** — ileride: aynı atoma kısa sürede 3+ farklı kaynaktan yakalama + tekrarlayan hata → `04` §4.7 Rescue Mode tetiği.
- **Repeated external failure detection** — ileride: aynı atomda 20 gün içinde N external Again → "lokal bilgi açığı değil kavramsal düğüm" sinyali; analiz katmanına işaretlenir. v0.5'te sadece sayılır, gösterilmez.

Bunların hiçbiri v0'a girmez.

## 5. Provenance (köken)

Ayrı gömülü nesne; **MemoryHook.personal içine gömülmez** (`01` §2.10).
```json
{ "type": "kisi", "note": "Ahmet'in sorduğu soru", "ref": null, "date": "2026-09-07T14:02:00.000Z", "context": "kantinde" }
```
- `type`: deneme | kitap | kisi | merak | ders | sosyal_medya | kendi
- `note`: serbest metin ("2026 AGS deneme 3, soru 34", "kitap s.217")
- `ref`: görsel/ses dosyası referansı (uygulama içi depolama anahtarı)
- `date`: otomatik (yakalama anı)
- `context`: kişisel bağlam; aylar sonra "bunu şu soruda yemiştim" çağrışımı için

Provenance atomda ve/veya soruda saklanır; bir atomun birden çok kökeni olabilir (dizi). Aynı atoma üç farklı kökenden yakalama, başlı başına öğrenme sinyalidir (§4).

## 5a. M2/M4'ten önce çözülmesi gereken açık noktalar (ikinci dış inceleme F01–F03; tasarım notu, v0 dışı)
- **F01 — üç zaman:** olay zamanı (başarısızlığın yaşandığı an), yakalama zamanı, işleme zamanı ayrı tutulur. External review uygunluğu **başarısızlık anında** atomun hafıza durumu olup olmadığına bakar, işleme anındaki duruma değil. Pazartesi öğrenilmemiş → salı öğrenilmiş → çarşamba işlenmiş olay review üretmez (test M2'de).
- **F02 — gözlemlenemeyen alanlar:** geriye dönük external Attempt'ta `responseTimeMs` bilinemez → `null` ("uygulanamaz"), sıfır uydurulmaz; dışarıda hangi desteğin gösterildiği bilinmediğinden `support` da `null` ("uygulanamaz") — enum genişletilmez, `none` (ipucusuz) yazılmaz; EvidencePolicy external Attempt'ta yalnız `selfAssessment`'a bakar. Attempt `sourceInboxItemId` taşır; içerik + Attempt + `processed` tek mantıksal, tekrar-güvenli işlemdir (çökme sonrası aynı kutu öğesi ikinci başarısızlık yazmaz). Bu iki `null` kuralı M2'de `01` §4.1'e alan notu olarak işlenir.
- **F03 — medya ekleri:** `imageRef/audioRef/provenance.ref` yalnız depolama anahtarıdır; taşınabilir yedek dosyayı taşımaz. Medya özelliğiyle birlikte sürümlü ekler biçimi (içerik hash'li, eksik ek doğrulamalı; ZIP paketi veya boyut sınırlı gömülü içerik) tasarlanmadan medya yakalama açılmaz.

## 6. v0 ile ilişkisi

v0'da yakalama ekranı **yoktur**. v0'da hazır olanlar: `AttemptMode.external` değeri, `Provenance` alanı, `InboxItem` tanımı. Bunlar migration gerektirmeden M2'de doldurulur. `10_V0_NON_GOALS.md`.
