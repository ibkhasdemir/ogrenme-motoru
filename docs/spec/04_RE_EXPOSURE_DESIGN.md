# 04_RE_EXPOSURE_DESIGN.md — Re-Exposure Tasarımı (v0 dışı, veri toplama v0 içi)

Referans: `00_ANAYASA.md` A12–A16. Bu dosya bir **tasarım** belgesidir; v0 çekirdeğine yalnız §9'daki veri toplama girer. Buradaki mekanizmaların hiçbiri v0'da uygulanmaz.

## 1. Amaç

Tekrarın amacı aynı içeriği yeniden göstermek değil, aynı bilgi atomuna **farklı bir bilişsel işlemle** ve **farklı bir destekle** yeniden erişim sağlamaktır. Bilgi öğrenildiği ipucuyla geri gelir; tek ipucuna bağlı hafıza, o ipucu sınavda yoksa çöker. Hedef: ipucusuz, bağlamdan bağımsız erişim (A13).

Model: aynı bilgi beynin ayrı bölgelerinde ayrı kopyalar olarak durmaz; farklı işlemler aynı hafıza izine farklı erişim yolları açar. İşlemler birbirinin yedeği değil, tamamlayıcısıdır. "Biri tutmazsa öbürü tutar" değil; "kanca sayısı arttıkça iz kopmaz."

## 2. Sorumluluk ayrımı

| Soru | Cevaplayan |
|---|---|
| Ne zaman? | FSRS (`02`) |
| Hangi atom? | DailyQueue (`03`) |
| **Nasıl** sınayalım? | **Re-Exposure** (bu dosya) |
| Hangi somut soru/kart? | Resolver (`03` §4) |

Re-Exposure, Resolver'a "bu atom için şu (operation, support) çiftini tercih et" der; **vadeye dokunmaz** (A16), ekstra tekrar üretmez, kuyruğa atom eklemez. v0'da Resolver'ın tek kuralı (soru ↔ kart dönüşümü) Re-Exposure'ın en ilkel hâlidir.

## 3. Üç sözlük — başka taksonomi yok

**facet** — bu atom ne tür bilgi? Bir atomda birden fazla olabilir.
`fact, date, chronology, definition, cause_effect, process, comparison, spatial, rule, exception`

**operation** — kullanıcıdan hangi zihinsel işlem istendi?
`recall` kendin söyle · `explain` başkasına anlat · `contrast` benzerinden ayır · `reverse` tersinden düşün · `apply` yeni duruma uygula · `detect` cümledeki hatayı bul · `connect` başka bilgiye bağla · `generate` soru/tuzak üret · `order` sırala · `discriminate` şıklardan seç

**support** — cevaptan önce ne kadar yardım verildi?
`none, cue, hook, visual, timeline, choices, partial`

Bunların dışında "route", "exposure vector", "memory path", "kılık" gibi sözlükler **tanımlanmaz**. Görsel vurgu (semantik renk/tipografi, `14`) ayrı bir support değeri değildir: cevaptan önce gösteriliyorsa `cue`, cevaptan sonra gösteriliyorsa ölçüme girmez (`14` §10). Her yeni fikir bu üçlünün bir bileşimi olarak ifade edilir; ifade edilemiyorsa fikir olgunlaşmamıştır.

## 4. Mekanizmalar (hepsi üçlü üzerinden)

### 4.1 Re-Exposure (temel kural)
Bir atom vadeye düştüğünde Resolver, son K exposure'da (varsayılan K = 3) kullanılmış `(operation, support)` çiftini seçmez; facet'e uygun (§5) çiftler arasından en az kullanılmış olanı önerir. İçerik yoksa §6'daki ücretsiz işlemlere düşer.

### 4.2 Recognition ↔ active recall ayrımı
Tanıma ağırlıklı: `discriminate + choices`, `detect`, `partial`. Üretim ağırlıklı: `recall + none`, `explain`, `generate`, `reverse`, `apply`. Çoktan seçmeli soru **hafıza kanıtı olarak zayıf** kabul edilir; sınav formatı olduğu için hız ve tuzak antrenmanı olarak ayrıca değerlidir. İki hedef, iki sayaç (Coverage §7).

### 4.3 Familiarity Trap (tanıma doygunluğu)
"Bunu gördüm, biliyorum" hissi. Bir atom art arda N (varsayılan 2) tanıma ağırlıklı çiftle ölçüldüyse sonraki exposure **zorunlu** `recall + none` veya `explain + none`. Kullanıcı "ben bunu biliyorum" derse cevap: "O zaman söyle."

### 4.4 Support Fading / Bridge Mode
Güçlü erişim yolunu kullanarak zayıf yolu inşa etmek. Bir atom `visual` destekle hatırlanıyor ama `none` ile hatırlanamıyorsa: `visual → cue → none`, ardından `explain`. Ayrı kavram değildir; `support`'un kademeli sıfırlanmasıdır.

Yeni atomun doğal dizisi: iz bırak (`hook`, `visual`) → eksilt (`partial`) → gizle (`none`) → bağlam değiştir (§4.5) → tuzak koy (`contrast`) → transfer (`apply`, `connect`).

### 4.5 Context Rotation (aynı atom, farklı bağlam)
Aynı atom farklı çerçevede: düz soru → senaryo → "arkadaşın şöyle dedi" → yanlış gazete cümlesini düzelt → çıkmış soru. Operation aynı kalabilir (`apply`), bağlam metni değişir. "Kitap cümlesi içinde tanıyorum" durumundan çıkarır. Bağlam üretimi çoğunlukla LLM ister (§6.3).

### 4.6 Misconception Repair (yanlış + emin)
Bilgi eksik değil, yanlış model var (A8). Protokol: sen ne düşündün → doğrusu ne → ayrım nerede → neden yanlış düşünmüş olabilirsin (confusable atomu göster) → `reverse` → iki gün sonra farklı bağlamda `apply`. Düzeltilen emin yanlışlar en iyi hatırlanan bilgiler olur (hypercorrection); buraya yüklenmek değer.

### 4.7 Rescue Mode (A14'ün ilk uygulaması)
Tetik adayı: aynı atomda 2 Again + 1 Hard, veya 1 yanlış+emin. (Anki'nin leech eşiği olan 8 çok geçtir.)
İlk iş soru göstermek değil: o atomun `wrongReason` ve `(operation, support)` geçmişine bakmak. Sorular: önkoşul eksik mi (AtomRelation.prerequisite)? karıştırma mı (confusable)? atom fazla büyük mü (bölünmeli, A10)? açıklama kötü mü? çengel işe yaramıyor mu?
Müdahale: atomu parçala → mantığı göster → confusable getir → yeni çengel → **denenmemiş** (operation, support) → kolay → zor. Hangi değişiklikten sonra başarı geldiği Attempt'larda zaten kayıtlıdır; ileride kişisel reçeteyi besler.

### 4.8 Same atom / different cognitive operation
Atom "Karadeniz'de dağlar kıyıya paralel uzanır → kıyı-iç ulaşım zor":
`recall` (etkisi ne?) · `reverse` (dik uzansaydı?) · `contrast` (Ege'den farkı?) · `apply` (yeni bir kıyıda paralel dağ görürsen?) · `detect` ("...ulaşım kolaydır" — hata nerede?) · `explain` (coğrafya bilmeyene tek cümle) · `generate` (ÖSYM buradan nasıl tuzak kurar?) · `connect` (nüfus dağılışıyla bağı?). Aynı atom sekiz kez gelir, sekiz kez farklı iş yapılır.

### 4.9 Repeated failure → method change
A14'ün genel hâli: aynı `(operation, support)` çiftinde ardışık başarısızlık, aynı çiftin daha sık tekrarına değil, farklı çifte yol açar. Sıklığı FSRS belirler; **biçimi** bu katman değiştirir.

## 5. Facet → uygun işlemler

| facet | uygun | anlamsız |
|---|---|---|
| date | recall, order, contrast, connect, detect, discriminate | apply, reverse |
| chronology | order, recall, connect | apply |
| fact | recall, detect, discriminate, connect | reverse |
| definition | recall, explain, contrast, detect | order |
| cause_effect | explain, reverse, apply, recall | order |
| process | order, explain, apply | reverse |
| comparison | contrast, detect, discriminate | reverse |
| spatial | recall (harita), connect, apply | order |
| rule / exception | apply, detect, contrast | order |

LLM soru üretirken bu tablo filtredir: tarihe "uygulama sorusu" üretilmez.

## 6. İçerik maliyeti

**6.1 Sıfır maliyet (içerik gerektirmez):** `recall` (hatırlama kartı), `explain` (kaynak kapalı anlat), `generate` (kullanıcı soru yazar), çengel hatırlama.
**6.2 Yapısal veri varsa bedava:** `contrast` (AtomRelation.confusable varsa iki atom yan yana, sonra gizle) · `reverse` (Atom.why doluysa "tersi olsaydı?" şablonu) · `order` (chronology ilişkisi varsa) · önkoşul zinciri (prerequisite varsa).
**6.3 Yapay zekâ ile üretilecek:** uygulama sorusu, tuzak, senaryo, hata bulma cümlesi, analoji, karşı örnek, bağlam değiştirilmiş soru. Hepsi öneridir; kullanıcı onaylar (A18).

Coverage 6.1 ile bedavaya başlar.

## 7. Coverage projeksiyonları

**Operation Coverage:** atom başına `operation → { attempts, successes, lastAt }`.
**Support Coverage:** atom başına `support → { attempts, successes, lastAt }`.
İkisi de Attempt'lar üstünde projeksiyon; ayrı ham tablo değildir; REBUILD gibi yeniden üretilir.

Hafıza gücü (FSRS retrievability) ile öğrenme kapsamı (Coverage) ayrı kavramlardır. Tek "Mastery Score" yerine vektör: "tarihini biliyorsun, mantığını biliyorsun, Islahat'tan ayıramıyorsun." Re-Exposure kararı: hafıza iyi ama coverage eksik → yeni operation.

İkinci bir mastery/scheduler sistemi kurulmaz; "3 kılık + 2 gün + son 2 Good" gibi oyun kuralları **yoktur**.

## 8. Kişisel yöntem çıkarımı (en son)

Hedef "Kaan görsel öğrenir" gibi etiket değil; "date+chronology atomlarında `timeline` desteğinden sonra `recall + none` başarısı daha hızlı yükseliyor" gibi facet × (operation, support) × başarı ilişkisi. Öğrenme stili etiketlerinin deneysel karşılığı yoktur; atom türü bazlı ölçüm vardır.

Veri iştahı: ~10 facet × 10 operation × 7 support = 700 hücre; günde 50 Attempt ile çoğu hücre aylarca boş kalır. Bu yüzden **v0 yalnız etiketler, çıkarım yapmaz.** Collect now, infer later (A12).

## 8a. M3+'tan önce çözülmesi gereken açık noktalar (ikinci dış inceleme F04–F06; tasarım notu)
- **F04 — hangi çengel:** bugünkü Attempt yalnız `support = hook` yazar; hangi MemoryHook'un hangi içerik sürümünün gösterildiği yoktur ve MemoryHook düzenlenebilir. "Hangi değişiklikten sonra başarı geldiği kayıtlıdır" iddiası bu ayrıntı için **doğru değildir**. Yöntem bazlı çıkarım (§8) hedefleniyorsa gösterilen çengel kimliği + içerik snapshot'ı (veya hook sürümü) Attempt'a otomatik yazılmalı; tutulmayan geçmiş için çıkarım vaadi daraltılır, sonradan doldurulmaz. Bu kayıtlar nedensel etkinlik kanıtı değildir.
- **F05 — gizli zamanlayıcı yok:** "iki gün sonra farklı bağlamda apply", "ertesi gün confusable" gibi ifadeler takvim değildir: "atom FSRS tarafından uygun olduğunda **sonraki sunum biçimi**" olarak okunur (A15). Takvime bağlı eğitim gösterimi isteniyorsa ölçüm üretip üretmediği ve A15 istisnası ayrıca karara bağlanır; vadesi gelmemiş atom onarım kuralıyla sessizce review üretmez.
- **F06 — çeşitlilik kuralı kilitlemez:** sıra: önce içerik + facet uygunluğu (§5–6), sonra yöntem tercihi (§4.1); son K=3 dışlaması aday bırakmıyorsa kontrollü gevşetme: K=2 → K=1 → en az kullanılan çift. Çoklu facet'te uygun işlem kümesi **birleşim**, anlamsız kümesi **kesişim** alınır. Gerçekten sunulabilir atom çeşitlilik kuralı yüzünden hiçbir zaman kilitlenmez; deterministik geri düşme test edilir.

## 9. v0'a giren tek şey

- Her Attempt'a `operation` ve `support` otomatik yazılır (`01` §4.1). Kullanıcıya sorulmaz.
- Atom'a `facets` girilir (varsayılan `["fact"]`).
- Resolver'ın soru ↔ kart dönüşümü (`03` §4.2).

Bunun dışında bu dosyadaki hiçbir şey v0'da kodlanmaz. `10_V0_NON_GOALS.md`.
