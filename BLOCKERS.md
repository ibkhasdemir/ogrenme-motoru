# BLOCKERS.md — Spec çelişkileri, uygulanamazlıklar ve bekleyen kararlar

Protokol: `11_CLAUDE_CODE_RULES.md` kural 5–6. Her madde: tarih · ilgili spec bölümü · gözlem · en küçük öneri · durum.
Durumlar: **KARAR BEKLİYOR** (kullanıcı karar verir; belirtilen varsayılan uygulanır) · **ÇÖZÜLDÜ** (kural 2 — anayasa > küçük numaralı dosya — veya spec'in kendi içindeki daha özgül cümleyle; bilgi amaçlı, kullanıcı isterse spec'i günceller) · **KAPANDI**.
Spec dosyaları düzenlenmez. Blocker işi durdurmaz; etkilenmeyen fazlarda devam edilir.

Kaynak: 15 dosyanın tam okunması + spec tutarlılık denetimi (2026-09-08; 6 lens, 68 ham bulgu; her bulgu spec metniyle tek tek değerlendirildi). Tüm maddeler 2026-09-08 tarihli.

## 0. Özet

| Durum | Sayı |
|---|---|
| Karar bekliyor (§1) | 10 — kullanıcı 2026-09-08'de "varsayılanla ilerle" dedi; hepsi varsayılanla UYGULANDI, spec sahibi isterse değiştirir |
| Çözüldü (§2) | 24 |
| Kapandı (§4) | 2 |

## 1. Karar bekleyen maddeler

### BL-04 — Geri al tekrarında `actionId` ve tekrar cevabın geri alınabilirliği
- Bölüm: `01` §4.1 (`id` actionId'den türetilir, aynı id reddedilir) ↔ `01` §4.6 / `03` §6.5 ("EXACT LearningAction bir kez yeniden sunulur") ↔ `08` I-05, I-20, U-UN-06, U-UN-07.
- Gözlem: aynı `actionId` ile yeniden sunum, tekrar cevabın Attempt id'sini void edilen Attempt'la çakıştırır; depo reddeder, U-UN-07 hiç geçemez. Yeni `actionId` üretilirse "her LearningAction için bir kez" kuralının tekrar cevaba uygulanıp uygulanmayacağı yazılı değil.
- Varsayılan: tekrar sunumu **yeni `actionId`** taşır (kind/questionId/questionVersion aynı); tekrar Attempt'ı `replayOfAttemptId` ile bağlanır; tekrar cevaba **undoToken verilmez** (aynı mantıksal action için "bir kez" tüketilmiştir; S5/S7'de Geri al görünmez).
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-05 — `00` §3 "ölçüm kaydı her zaman doğru cevabın gösteriminden önce yazılır" ↔ hatırlama kartı
- Bölüm: `00` §3 ↔ `07` §3 ("Kart: öz değerlendirme dokunuşunda; cevap zaten açılmıştır"), `07` S7, `03` §4.4, `01` §4.1 `responseTimeMs`.
- Gözlem: kartta öz değerlendirme tanım gereği cevap açıldıktan sonra verilir; `00`'daki "her zaman" harfiyen sağlanamaz. `00` FROZEN ve çelişkide kazanır; `00` §5 uygulanamaz maddeyi buraya yönlendirir.
- Varsayılan: soru yolunda `00` §3 harfiyen (Attempt S5'ten önce diske); kartta `07`/`03`/`01`'in ortak tasarımı (hatırlama ölçümü "Cevabı aç" anında biter, Attempt öz değerlendirmede yazılır).
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı; spec sahibi `00` §3'ü "soru yolunda" diye daraltabilir.

### BL-06 — Bugün ekranı sayıları: `00` §3 "tekrar / yapılan / kalan" ↔ `03` §7 ve `07` S1 "tekrar / yeni / bugün yapılan"
- Gözlem: "kalan" hiçbir dosyada tanımlı değil; "yeni" `00`'da yok; U-DQ-14 "0 yeni" metnini bekler; `07` "üç sayı" der.
- Varsayılan: `03` §7 / `07` S1 uygulanır (tekrar, yeni, bugün yapılan); "kalan" karşılığı `Başla · N öğe` tahminidir.
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-07 — Açılışta yarım kalmış geri yüklemenin yeniden doğrulanması için `dryRunMemory` / `normalizedSnapshot` kalıcı değil
- Bölüm: `06` §8 adım 9, 14; §8.5 ("committed → adım 13–14 yeniden koşulur"); `08` B-33, M-09.
- Gözlem: journal yalnız `{ jobId, kind, phase, targetSummary, prePointId, … }` taşır; uygulama commit sonrası kapanıp açılınca adım 14'ün karşılaştırma operandları bellekte yok.
- Varsayılan: açılış doğrulaması = REBUILD hatasız + adım 7 değişmezleri + sayaç = max sequence; geçerse `verified`, geçmezse §8.6. Kanonik JSON ve `serializeMemory` karşılaştırması yalnız aynı oturumda yapılır. Ek kalıcı veri yazılmaz.
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (alternatif: hedef paket journal'a payload olarak yazılır).

### BL-08 — "Bilinmeyen `configVersion` → red" ↔ scheduler uyumsuz yedeği normalize yolu
- Bölüm: `06` §7 (bilinmeyen alanlar), `08` B-30 ↔ `06` §8.4, `02` §4.1, `13` §6.4(a), `08` B-19.
- Gözlem: `13` §6.4 her motor değişikliğinde `configVersion += 1` ister; daha yeni motorla alınan gerçek yedek zorunlu olarak kurulu uygulamanın "bilmediği" `configVersion` taşır ve B-30 okumasıyla normalize adımına ulaşamadan reddedilir; `02` §4.1'in "ham olaylar hiç kaybolmaz" vaadi bu yolda tutulamaz.
- Varsayılan: "bilinmeyen configVersion" = eksik veya pozitif tamsayı olmayan değer → red; tamsayı her değer kabul edilir, `isCompatible` false ise `06` §8.4 normalize yolu uygulanır. B-30 bu tanımla yazılır.
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-09 — iOS standalone PWA'da Blob indirme çalışmıyor; paylaşım sayfası için Web Share gerekir, `ShareService` v0 dışı
- Bölüm: `13` §4.5, `08` M-08 ("iPhone: paylaşım sayfasından iCloud Drive") ↔ `06` §11 (BackupFileService web: `showSaveFilePicker` yoksa Blob indirme; `ShareService` hayır, arayüz bile yazılmaz).
- Gözlem: `showSaveFilePicker` iOS Safari ve Android Chrome'da yok; `<a download>` + Blob ana ekrana eklenmiş (standalone) iOS PWA'da sessizce başarısız olduğu raporlanmış (WebKit 275288 → Apple radar; iOS 18+/26'da düzeldiği doğrulanmadı). Paylaşım sayfası yalnız `navigator.share({ files })` ile açılır.
- Varsayılan: `BackupFileService` **web gerçekleştirimi içinde** (ayrı ShareService arayüzü yok) sıra: `showSaveFilePicker` → `saved`; yoksa `navigator.canShare({ files })` → `navigator.share` → `initiated`; yoksa Blob indirme → `initiated`. M-08 standalone PWA'dan denenir.
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-10 — Legacy format 1 / schemaVersion 1 fiziksel yapısı tanımsız (Yol B)
- Bölüm: `06` §6.2, §7 matrisi, §8 adım 2–3 ("format-1 yapısal kurallar"), §8.3; `08` I-17, B-16, B-35, B-37.
- Gözlem: format 1 yalnız "mevcut gerçekleştirim"e göndermeyle tanımlı; Yol B'de o kod yok. Fixture'lar `06` §6.2/§8.3'ün saydığı alanlarla yazılacak: questions[] `{ id, version, text, options[], correctOptionId, primaryAtomId, source, createdAt, archived }`, attempts[] `questionVersion`li, üst alanlar `backupFormatVersion: 1`, `schemaVersion: 1`, `config`, `content`, `events`; checksum yok. **Elinizde eski uygulamadan gerçek bir format-1 yedek dosyası veya IndexedDB dökümü varsa fixture ona göre yazılır.**
- Durum: **KARAR BEKLİYOR** — varsayılan fixture uygulandı; gerçek format-1 dosyası gelirse fixture ona uyarlanır.

### BL-11 — S7 "Son kartı geri al" çubuğunun yeri
- Bölüm: `07` S7 ("bir sonraki öğeye geçmeden önce … ekran altında en fazla 30 sn çubuk"; S7'de Devam düğmesi yok) ↔ `07` §3 ("öz değerlendirme → Attempt → nextItem"), E-07 ("Hatırladım → sonraki"), `07` §1.1 (Cevapla / Geri al bitişik değil).
- Varsayılan: öz değerlendirme sonrası `nextItem` hemen çağrılır; çubuk sonraki ekranın altında 30 sn kalır, birincil eylemle arasında boşluk bırakılır (bitişik değil).
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-36 — `maximumInterval = 365` pinli kütüphanede sert tavan değil (Good = 366 gün)
- Bölüm: `02` §4 ("`maximumInterval = 365`: sınav ufku; bir yılı aşan aralık üretilmez"), `08` U-SC-10 ("due ≤ now + 365 gün") ↔ ts-fsrs 5.4.2 gerçeği.
- Gözlem (2026-09-08, betikle ölçüldü): Review durumunda çok yüksek stability ile Hard aralığı 365'e kırpılır; kütüphane Good'u en az `Hard + 1` yaptığı için Good = **366** gün, Easy = 367 gün (Easy v0'da üretilmez). `maximum_interval: 364` verilirse Good = 365 olur.
- Varsayılan: `02` §4 değeri (365) ve kütüphane çıktısı aynen korunur; uygulama aralığa gün eklemez/çıkarmaz (`02` §3.1a); U-SC-10 gerçek üst sınırı (`maximumInterval + 1`) belgeler. Pratik etki yok (stability 100.000 gerçekçi değil).
- Alternatif: `maximumInterval: 364` (`configVersion += 1`, REBUILD; `02` §4 düzeltmesi gerekir).
- Durum: **KARAR BEKLİYOR** — varsayılan uygulandı (kullanıcı onayı 2026-09-08: "varsayılanla ilerle").

### BL-38 — İçerik içe aktarma (spec dışı özellik; sahibi kararıyla eklendi)
- Bölüm: `10` §1 (LLM/soru üretimi non-goal; içe aktarma listede yok), `10` §3 (01–08'de tanımlı değilse uydurulmaz), `00` A21 ve `06` §5/§9 ("içe aktarma" yıkıcı işlem sınıfında adı geçer; `pre_import` kurtarma noktası tanımlı, akış/biçim tanımsız).
- Gözlem (2026-09-08, telefon kullanımı): içeriği formdan tek tek girmek kullanılabilirliği düşürüyor; kullanıcı "elle doldurmayacağım, çözüm bulalım" dedi ve içe aktarma özelliğini onayladı ("evet ya çok iyi olur").
- Karar (sahibi): **eklendi** — Phase 13. Sınırlar: uygulamada LLM/API yok (JSON dışarıda üretilir; şablon uygulamada, `IMPORT_PROMPT_TEMPLATE`); yalnız ekler (mevcut içerik/öğrenme geçmişi değişmez; birleştirme/senkron değildir); formla aynı kurallar (`Motor.addAtom`/`addQuestion`); hatalı öğe varsa hiçbir şey eklenmez (atomik plan); kurtarma deposu bağlıysa önce `pre_import` noktası (`06` §9 retention işlem sınıfı). Biçim `ogrenme-motoru-icerik/1` (Türkçe anahtarlar; `dogru` seçenek metni, sayı reddedilir). Modüller: `src/engine/import/contentImport.ts` (saf), `src/app/contentImport.ts`, `src/ui/contentImport.ts`; testler `tests/phase13-content-import.test.ts`.
- Bilinen sınır: uygulama sırasında tek transaction yok; ön doğrulama sonrası ekleme sıralıdır (yarıda kesilirse eklenenler kalır, eksikler ikinci denemede "zaten var" ile atlanır).
- Durum: **KAPANDI** (sahibi kararı 2026-09-08). Spec'e (`07`) sonraki revizyonda S11b olarak işlenmesi önerilir; `docs/spec` bu depoda düzenlenmez.

### BL-39 — Üçüncü dizin seviyesi (alt başlık) ve kullanıcı kodlamaları
- Bölüm: `01` §2 (Subject → Topic → Atom, iki seviye), `10` §1 (analiz/zayıf halka non-goal).
- Gözlem (2026-09-08, telefon kullanımı): kullanıcı ders notunu (18. yy Osmanlı) ıslahatlar / siyasi tarih / padişahlar gibi alt başlıklara ayrı dizinlemek istiyor; kendi kodlamalarını (mnemonik) ilgili yere bağlı tutmak istiyor; "yanlışım nerede" sorusuna konu bazında bakabilmek istiyor.
- Karar (Claude, sahibi adına — şema değişmeden yapılabilen kısım): içe aktarmada `altbaslik` alanı Topic adına `" › "` ile eklenir ("18. yy Osmanlı › Islahatlar"); İçerik listesi Ders › Konu gruplarına ayrılır (sayılarla, açılır-kapanır); `cengeller`/`kodlamalar` bölümü mevcut atomlara çengel ekler (`Motor.addHook`); şablon yapay zekâya kullanıcının kodlamalarını uydurmadan aktarmayı söyler. Veri modeli ve yedek formatı değişmedi.
- Ertelenen (sahibi kararı gerekir): gerçek hiyerarşi (`Topic.parentTopicId`, şema 3, migration, yedek formatı 3); kazanım (learning outcome) alanı; konu bazında doğruluk/tanı görünümü (`10` non-goal "zayıf halka" — spec revizyonu gerekir). Ad içi ayraç geçici kodlamadır; gerçek hiyerarşiye geçilirse migration ayraçtan böler.
- 2026-09-08 ikinci tur (telefon: 115 atom / 37 konu): şablonda ünite kuralı sertleştirildi; içe aktarmada `applyUnitToPlan` ("Ünite" alanı) ve `unitWarning`; `Motor.renameTopic` (aynı derste aynı ad → birleştirme, atomlar taşınır, ham olaylar ve vadeler değişmez); S11c "Konuları düzenle" ekranı; içerik listesi ünite bazlı gruplama + alt başlık etiketi (`splitTopicPath`/`joinTopicPath`).
- Ek (aynı gün): içe aktarma ekranında "Ders notun" kutusu (şablon + not tek parça paylaşılır), atom ekranında "Çengel ekle" (varsayılan tür kodlama; `Motor.addHook`), `kazanim` = `altbaslik` alias.
- Durum: **UYGULANDI (kısmi)**; ertelenenler açık.

### BL-40 — "Yedek al" dosya adımı elle kalıyor (iPhone)
- Bölüm: `06` §11 (BackupFileService: saved / initiated + teyit), `10` §1 (bulut yedek non-goal), `13` §2.
- Gözlem (2026-09-08): kullanıcı dış yedeği "dosyaya çevir, kaydet, geri yüklerken dosyayı bul" akışını yorucu buluyor; arka planda otomatik olmasını istiyor.
- Gerçek: iPhone'da web uygulaması paylaşım sayfası dışında dosya yazamaz, iCloud'a erişemez; sessiz dış yedek yalnız bulutla mümkündür (v0 dışı). Cihaz içi kurtarma noktaları zaten otomatiktir (günlük + işlem öncesi).
- Karar: dosya akışı spec'teki gibi kalır. Yapılan: açılışta `navigator.storage.persist()` (kalıcı depo isteği); Veri ekranı notu ve README, otomatik cihaz içi kopyaların varlığını ve dış dosyanın haftalık sigorta olduğunu açıkça söyler. Hatırlatma eşiği (`06` §10: 7 gün / 250 olay) değişmedi.
- Durum: **KAPANDI** (sınır platformdan). Bulut yedek ileride ayrı karar.

### BL-41 — Öğrenme Kutusu (yakalama) v0'a eklendi (spec: M2)
- Bölüm: `05_LEARNING_CAPTURE.md` (tam tasarım), `01` §3.1 (InboxItem), `01` §4.1 (`mode: external`), `10` §1 ("Yakalama · Öğrenme Kutusu ekranı, + Yakala → M2"), `06` §9.
- Gözlem (2026-09-09): sahibi sıradaki iş olarak yakalamayı seçti. `05` zaten tam tasarlanmış; v0'da yalnız ekran yoktu (`05` §6: "v0'da hazır olanlar: AttemptMode.external, Provenance, InboxItem").
- Karar (sahibi): **eklendi** — Phase 14. Uygulanan kapsam `05` §2, §3.1–3.3, §5, §5a F01–F02: yakalama ölçüm değildir; Attempt yalnız başarısızlık anında hafıza durumu olan atomda ve gerçek başarısızlıkta (`forgot`/`wrong`/`confused`) doğar; `timestamp` = yakalama anı; `support`/`responseTimeMs` = null (F02, `01` §4.1 alan notu olarak uygulandı); `sourceInboxItemId` + kutu öğesinden türetilen id ile tekrar-güvenlik; "Karıştırdım" onaylı `confusable` ilişkisi; köken atoma yazılır.
- Bilinçli kapsam dışı (sonraki tur): fotoğraf/ses yakalama (F03 — medya biçimi tasarlanmadan açılmaz), LLM'li akıllı işleme (`05` §3.4 = M4), pekiştirme demeti / mini onarım / tekrarlayan başarısızlık sayacı (`05` §4, ileride), işleme sırasında soru oluşturma (`05` §3.3 adım 2 — şimdilik atom bağlanır, soru mevcut "+ Soru" ekranından eklenir), çalışma ekranlarında "+ Yakala" (ölçüm akışını bölmemek için yalnız Bugün ve Kutu'da).
- Şema/yedek etkisi: yok. `inbox` tablosu ve `Provenance` zaten şema 2'de; yedek formatı 2 aynı. Yalnız doğrulama, external Attempt'ta iki null alanı kabul edecek şekilde genişletildi (başka modda null hâlâ hata).
- Bağımsız denetim (2026-09-09) 5 hata buldu, hepsi düzeltildi (`tests/phase14c-capture-audit.test.ts`): (1) çökme sonrası kutu öğesi `DuplicateAttemptError` ile kalıcı kilitleniyordu — aynı id artık "zaten yazılmış" sayılıp iş tamamlanıyor (F02'nin "tek mantıksal, tekrar-güvenli işlem" cümlesi); (2) `05` §2/§3.3'ün "atom sortOrder başına alınır" kuralı uygulanmamıştı; (3) köken yalnız tip seçilirse yazılıyordu, not sessizce kayboluyordu (§3.3 adım 3 koşulsuz der) → tip yoksa `kendi`; (4) yedek doğrulamasında external muafiyeti `kind`'a bağlı değildi, `mode: external` bir QuestionAttempt ya da `selfAssessment: good` bir external kayıt geçiyordu (`01` §4.5); (5) `confusedWithAtomId` nedenden ve uygunluktan bağımsız ilişki yazıyordu, arşivli atom kabul ediliyordu.
- Durum: **KAPANDI** (sahibi kararı 2026-09-09). Modüller: `src/engine/capture/capture.ts`, `Motor.captureInbox/editInbox/discardInbox/askReasonFor/processInbox`, `src/ui/capture.ts`; testler `tests/phase14-capture.test.ts`, `tests/phase14b-capture-ui.test.ts`.

### BL-42 — İlerleme ekranı ("nerede zayıfım") — spec'te v0 dışı sayılan analiz
- Bölüm: `10` §1 (Analiz satırı: "haftalık rapor, zayıf halka, kalibrasyon skoru, yanlış inançlar ekranı…" v0 dışı; Skorlar satırı: "Mastery Score, kalibrasyon skoru…" yasak), `00` A20 (ne çalışılacağına motor karar verir), `01` §4.3 (güven yapılandırılmış alan), `03` §6.5 (void edilen ölçüm yok sayılır).
- Gözlem: kullanıcı 2026-09-08'de "yanlışım veya bilmediklerim hakkında düzgün yorum yapabileyim" dedi; 2026-09-09'da "tam gaz devam" ile yeni özellik istedi. Veri (Attempt + confidence + confidenceAtFailure) zaten toplanıyor, yalnız gösterilmiyordu.
- Karar (sahibi adına, "tam gaz" talimatıyla): **eklendi** — Phase 15, sıkı sınırlarla. Yalnız SAYILAN büyüklükler: cevap, başarısızlık, emin-yanlış, üst üste başarısızlık, konu kapsamı. **Uydurulmuş skor/indeks/tahmin yok** (10 §1 yasağının özü korunur), sıralama ve vadeler etkilenmez (A20; ekran salt okur), veri azken (< 5 cevap) oran gösterilmez. Pretest ve void edilmiş denemeler sayılmaz. Zaman penceresi uygulama katmanında hesaplanır; analiz modülünde gün/dakika sabiti yoktur (08 U-SC-14 taraması korunur).
- Bilinçli kapsam dışı: grafik/çizelge (10 §1 Görselleştirme), ders ağırlığı/öncelik formülü, sınav günü projeksiyonu, tekrarlayan dış başarısızlık sinyali (`05` §4: "v0.5'te sadece sayılır, gösterilmez"), süre/performans eğrisi.
- Durum: **KAPANDI**. Modüller: `src/engine/analysis/stats.ts` (saf), `src/ui/progress.ts`; testler `tests/phase15-progress.test.ts`.

### BL-44 — Uygulama içi yapay zekâ (spec: M4; LLM v0'da yasak)
- Bölüm: `10` §1 ("Yapay zekâ: LLM çağrısı, prompt, API anahtarı… M4"), `00` A18 (yapay zekâ onaysız kalıcı bilgi modelini değiştiremez), `05` §3.4, `06` §11 (PlatformServices sınırı), `10` §1 Altyapı ("backend yok").
- Gözlem (2026-09-09): kullanıcı şablonu dışarı taşıyıp JSON'u geri getirmeyi "amelelik" olarak niteledi ve uygulamanın içinde yapay zekâ istedi.
- Karar (sahibi): **eklendi** — Phase 16, sınırlarla. `AiService` PlatformServices sınırının arkasında (motor/domain bilmez); çağrı doğrudan tarayıcıdan **kullanıcının kendi anahtarıyla** yapılır (sunucu/proxy yok, "backend yok" korunur). Üretilen şey ÖNERİDİR: aynı içe aktarma doğrulaması + önizleme + "Ekle" onayından geçer (A18). Ham yanıt metin kutusuna düşer, kullanıcı düzeltebilir.
- Anahtar: `localStorage` (cihaz içi). IndexedDB'ye yazılmaz → **taşınabilir yedek anahtarı taşımaz**, geri yükleme/sıfırlama anahtara dokunmaz. Ekranda yalnız maskeli gösterilir. Uygulama anahtarsız tam çalışır; çevrimdışı yol değişmez.
- Bilinçli kapsam dışı: OCR/ses (`05` §3.4 M4), otomatik atom eşleştirme/ilişki önerisi, uygulama içinde soru üretme (yalnız içe aktarma yolu), maliyet/kullanım göstergesi.
- Durum: **KAPANDI**. Modüller: `src/platform/ai.ts`, `src/platform/web/ai.ts`, `src/app/aiSettings.ts`, `src/app/aiImport.ts`, `src/ui/dataAi.ts`; testler `tests/phase16-ai-ux.test.ts`.

### BL-45 — Geri gezinme ve dokunma ergonomisi
- Bölüm: `07` §1.1 (telefon ergonomisi), `14` §11, §13; `07` S1 alt eylemler.
- Gözlem (2026-09-09): kullanıcı "bir yere gidince en üste çıkıp geri basmam gerekiyor; iOS kaydırma hareketi de çalışmalı" dedi; Bugün ekranındaki alt eylem satırı yedi düğmeyle taşıyordu.
- Karar: ekran geçişleri tarayıcı geçmişine yazılır (`pushState`; aynı ekran içi durum değişimi `replaceState` ile geçmişi şişirmez) → iOS kenar kaydırma ve Android geri tuşu çalışır; `popstate` çalışma ekranından çıkışta oturumu bırakır (yarım cevap kaydedilmez, `07` §1.1). Ekran başlığı yapışkan, alt eylem çubuğu yatay kaydırmalı ve güvenli alan boşluklu.
- Durum: **KAPANDI**. Testler: `tests/phase16-ai-ux.test.ts` ("geri" ve "çalışma ekranından geri").

### BL-46 — Yanlış girilen içeriği temizleme: kaydırıp arşivle + koşullu kalıcı silme
- Bölüm: `07` S11 ("arşivle (silme yok)"), `00` A3 (ham olaylar append-only), A21 (geri kazanılabilirlik), `14` §11/§13 (dokunma ergonomisi).
- Gözlem (2026-09-09): kullanıcı yanlış girilen atomu silmek istedi ("silme yok ki") ve iOS kaydırma hareketi bekliyor.
- Karar: **arşivleme kaydırma hareketiyle erişilebilir** (sola kaydır → Arşivle; arşiv görünümünde → Geri getir). Hareket TEK yol değildir: aynı eylemler atom ekranında düğme olarak durur (erişilebilirlik, masaüstü). Ek olarak **kalıcı silme**, yalnız (a) o atomu işaret eden hiçbir Attempt yoksa (void edilmiş dâhil) ve (b) atoma bağlı soru yoksa mümkündür; aksi hâlde neden silinemediği yazılır. Böylece "silme yok" kuralının amacı (ham geçmişin yetim kalmaması) korunur, kullanıcının gerçek ihtiyacı (yanlışlıkla eklenen içeriği temizlemek) karşılanır.
- Depo: `unarchiveAtom`, `deleteAtomAndHooks` (atom + çengelleri, tek transaction). Ham olay silen bir API YOKTUR.
- Durum: **KAPANDI**. Testler: `tests/phase17-archive-delete.test.ts`.

### BL-12 — Test–faz bağımlılıkları (Yol B) — faz planı onayı
- `09`'daki bazı test atamaları Yol A'da mevcut olan modüllere yaslanır; Yol B'de ileri faz modülü ister. Beş test hiçbir faza atanmamış (U-RS-07, U-RS-08, I-21, E-19, E-20); E-16 iki fazda; iki test kimliksiz (journal birimi, SW statik taraması). Öneri ve gerekçeler §3'te.
- Durum: **KAPANDI** (2026-09-08; bkz. §4).

## 2. Çözülen tutarsızlıklar (bilgi; karar gerekmez)

### BL-01 — `content_unavailable_legacy` revision'ında `createdAt`
- `06` §6.2 pseudo-kodu `createdAt: now` ve `createdAtSource`'suz `legacyProvenance` yazar; `01` §2.5 `createdAt: null` + `createdAtSource: "unknown"` ister; `06` §8.2 "createdAt dolu → red"; `00` v1.6 "legacy sürüm tarihi uydurulmaz". Aynı kural `06` §8.3 `migrateBackup(1→2)` için de geçerli (aksi hâlde B-16 doğrulamada düşer).
- Uygulanan: `createdAt: null`, `legacyProvenance: { migratedAt, fromSchemaVersion: 1, createdAtSource: "unknown" }`. **ÇÖZÜLDÜ** (`01` > `06`; `06` §8.2 aynı yönde).

### BL-02 — Geçmiş kayıtlarında `since` alanı ve `evidencePolicyHistory` kayıt türü
- `06` §7 örnek JSON `{ policyVersion|configVersion, since }`; kural metni "her kaydın `kind`'ı var; `at` tek zaman anahtarı; `since` → `at`". Policy geçmişi için `kind` tanımlanmamış.
- Uygulanan: `{ kind: "config_snapshot", at, configVersion, config }`, `{ kind: "scheduler_migration", at, from, to, reason }`; policy geçmişi de `{ kind: "config_snapshot", at, policyVersion, policy }` (yeni `kind` değeri uydurulmaz). **ÇÖZÜLDÜ** (kural metni > örnek).

### BL-13 — `Question.updatedAt: null` ve `Atom.prompt: ""` ↔ "zorunlu alan eksikliği → red"
- `01` §2.5 `updatedAt` zorunlu, `06` §6.2 migration'da null yazar; `01` §2.3 `prompt` zorunlu ama "boş olan atom yalnız eski veriden gelebilir"; `06` §8.2 zorunlu alan eksikliğini reddeder.
- Uygulanan: tip `updatedAt: string | null` (null yalnız migration'dan), `prompt: string` (boş olabilir; UI "soru yüzü eksik", kuyruğa girmez). Doğrulayıcı bu iki hâli kabul eder; "eksik" = alan hiç yok. **ÇÖZÜLDÜ** (özgül izin cümleleri > genel kural).

### BL-14 — `questionVersion` kaynağı
- `01` §4.2 tablosu "cevap anındaki `Question.currentVersion`", `09` Phase 3 "`questionVersion = currentVersion`" ↔ `01` §4.2a, §6.4, `03` §4.3, I-09, U-RS-08 "sunum anındaki `action.questionVersion`".
- Uygulanan: `action.questionVersion`. **ÇÖZÜLDÜ** (ayrıntılı akış ve testler > tablo hücresi).

### BL-15 — `sequence`'ı kim atar
- `06` §2 `appendAttempt(a)` + `nextSequence()`; `06` §3 sayaç ve olay aynı transaction; I-20 reddedilen çift kayıt sayaç tüketmez; B-01 `nextSequence()` salt gözlem.
- Uygulanan: `appendAttempt/appendVoid` girdi olarak `sequence`'sız kayıt alır, kendi transaction'ında atar ve dondurulmuş kaydı döndürür; `nextSequence()` = `meta.sequence + 1` salt-okur bakış. **ÇÖZÜLDÜ.**

### BL-16 — `meta` yedeğe girer mi
- `06` §1 "meta … yedeğe girer" ↔ `06` §7 format/checksum kapsamında meta yok, "cihaz meta alanları taşınabilir formata girmez", §10 tablo.
- Uygulanan: meta yedeğe girmez. **ÇÖZÜLDÜ** (`06` §7/§10 özgül).

### BL-17 — S6'nın yeri
- `07` §2 tablosu "S6 (S5'in içinde)" ↔ `07` §3/§4 ve E-19: S6 S5'ten ÖNCE, doğru seçenek ve açıklama gizli.
- Uygulanan: S6 ayrı adım, S5'ten önce. **ÇÖZÜLDÜ.**

### BL-18 — `lastExternalBackup* = null` iken Bugün satırı
- `06` §10 tablosu / `07` S1 "Yedek durumu bilinmiyor · Yedek al" ↔ `06` §10 son madde (7 gün / 250 olay eşiği).
- Uygulanan: null ise durum satırı hemen gösterilir (E-21); eşik aşılınca aynı satıra "· N yeni kayıt" eklenir (B-36); işaretçi varsa yalnız eşik kuralı. **ÇÖZÜLDÜ** (yorum).

### BL-19 — v0'da semantik vurgu düzeyi
- `07` §7 kritik bilgi vurgusu ister; `14` §5 v0'da metin düz kalır, span metadata'sı yok.
- Uygulanan: v0'da roller blok düzeyinde (çengel bloğu `memory-hook`, kaynak etiketi `source`, `state-*`, uyarı blokları); kelime düzeyi vurgu yok; V-14/V-15 bu bloklar üzerinden. **ÇÖZÜLDÜ** (`14` §5 özgül v0 cümlesi).

### BL-20 — S3 kırıntısı "i/N"
- `03` rev. 2 oturum snapshot'ını kaldırdı; N tanımsız.
- Uygulanan: `i = answered + 1`, `N = answered + buildQueue(now).length` (tahmin, her öğede yeniden hesaplanır). **ÇÖZÜLDÜ** (yorum).

### BL-21 — Kuyruk sıralama anahtarı
- `03` §3.3 pseudo-kod ve §3.4 kural 6, U-DQ-02, U-SC-15: `(R ASC, due ASC, atomId ASC)` ↔ `03` §3.5, §8 son satır, U-DS-11: "(R, atomId)".
- Uygulanan: `(R ASC, due ASC, atomId ASC)`; "(R, atomId)" kısaltma sayılır. **ÇÖZÜLDÜ** (pseudo-kod + numaralı kural > düzyazı özet).

### BL-22 — U-RB-10 "sahte policyVersion 2" ↔ "bilinmeyen policyVersion → hata"
- Uygulanan: `rebuild`/`applyAttempt` enjekte edilebilir `ratingFor` alır; üretim `ratingFor` v≠1'de hata fırlatır (U-EP-09); U-RB-10 sahte politikayı test enjeksiyonuyla verir. **ÇÖZÜLDÜ.**

### BL-23 — MemoryState'i "yalnız scheduler adaptörü yazar" ↔ `applyAttempt`'ın `lastAttemptKind/lastQuestionId` yazması
- Uygulanan: FSRS alanları (`due`, stability, difficulty, reps, lapses, state, learningSteps, lastReview) yalnız adaptörde; `lastAttemptKind/lastQuestionId` `applyAttempt`'ta (`02` §5.2 6h). A15 ve `due =` kod incelemesi kriteri korunur. **ÇÖZÜLDÜ** (`02` > `01` §6.2 genel ifadesi).

### BL-24 — "15 dakika içinde vadeye düşecek" sayımı ve `06` §3.1 saat eşikleri nerede
- Uygulanan: `src/app` katmanında (due **okur**, yazmaz); `src/engine/**` içinde gün/dakika sabiti yok (U-SC-13c/14 taraması sıkı kalır). Session (`03` §6) engine'dedir, enjekte Clock kullanır, sabit taşımaz. **ÇÖZÜLDÜ.**

### BL-25 — `npm view ts-fsrs version` registry `latest`'i döndürür
- Bugün `latest = 5.4.2` (uyumlu). Bağlayıcı doğrulama U-SC-01 (`node_modules/ts-fsrs/package.json`). **ÇÖZÜLDÜ.**

### BL-26 — `13` §5 adım 1 migration'ı checksum'dan önce yazar
- `06` §8 adım 3–4 ve `13` §5 adım 8, B-31: önce gelen formatın kendi checksum'ı, sonra bellekte migration. `13` kendisi "çelişkide `06` kazanır" der. **ÇÖZÜLDÜ.**

### BL-27 — RestoreJournal açılış çözümlemesi: üçüncü hâl ve `aborted` pin'i
- `06` §8.5 yalnız iki hâl tanımlar; adım 11 (appliedJobId) ile 12 (phase committed) arasındaki çökmede `phase = prepared, appliedJobId = jobId` kalır. `06` §9 pin yalnız `verified/rolled_back`'te kalkar; `aborted` işin ön noktası sonsuza dek pin'li kalır.
- Uygulanan: `meta.appliedJobId = jobId` ise phase ne olursa olsun commit olmuş sayılır → `committed` yazılır, adım 13–14 (BL-07 varsayılanıyla) koşulur; `appliedJobId = jobId + ":rollback"` → `rolled_back`; pin `verified/rolled_back/aborted` üçünde kalkar. **ÇÖZÜLDÜ** (yorum; B-33 "yarım iş tamamlanmış sayılmaz" korunur).

### BL-28 — Geri yükleme sonrası `generationStartSequence`
- `06` §3 "nesil başladığındaki sayaç" ↔ `06` §10 tablo "sıfırlanır/yeniden üretilir".
- Uygulanan: `generationStartSequence` = `replaceAll` sonrası kurulan sayaç (paketin max sequence'ı; boş pakette 0); `generationId` yeniden üretilir. **ÇÖZÜLDÜ** (`06` §3 tanım > §10 özet).

### BL-29 — Acil geri dönüşün başarısı ve journal yazımı (B-32)
- Uygulanan: acil geri dönüşün başarısı ana DB'nin doğrulanmasıyla ölçülür; journal/pin güncellemesi yazılamazsa geri dönüş yine başarılı sayılır, journal bir sonraki açılışta `appliedJobId = jobId + ":rollback"` görülerek `rolled_back`'e tamamlanır (BL-27). B-32 mock'u journal yazmalarını başarı koşulundan ayırır. **ÇÖZÜLDÜ.**

### BL-30 — `daily` retention: 7 mi, 50.000 Attempt'ta 3 mü
- Uygulanan: v0'da `RecoveryStore` retention sınırları config parametresidir (`daily: 7`, işlem sınıfı 5, toplam 12); 50.000 eşiğinde otomatik düşürme yazılmaz (ölçüsü tanımsız; A20). **ÇÖZÜLDÜ** (minimum).

### BL-31 — `lastExternalBackupGenerationId` okuma kuralı
- Uygulanan: hatırlatma hesabında veya geç `Kaydettim` teyidinde `lastExternalBackupGenerationId ≠ meta.generationId` ise işaretçi null sayılır; farklı nesle ait teyit uygulanmaz. Negatif fark üretilemez (B-36). **ÇÖZÜLDÜ.**

### BL-32 — Dexie daha yeni sürümlü DB'yi sessizce dinamik modda açar
- `13` §6.5 / `06` §6.3 "daha yeni şemalı DB açılırsa uygulama yazmaz" `open()` hatasına güvenirse hiç tetiklenmez (Dexie 4 VersionError'da dinamik moda düşer).
- Uygulanan: açılıştan hemen sonra `db.verno` ve `meta.schemaVersion` desteklenen aralıkla karşılaştırılır; yüksekse bağlantı kapatılır, yazma yok, salt-okunur kurtarma ekranı + RecoveryReader (B-37). **ÇÖZÜLDÜ** (gerçekleştirim notu).

### BL-33 — E-10 "Yedek alındı." jsdom'da
- Web `BackupFileService` jsdom'da (ve iki telefonda da) en fazla `initiated` döndürebilir; "Yedek alındı." yalnız `saved`.
- Uygulanan: E-10 kompozisyon kökünden `saved` döndüren sahte `BackupFileService` enjekte eder (A-04 PlatformServices sahteleri); E-21 her iki dalı gerçek metinlerle sınar. **ÇÖZÜLDÜ.**

### BL-34 — Vitest jsdom ortamında Web Crypto realm uyuşmazlığı
- Uygulanan: web `HashService` daima `TextEncoder().encode(kanonikJSON)` baytlarını hash'ler (Blob/File buffer'ı değil); E testleri gerekirse Node `crypto` tabanlı HashService enjekte eder (A-04). **ÇÖZÜLDÜ** (gerçekleştirim notu).

### BL-35 — SW tam varlık manifesti Vite'ta hazır gelmez
- `13` §7 build başına tam varlık listesi + `buildId` ister; Vite `build.manifest` index.html ve `public/` ikonlarını içermez, SW'ye görünmez.
- Uygulanan (Phase 11): küçük yerel Vite eklentisi (`generateBundle`/`writeBundle`) bundle anahtarları + public varlıkları + `buildId`'yi `sw.js`'e enjekte eder; SW dosya adı sabit (`sw.js`). Ek paket yok. **ÇÖZÜLDÜ** (gerçekleştirim notu).

### BL-37 — Migration 1→2 pseudo-kodu QuestionAtom(primary) üretmez
- Bölüm: `06` §6.2 (upgrade pseudo-kodu yalnız questions/attempts/revisions dokunur) ↔ `01` §2.7 ("her sorunun tam olarak bir primary kaydı vardır") ↔ `06` §8.2 ("QuestionAtom(primary) eksik veya farklı → red").
- Gözlem (kodda yakalandı, 2026-09-08): eski veride questionAtoms tablosu boşsa migrate edilmiş DB'den alınan yedek doğrulamada reddedilir.
- Uygulanan: hem Dexie migration'ı hem `migrateBackup(1→2)` her soru için güncel `primaryAtomId`'den primary satırını garanti eder (mevcut satırlara dokunmaz). **ÇÖZÜLDÜ** (`01` §2.7 değişmezi).

## 3. Test–faz eşlemesi (Yol B) — onaylandı ve uygulandı (BL-12)

İlke: her test kimliğinin **tek sahip fazı** vardır ve orada tümüyle yeşillenir; bir testin bir cümlesi ileri faz modülü istiyorsa o cümle ileri fazda **aynı test dosyasına eklenir** (test gevşetilmez, mock ile yeşil ilan edilmez). Aşağıda yalnız `09`'dan sapmalar gerekçeli; sapma olmayan atamalar `09` ile aynıdır.

| Test | `09` fazı | Yol B'de eksik modül | Önerilen sahip faz |
|---|---|---|---|
| I-04 | 3 | MemoryState üretimi (policy + scheduler + applyAttempt) | **6** |
| I-12 | 3 | `ratingFor` (rating 2) | **4** |
| I-22 | 3 | scheduler + REBUILD; Bugün/Veri DOM | **8b** (motor) · DOM cümlesi **9** |
| I-14 | 2 | "REBUILD eşit" | **2** (depo, sayaç) · REBUILD cümlesi **6** |
| I-17 | 2 | "REBUILD migration öncesiyle eşit" | **2** (migration) · REBUILD cümlesi **6** |
| U-QR-10 | 2 | serializeMemory eşitliği | **6** |
| U-QR-09 | 2 | UI mesajı | **2** (depo/API) · UI cümlesi **9** (E-17) |
| U-QR-11 | 2 | `validateBackup` (B-05b) | **2** (API kısmı) · doğrulama cümlesi **10a** (B-05b) |
| U-QR-12 | 8 | — (migration testi; UI + REBUILD cümleleri) | **2** · REBUILD **6** · UI **9** |
| B-26 | 2 | post_migration noktası için §7 yedek üretici (resolvedWeights, format 2) | **2** (rollback: DB v1 okunabilir kalır) · post_migration cümlesi **10b** |
| B-37 | 2 | `migrateBackup`, normal geri yükleme | **2** (şema tanımsız açılış, DB değişmez, `recovery_dump`) · kalan cümleler **10a/10c** |
| B-25 | 1b | Repository, B-01 tur | **1b** (kanonik JSON + checksum sıra bağımsız) · "B-01 eşitliği" **10c** |
| B-34 | 1b | geri yükleme iş akışı | **1b** (pin ilkeli: pin'li kayıt silinmez, pin kalkınca silinir) · tam iş akışı **10b** |
| E-16 | 7 ve 9 | UI | **9** (Phase 7'de U-DS-01 aynı iddiayı motorda doğrular) |
| U-DQ-14 | 7 | Bugün metni, ayar doğrulaması | **7** (motor: `max(0,…)`, QueueConfig doğrulama) · ekran metni **9** |
| U-DS-07/12 | 7 | `resolve()` (Phase 8) | **7**: `Session.nextItem` öğeyi döndürür; `resolve` bağlantısı Phase 8'de eklenir |
| U-SC-11 | 5 | "export'ta" (yedek) | **5** (`resolvedWeights` fonksiyonu 21 sayı) · export cümlesi **10a** |
| U-SC-15 | 5 | kuyruk ikinci anahtarı | **5** (R=1) · kuyruk cümlesi = U-DQ-02 (**7**) |
| I-06 | 8b | format-2 yedek üretici, geri yükleme | **10a** (motor çekirdeği: snapshot → yedek → doğrula → boş MemoryRepository.replaceAll → REBUILD eşit) |
| A-04 | 8b | BackupFileService akışları | **8b** (HashService sahtesi) · BackupFileService sahtesi **10a** |
| I-18 | 8b | commit sonrası REBUILD | **8b** (`validateBackup` uyarı + `dryRunRebuild` paket config'iyle) · commit eşitliği = B-18 (**10c**) |
| E-12 | 9 | S12'nin üç yedek/kurtarma bölümü (10c) | **10c** (Phase 9'da yalnız Motor bölümü + sürüm satırı yapılır, E-12 iddia edilmez) |
| U-RS-07, U-RS-08 | — | — | **8** |
| I-21 | — | — | **8b** |
| E-19, E-20 | — | — | **9** |
| journal yaz/oku (kimliksiz) | 1b | — | **1b**, yerel ad `RJ-01` |
| SW statik tarama (kimliksiz) | 11 | — | **11**, yerel ad `A-SW-01` |
| B-11, B-12, B-14 | 10 (10b kapısı) | geri yükleme orkestrasyonu | **10b**: `safeRestore` motor orkestrasyonu (adım 1–15, journal dâhil) UI'sız yazılır; yıkıcı düğme **10c**'de açılır |

İki fazda geçen modüllerin sahibi: `snapshotAll` → 2 (1b yalnız kanonik JSON + HashService + RecoveryStore + journal kaydı) · `reviseQuestion` transaction iskeleti → 2, seçenek/ilişki temizleme kuralları → 8 · `createQuestion` (addQuestion) → 2 · `answerQuestion/answerRecall` kurulumu → 3 · Session + geri al tekrarı → 7 · `validateBackup/migrateBackup/dryRunRebuild` saf fonksiyonlar → 8b (asgari), format/checksum/dosya adı ve sert doğrulama → 10a · açılış orkestrasyonu (aç → migrate → REBUILD) → 8b, journal çözümleme → 10c · manifest/iOS meta → 9, service worker → 11.

Faz başına nihai liste Phase 0 raporunda (kullanıcı onayı sonrası `BASELINE_AUDIT.md` §6'ya işlenir).

## 4. Kapanan maddeler

### BL-03 — Node.js makinede kurulu değildi
- winget `OpenJS.NodeJS.LTS` kullanıcı onayıyla kuruldu (v24.19.0, npm 11.17.0). **KAPANDI** (2026-09-08).

### BL-12 — Test–faz eşlemesi
- §3'teki eşleme kullanıcı onayıyla uygulandı; her test kimliği tek sahip fazında yeşillendi (Phase 1–11 commit mesajları). **KAPANDI** (2026-09-08).
