# 14_VISUAL_LEARNING_DESIGN.md — Görsel Öğrenme Tasarımı

Referans: `00_ANAYASA.md` A12, A13, A22; `04_RE_EXPOSURE_DESIGN.md` §3 (support); `07_UI_FLOW_V0.md` §1.1, §7; `10` (görsel non-goal'lar); `11` kural 37–41. Bu dosya UI katmanını bağlar; domain ve motor bu dosyadaki hiçbir kavramı bilmez.

## 1. Tasarım ilkesi

Arayüz "dershane sitesi" veya klasik soru bankası gibi görünmez. Modern, temiz, sakin ve premium his; minimal chrome, güçlü içerik hiyerarşisi, ölçülü yüzeyler, büyük rahat dokunmatik alanlar. Referans zihniyeti modern iOS uygulamalarının ferahlığı ve modern Android/Material'in dokunma ergonomisidir; ikisi de **kopyalanmaz**, kendi tutarlı sistemimiz kurulur.

Öncelik sırası: **öğrenilebilirlik > okunabilirlik > ergonomi > estetik > süs.** Bir karar bu sırayı bozuyorsa yanlıştır.

Amaç yalnız güzel görünmek değil: telefonda uzun kullanımda yormamak; renk, tipografi, boşluk ve hiyerarşiyi **hafıza ipucu** olarak kullanmak; PWA'da native his vermek; ileride Capacitor kabuğuna geçince aynı tasarım sistemini korumak.

## 2. Renk dekorasyon değil, semantik ipucudur

Renklerin öğrenmeyi sihirli biçimde artırdığı varsayılmaz. Ama **tutarlı** renk kodları dikkat çekme, bilgi gruplama, ayırt etme, çağrışım ve tekrar sırasında görsel tanıma için işe yarar. Ana kural: **aynı semantik anlam, mümkün olduğunca aynı görsel dil.**

Semantik görsel roller (UI katmanı; domain bilmez):

| Rol | Kullanım |
|---|---|
| `primary-fact` | atomun ana önermesi |
| `date` | tarih/zaman ("23 Nisan 1920") |
| `entity` | kişi, kurum, antlaşma ("TBMM", "Lozan") |
| `place` | konum, bölge |
| `cause` / `consequence` | sebep-sonuç uçları |
| `exception` | istisna, "hariç", "düzenlenemez" |
| `warning` | sınav uyarısı, sık hata |
| `misconception` | yanlış+emin düzeltmesi |
| `confusable` | karıştırılan kavram çifti |
| `memory-hook` | çengel bloğu |
| `source` | kaynak / çıkmış soru etiketi |
| `state-correct` / `state-incorrect` / `state-uncertain` | cevap sonucu ve güven |

Gerçek renk değerleri **tasarım token'larında** durur (§7); domain `exception` bilir, `#FF5733` bilmez. Bugün seçilen hex'ler değişebilir; rol adları değişmez.

## 3. Renk tutarlılığı ve ölçüm ayrımı

- Bir bilgi sınıfının görsel muamelesi ekranlar arasında rastgele değişmez: tarih vurgusu okuma ekranında, hatırlama kartı cevabında, sonuç açıklamasında ve ileride Re-Exposure görünümünde aynı token'la gelir.
- **Öğrenme ipucu ile sınav ölçümü ayrılır.** Cevap açıklanmadan önce: doğru seçenek yeşil görünmez; yanlış seçenek kırmızı görünmez; `exception`/`warning` gibi roller soru gövdesinde veya seçeneklerde cevabı ele verecek biçimde kullanılmaz. Soru ekranı (S3) ve hatırlama kartının prompt yüzü (S7, cevap açılmadan) **nötr moddadır** (§10).

## 4. Kritik bilgi için tipografik vurgu

Kritik parçalar gerektiğinde ağırlık, boyut, harf aralığı, italik, alt çizgi, kapsül/arka plan vurgusu ve rengin **sınırlı** bileşimiyle vurgulanır. Aynı ekranda en fazla 2–3 vurgu rolü aynı anda; aksi hâlde vurgu yok demektir.

Örnek — okuma görünümü: "**TBMM** (`entity`) **23 Nisan 1920**'de (`date`) açıldı (gövde)." İstisna örneği: "…temel haklar (`exception`) Cumhurbaşkanlığı kararnamesiyle **düzenlenemez** (`exception`)." Uzun metinde ALL CAPS yasak; tek kelimelik istisna vurgusu için kapsül tercih edilir.

## 5. Semantik metin vurgusu (Semantic Text Emphasis)

Sınırlı bir vurgu sistemi, UI katmanında. Roller: `key, date, entity, place, cause, consequence, exception, warning, trap, comparison, mnemonic`.

v0'da en basit yapı: atom ve soru metinleri düz metin kalır; isteğe bağlı vurgu metadata'sı ileride eklenir. Kabul edilir asgari mimari: metin render'ı tek bir `renderText(text, spans?)` bileşeninden geçer; `spans` boşsa düz metin basılır. Böylece gelecekte `{ start, end, role }` dizisi eklemek render katmanını değiştirmez, domain'i hiç değiştirmez (vurgu metadata'sı içerik varlığının isteğe bağlı alanı olur, semantik anlam değil sunum notu olduğundan sürüm üretmez).

Rich text editör **yazılmaz**; işaretleme ileride seçili metne rol atama kadar basit olabilir.

## 6. Tipografi

- Platformun doğal yazı tipi: iOS'ta sistem yığını (SF), Android'de Roboto/sistem, masaüstünde sistem sans. Özel yazı tipi dosyasına zorunlu bağımlılık yok; okuma metni için sistem serif isteğe bağlı ve token'la seçilebilir.
- Ölçek (token adları; değerler `rem`, sistem yazı boyutuyla ölçeklenir):

| Token | Rol | Örnek boyut / satır |
|---|---|---|
| `type.display` | Bugün başlığı, sonuç "Doğru." | 30/36 |
| `type.title` | sayfa başlığı | 24/30 |
| `type.section` | bölüm başlığı | 19/26 |
| `type.question` | soru metni, atom metni, prompt | 21/30 |
| `type.body` | açıklama, neden/nasıl | 17/26 |
| `type.support` | yardımcı metin | 15/22 |
| `type.meta` | kırıntı, tarih, sayaç | 13/18 |
| `type.button` | düğme | 17/24 |
| `type.micro` | çip, rozet benzeri küçük etiket | 13/16 |

- Soru ve ana bilgi metni küçük yazılmaz (`type.question` altına düşmez). Satır uzunluğu < 80 karakter; telefonda uzun okumaya uygun satır yüksekliği (≥ 1.4).
- Dinamik yazı boyutu: kullanıcı sistem yazısını büyüttüğünde düzen parçalanmaz (V-06); sabit yükseklikli kutular yok, düğmeler içeriğe göre büyür.

## 7. Tasarım token sistemi

Renk ve boyut değerleri bileşen içine dağınık hard-code edilmez. Token yapısı (CSS custom properties; ileride native tema dosyasına aynı adlarla aktarılabilir):

- **Color:** `color.background`, `color.surface`, `color.surfaceElevated`, `color.textPrimary`, `color.textSecondary`, `color.border`, `color.accent`, `color.success`, `color.error`, `color.warning`, ve semantik hafıza renkleri `memory.date`, `memory.entity`, `memory.place`, `memory.cause`, `memory.consequence`, `memory.exception`, `memory.warning`, `memory.misconception`, `memory.confusable`, `memory.hook`, `memory.source`, `state.correct`, `state.incorrect`, `state.uncertain`.
- **Spacing:** `space.1 … space.8` (4, 8, 12, 16, 20, 24, 32, 40 px sınıfı).
- **Radius:** `radius.sm` (kapsül/çip), `radius.md` (düğme, seçenek), `radius.lg` (sheet). Her şeye aynı yarıçap değil; hiyerarşi.
- **Typography:** §6 tabloları; `weight.regular/medium/semibold`.
- **Elevation:** en fazla iki seviye (`elev.0` düz, `elev.1` sheet/modal); gölge süs olarak kullanılmaz.
- **Motion:** `motion.fast` (120–160 ms), `motion.base` (200–240 ms), `motion.easing`; hepsi `prefers-reduced-motion` ile sıfırlanır.

Bu token sistemi PWA ve ileride Capacitor kabuğunun **ortak** görsel kaynağıdır. Bileşenler yalnız token adı bilir.

## 8. Light / Dark mode

Token sistemi baştan iki tema taşır (`[data-theme=light|dark]`, varsayılan `prefers-color-scheme`). Karanlık modda semantik rollerin **anlamı** korunur; aynı hex zorlanmaz; kontrast, okunabilirlik ve doygunluk yeniden ayarlanır (koyu zeminde doygun kırmızı/yeşil kısılır). Test: V-04, V-05.

## 9. Erişilebilirlik

- **Renk asla tek taşıyıcı değildir.** Hata: kırmızı + ikon + "Yanlış." metni + kenarlık. Tarih vurgusu: renk + ağırlık/kapsül. Renk körlüğünde kritik anlam kaybolmaz (V-10, V-14).
- Kontrast en az WCAG AA (metin 4.5:1, büyük metin 3:1); semantik vurgular da bu eşiği geçer.
- Dokunma hedefleri 44–48 px sınıfı; kritik eylemler bitişik değil (`07` §1.1).
- Görünür klavye/odak halkası; ekran okuyucu için seçeneklerde durum metni ("seçili", "doğru", "yanlış").
- `prefers-reduced-motion`, `prefers-color-scheme`, sistem yazı boyutu desteklenir.

## 10. Öğrenme modu ↔ ölçüm modu

**Öğrenme modu** (S2 okuma, S5 sonuç açıklaması, S7 cevap açıldıktan sonra, S11 içerik): semantik renkler, vurgular, çengel bloğu, tarih vurgusu, sebep/sonuç ayrımı, ileride zaman çizgisi ve ilişkiler serbesttir.

**Ölçüm modu** (S3 soru gövdesi ve seçenekler, S4 güven, S7 prompt yüzü): cevabı ele verebilecek her görsel yardım kaldırılır; metin nötr token'larla basılır; seçenekler yalnız "seçili/seçili değil" durumunu gösterir.

**Support modeliyle bağ (`04` §3):** `support`, cevaptan **önce** verilen yardımdır. Ölçüm modunda semantik vurgu gösterilmediğinden mevcut `support` değerleri (`none/cue/hook/visual/timeline/choices/partial`) yeterlidir; "visual emphasis" diye yeni bir support değeri **eklenmez**. Cevap sonrası vurgular support'u etkilemez (ölçüm bitmiştir). İleride prompt yüzünde bilinçli olarak vurgulu ipucu gösterilirse bu `cue`'dur; taksonomi genişlemez. Görsel destek ile FSRS zamanlaması hiçbir yerde karışmaz.

## 11. Görsel hafıza istikrarı

Öğrenme ekranlarında yapı istikrarlıdır: soru hep aynı bölgede, seçenekler/cevap alanı aynı bölgede, açıklama aynı yerde, çengel aynı blok ailesinde, kritik uyarı aynı muameleyle. Re-Exposure içeriğin bağlamını değiştirebilir; UI'nın temel navigasyonu ve yerleşimi rastgele değişmez. Hedef: **istikrar + kontrollü çeşitlilik.**

## 12. Soru ekranı (S3–S6)

En çok görülen ekran. Dikkat dağıtıcı navigasyon minimum (yalnız kırıntı ve "Bugün'e dön"); soru `type.question`; seçenekler tam genişlik dokunma kartları (`radius.md`, `space.3` iç boşluk, aralarında `space.2`); seçili durum kenarlık + ikonla, renk sonucu **yok**; Cevapla ekranın alt yarısında. Cevap sonrası: sonuç `type.display` + ikon + renk; doğru seçenek `state.correct`, seçilen yanlış `state.incorrect`; açıklamada atom parçaları semantik vurguyla. Güven ekranı üç büyük düğme, tek dokunuş. Yanlış nedeni dört çip, form yok. Tek elle kullanım: birincil eylem alt yarıda.

## 13. Hatırlama kartı (S7)

Prompt yüzü temiz ve nötr: prompt `type.question`, yardımcı metin `type.support`; cevap görünmez. Sıra: gör → düşün → (isteğe bağlı çengel) → cevabı aç. Cevap açılınca kritik kelimeler, tarih, istisna ve çengel semantik vurguyla (öğrenme modu). Çengel gösterildiyse `support = hook` kaydı zaten motorda; UI yalnız gerçeği yansıtır.

## 14. Hareket

Süs değil. Kullanılabilir yerler: cevap geri bildirimi (sonuç metninin belirmesi), kart geçişi (kısa çapraz solma), doğru/yanlış durum değişimi, yeni içeriğin açılması (cevabı aç), sheet/modal, geri yükleme ilerlemesi. `motion.fast/base`; platforma uygun sakin easing. Yasak: bounce, konfeti, sürekli hareket, oyunlaştırma animasyonu. `prefers-reduced-motion` tümünü kapatır.

## 15. Haptics

PWA'da zorunlu değil (Web Vibration sınırlı). İleride Capacitor kabuğunda doğru / yanlış / önemli eylem için hafif dokunsal geri bildirim `PlatformServices.HapticsService` üzerinden (`06` §11). Motor haptics'i bilmez; UI, sonuç ekranına geçerken servisi çağırır; servis yoksa sessizce atlanır.

## 16. Modern iOS / Android hissi

Tek platform taklit edilmez; ortak modern mobil sistem. iOS'ta safe-area, ana gösterge, doğal kaydırma, büyük başlık/sheet alışkanlığına uyum. Android'de sistem geri davranışı, dokunma ergonomisi, gezinme alanı, uygun bottom-sheet/diyalog davranışı. Native kabuğa geçince platform uyarlaması (sheet stili, geri hareketi) kabuk katmanında yapılır; token ve bileşenler aynı kalır.

## 17. Navigasyon

`07` §6: v0'da alt sekme çubuğu gerekmez; ileride en fazla dört alan (Bugün · İçerik · Yakala · Ayarlar). Çalışma sırasında navigasyon geri çekilir. **Bugün → Çalış** her zaman en kısa yol.

## 18. Öğrenme renk paletinin kuralı

Az sayıda, kısık doygunlukta renk. Ana UI nötr/sakin; renkler anlam taşıyan bilgi üzerinde görünür. Niyet: ≈%80 sakin yüzey, ≈%20 anlam taşıyan vurgu (matematiksel zorunluluk değil). "Her kelime farklı renk" yasak; aşırı vurgu = vurgu yok. Palet seçimi token'da tek yerde; jenerik varsayılanlardan (parlak mavi birincil, gri gölgeli kart yığını) kaçınılır.

## 19. Kullanıcı tercihi

İleride: vurgu yoğunluğu, yazı boyutu (sistem değerine ek), light/dark zorlaması, azaltılmış hareket. v0'da Ayarlar bir seçenek mezarlığına dönmez; varsayılan tasarım güçlü ve kullanılabilir olur; sistem tercihleri (tema, yazı boyutu, hareket) otomatik izlenir.

## 20. Sınırlar ve tutarlılık

- Semantik renk = UI kaygısı; `Atom`/domain gerçek hex bilmez; motor platform/yazı tipi/tema bilmez (A22).
- Gelecekteki Capacitor kabuğu aynı token'ları ve tasarım dilini kullanır; tasarım sistemi kabuğa özgü değildir.
- Görsel destek ile FSRS zamanlaması ayrıdır; tasarım hiçbir zaman `due`'ya veya EvidencePolicy'ye girdi vermez.
- Uygulama sırası: `09` Phase 9b — işlevsel akış bittikten sonra, kontrollü ve sınırlı sürede.
- Kabul: `08` §7.2 V-01…V-15.
