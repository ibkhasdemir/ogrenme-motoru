# docs/PHONE_CHECK.md — Telefonda el ile kontrol listesi

Kaynak: `08_TEST_PLAN.md` §7 (M-01…M-10), §7.1 (M-UP-01…08), §7.2 (V-01…V-15). Otomatik testler bunları gerçeklemez; her satır telefonda bir kez denenir ve sonucu işaretlenir.
Durum sütunu: ☐ denenmedi · ✓ geçti · ✗ kaldı (not yaz). Cihaz/sürüm sütununa iOS/Android sürümü ve uygulama sürümü yazılır.

Ön koşul: `npm run build` → `dist/` bir HTTPS sunucuda (PWA için zorunlu) veya aynı ağda `npm run preview -- --host` ile açılır; telefonda tarayıcıdan adres girilir, "Ana ekrana ekle" yapılır.

## 1. Görsel ve erişilebilirlik (V — Phase 9b, `14`)

| ID | Kontrol | Beklenen | Durum | Cihaz / not |
|---|---|---|---|---|
| V-01 | iPhone görünüm alanı (≈390×844) | tüm ekranlar taşmadan; birincil eylem alt yarıda (Başla, Cevapla, Cevabı aç, Devam) | ☐ | |
| V-02 | küçük Android (≈360×640) | soru + 4 seçenek + Cevapla tek ekranda ya da rahat kaydırmayla | ☐ | |
| V-03 | büyük telefon (≈430×930) | satır uzunluğu < 80 karakter (`max-width: 34em/40em`); boşluklar orantılı | ☐ | |
| V-04 | dark mode | semantik roller anlamını korur (doğru yeşil, yanlış kırmızı, çengel mor, uyarı kehribar); kontrast AA | ☐ | |
| V-05 | light mode | aynı | ☐ | |
| V-06 | büyük yazı (sistem %150+) | düzen parçalanmaz; düğmeler içeriğe göre büyür, taşmaz (rem ölçek, sabit yükseklik yok) | ☐ | |
| V-07 | safe-area / çentik | alt düğmeler ana göstergenin üstünde; üst içerik çentiğin altında (`env(safe-area-inset-*)`) | ☐ | |
| V-08 | klavye açıkken form (S9/S10) | odaklanan alan görünür; Kaydet erişilebilir (kaydırılabilir düzen) | ☐ | |
| V-09 | yatay yön | temel kullanılabilirlik; kırılma yok | ☐ | |
| V-10 | renk körlüğü simülasyonu (protan/deutan/tritan) | doğru/yanlış yalnız renkle değil: "✓ doğru" / "✕ seçilen" metni + kenarlık + dolu daire | ☐ | |
| V-11 | reduced-motion | ekran geçiş solması kapanır; akış aynı | ☐ | |
| V-12 | çevrimdışı standalone | ana ekrandan açılış, uçak modu, tam döngü (Phase 11 SW ile) | ☐ | |
| V-13 | cevap öncesi sızıntı yok | S3'te seçenekler nötr (yalnız seçili/seçili değil); doğru seçenek yeşil değil; S4 güven ekranında cevap yok; S6'da doğru seçenek işaretli değil | ☐ | |
| V-14 | kritik anlam yalnız renkle taşınmıyor | çengel bloğu: sol çizgi + "logic/mnemonic…" etiketi; kaynak etiketi; uyarı kutusu sol çizgi + metin | ☐ | |
| V-15 | vurgu enflasyonu yok | bir ekranda en fazla 2–3 vurgu rolü aynı anda (S5: sonuç rengi + çengel + kaynak) | ☐ | |

## 2. Çalışma döngüsü ve veri güvenliği (M — Phase 11, `08` §7)

| ID | Adım | Beklenen | Durum | Cihaz / not |
|---|---|---|---|---|
| M-01 (T8) | Uygulamayı bir kez aç, uçak modu, kapat-aç, tam döngü | çalışır; veri kalır | ✓ | iPhone, 0.2.0 (2026-09-08): uçak modunda çalışma + yedek + geri yükleme çalıştı |
| M-02 | Ana ekrana ekle | standalone açılır, ikon doğru | ✓ | iPhone (2026-09-08) |
| M-03 | Cevap sonrası uygulamayı öldür, yeniden aç | son cevap kayıtlı (raw önce disk) | ☐ | |
| M-04 | Yanlış nedeni ekranında (S6) öldür | o cevap yok **ve** doğru cevap görülmemişti; öğe yeniden sunulur; S5'te öldürülürse cevap diskte | ☐ | |
| M-05 | 1 dk öğrenme adımı | oturum bitince "N atom 15 dakika içinde" görünür; bekleyince Başla vadeli getirir | ☐ | |
| M-06 | Düğme boyutları | tek elle ulaşılır; yanlış dokunuş yok (48 px hedef, Geri al ile Devam bitişik değil) | ☐ | |
| M-07 | Gece yarısı | bugün sayıları sıfırlanır; vadeler değişmez | ☐ | |
| M-08 | Yedek dosyası Dosyalar'a kaydedilir ve geri yüklenir | iPhone: paylaşım sayfasından iCloud Drive'a (standalone PWA'dan, BL-09); Android: İndirilenler → geri yükleme başarılı | ✓ | iPhone (2026-09-08): paylaşım → "Kaydettim" → geri yükleme başarılı. **Bulgu F-1** (§6): paylaşım sayfasından dönüşte Bugün 0/0/0 gösterdi; veri diskte duruyordu |
| M-09 | Geri yükleme sırasında öldür | commit'ten hemen sonra öldürülür → açılışta "yarım kalan geri yükleme çözümleniyor" → tutarlı durum | ☐ | |
| M-10 | Kurtarma ekranı | (sahte migration hatası ile) normal açılış başarısızken kurtarma dökümü alınabilir; DB değişmez | ☐ | |

## 3. PWA güncelleme (M-UP — Phase 11, `13` §7)

| ID | Adım | Beklenen | Durum | Cihaz / not |
|---|---|---|---|---|
| M-UP-01 | v1 kurulu + veri; yeni sürüm deploy; çevrimiçi açılış | eski build kendi önbelleğinden açılır; arka planda yeni build tam indirilir; Bugün'de "Yeni sürüm hazır → Yenile"; çalışma sırasında sessiz değişim yok | ✗ → düzeltildi, yeniden denenecek | iPhone (2026-09-08): Safari sekmesinde çubuk çıktı ve Yenile çalıştı; **ana ekran uygulamasında çubuk hiç çıkmadı** (Bulgu F-2, §6). Kullanıcı ikonu yeniden ekledi (yeni boş depo!) |
| M-UP-02 | güncelleme sonrası | IndexedDB verisi korunmuş; sayılar aynı | ☐ | |
| M-UP-03 | eski önbellek | activate sonrası yalnız eski `motor-shell-*` silinmiş; IndexedDB'ye dokunulmamış | ☐ | |
| M-UP-04 | çevrimdışı yeni sürüm | uçak modunda yeni sürüm açılır ve tam döngü çalışır | ☐ | |
| M-UP-05 | DB wipe yok | hiçbir sürüm geçişi veriyi silmez; migration gerekiyorsa çalışır ve kurtarma noktası bırakır | ☐ | |
| M-UP-06 | eski JS'te kilitlenme yok | Yenile'ye basılırsa hemen; basılmazsa tüm istemciler kapandıktan sonraki açılışta yeni sürüm | ☐ | |
| M-UP-07 | hash'li varlıklar | değişmeyen `assets/*.js` ağ olmadan önbellekten; değişen varlık yeni adıyla ağdan | ☐ | |
| M-UP-08 | yarım sürüm yok | bir JS varlığı engellenir → yeni SW install başarısız, eski build çalışır; ağ kesilir → eski tam build çevrimdışı açılır | ☐ | |

## 3.1 Yeni özellikler — telefonda denenecekler (2026-09-08 sonrası)

| ID | Adım | Beklenen | Durum | Cihaz / not |
|---|---|---|---|---|
| Y-01 | İçe aktar → Şablonu paylaş | paylaşım sayfası açılır; şablon yapay zekâ uygulamasına gider | ☐ | |
| Y-02 | Sohbetten JSON'u kopyala → Panodan yapıştır | metin kutuya gelir, önizleme çıkar (çitli/açıklamalı çıktı da okunur) | ☐ | |
| Y-03 | Ünite alanı | "18. yy Osmanlı" yazılınca tüm konular onun altına girer; liste tek ünite grubu olur | ☐ | |
| Y-04 | Parçalı dizin uyarısı | ünite verilmeden önizlemede "N atom N ayrı konuya dağılmış" uyarısı görünür | ☐ | |
| Y-05 | İçerik → Konular | mevcut konular listelenir; çoklu seçim → "Seçilenleri ünite altına taşı" çalışır | ☐ | |
| Y-06 | Konu birleştirme | tek konu seçip mevcut bir konunun adını vermek atomları oraya taşır; sayılar toplanır | ☐ | |
| Y-07 | Taşıma sonrası öğrenme | Bugün sayıları ve vadeler değişmemiş; çalışma döngüsü aynı | ☐ | |
| Y-08 | 0/0/0 koruması (F-1) | yedek paylaşımından dönüşte sayılar doğru; bozulursa "Depo geçici olarak okunamadı" mesajı (sıfır değil) | ☐ | |
| Y-09 | Ders notu kutusu | nota yapıştırıp "Şablonu paylaş" → sohbete şablon + not tek parça gider | ☐ | |
| Y-11 | Konular → Tümünü seç | tek dokunuşla hepsi işaretlenir; ünite yazıp taşıyınca liste tek ünite grubu olur | ☐ | |
| Y-12 | Ünite alanı + Şablonu paylaş | şablonda "konu tam olarak <ünite> olacak" kuralı görünür; dönen JSON tek ünite ile gelir | ☐ | |
| Y-13 | + Yakala | metin + köken ile kutuya atılır; Bugün'de "Kutu · N" görünür; vadeler değişmez | ☐ | |
| Y-14 | Kutu → İşle (yeni atom) | neden sorusu ÇIKMAZ; kaydet → "ölçüm yazılmadı" | ☐ | |
| Y-15 | Kutu → İşle (çalışılmış atom) | "Bu neden geldi?" çıkar; Hatırlayamadım → atom öne gelir (Bugün'de tekrar sayısı artar) | ☐ | |
| Y-16 | "Yanlış yaptım" + "Emin miydim: Evet" | kaydedilir; İçerik → atomda köken görünür | ☐ | |
| Y-17 | Çalışma akışı (BL-47) | "Okudum" sonrası soru HEMEN gelmez; araya başka atomlar girer, sonra ilk okunan sınanır. Tek atom varsa hemen sorulur | ☐ | |
| Y-18 | Geri hareketi | ekranın kenarından sağa kaydırınca bir önceki ekrana döner; üstteki "←" kaydırırken kaybolmaz | ☐ | |
| Y-19 | Kaydırıp arşivle | listede satırı sola kaydır → "Arşivle" çıkar; arşiv görünümünde kaydırınca geri gelir | ☐ | |
| Y-20 | Kalıcı silme | hiç çalışılmamış, sorusuz atomda "Kalıcı sil" görünür; çalışılmış atomda yerine gerekçe yazar | ☐ | |
| Y-21 | İlerleme ekranı | Bugün → İlerleme; "Emindim ama yanlıştı" ve "Zorlandıkların" doğru atomları listeler; ekran vadeleri değiştirmez | ☐ | |
| Y-22 | Yapay zekâ ayarı | Veri → Yapay zekâ → anahtar kaydedilir; "Bağlantıyı dene" olumlu yanıt verir; anahtar maskeli görünür | ☐ | |
| Y-23 | Yapay zekâ ile üret | İçe aktar → notu yapıştır → "Yapay zekâ ile üret" → önizleme gelir; Ekle demeden hiçbir şey eklenmez | ☐ | |
| Y-24 | Yedek + yapay zekâ | yedek al → dosyada API anahtarı GEÇMEZ (dosyayı açıp arayarak doğrula) | ☐ | |
| Y-25 | Yatay taşma | hiçbir ekran yana kaymaz (Bugün, İçerik, Veri, çalışma ekranları) | ☐ | |
| Y-26 | Ekran geçişi (BL-50) | bir düğmeye/karta basınca yeni ekran **o noktadan** büyüyerek açılır; kenardan geri kaydırınca uzaklaşarak gelir; hiçbir geçişte ekran boş/yarı saydam takılı kalmaz | ☐ | |
| Y-27 | Aramada yanıp sönme yok | İçerik → arama kutusuna yazarken ekran her tuşta yeniden belirmez, klavye kapanmaz | ☐ | |
| Y-28 | Palet (açık/koyu) | iOS Ayarlar → Görünüm ile ikisi de denenir: metin her yerde rahat okunur, doğru/yanlış/uyarı renkleri hâlâ ayırt edilir, koyu modda parlama yok | ☐ | |
| Y-29 | Azaltılmış hareket | iOS Ayarlar → Erişilebilirlik → Hareket → "Hareketi Azalt" açıkken geçiş animasyonu **hiç** olmaz, ekranlar anında ve tam görünür gelir | ☐ | |
| Y-30 | Yeni sürüme geçtiğinden emin ol | Uygulamayı öne al → "Yeni sürüm hazır · Yenile" çıkarsa **Yenile**'ye bas. Çıkmıyorsa uygulamayı tamamen kapatıp aç. Değişiklik görünmüyorsa büyük olasılıkla eski sürümdesin | ☐ | BL-51'de bu yaşandı |
| Y-31 | Yeni tasarım (BL-51) | Okuma/soru metni **serif** (kitap harfi), arayüz metni sans; birincil düğme siyah kapsül (koyu temada beyaz); Bugün sayıları tek kart içinde üç bölme; kartların kalın kenarlığı yok | ☐ | |
| Y-32 | Hareket katmanı (BL-52) | Ekran açılırken içerik yukarıdan sırayla yerine oturur; cevap sonrası "Doğru./Yanlış." yerine oturur ve doğru şık dolgusu belirir; uzun listede aşağı kayınca başlığın altında ince çizgi çıkar; "Hareketi Azalt" açıkken hiçbiri olmaz | ☐ | |
| Y-10 | Atom ekranı → Çengel ekle | kendi kodlaman kaydedilir, kartta "Çengeli göster" ile çıkar; aynı metin ikinci kez "zaten var" | ☐ | |

## 4. Notlar
- Bu liste `11` kural 4'e göre kod yazan tarafından yazılan dokümanlardandır; sonuçlar buraya işlenir, spec'e değil.
- Yıkıcı yollar (geri yükleme, sıfırlama) telefonda denenmeden önce dış yedek alınır (`13` §2).

## 5. Masaüstünde doğrulananlar (2026-09-08, gerçek Chrome, `npm run preview`)
Telefon kontrolleri yerine geçmez; yalnız mekanizmanın çalıştığını gösterir.
- SW kaydı ve aktivasyon; `motor-shell-<buildId>` önbelleğinde build'in 7 varlığının tamamı (index.html, assets/*.js, assets/*.css, manifest, 3 ikon).
- Yeni build deploy → sayfa yenilenince eski build kendi önbelleğinden çalışmaya devam etti (manifest hâlâ eski); yeni SW tam ön-önbellekle `waiting`; Bugün'de "Yeni sürüm hazır · Yenile" (M-UP-01 mekanizması).
- Yenile → yalnız o istemci bir kez yeniden yüklendi (sessionStorage oturumu korundu, döngü bayrağı temizlendi); yeni build aktif; eski `motor-shell-*` silindi, IndexedDB'ye dokunulmadı (M-UP-03/06 mekanizması).
- Aynı kaynak → aynı buildId (deterministik); değişen varlık → yeni buildId (M-UP-07 mekanizması).
- Not: Claude Code'un gömülü tarayıcı paneli service worker kaydını engelliyor ("unknown error fetching the script"); SW testleri gerçek tarayıcıda yapılmalı.

## 6. Telefon bulguları (2026-09-08, iPhone, ana ekran uygulaması, 0.2.0)
Kullanıcı raporu; her bulgu önce testle kanıtlandı, sonra minimum yama (`11` kural 9, 30).

**F-1 — Yedek paylaşımından dönüşte Bugün 0/0/0.** Akış: 1 cevap → Veri → Yedek al (uçak modu, paylaşım sayfası) → Kaydettim → ← Bugün → üç sayı da 0. Yedekten geri yükleme sonrası: tekrar 1 (1 dk öğrenme adımı dolmuştu), bugün yapılan 1. Yani veri diskteydi; okuma yanlıştı. Kod incelemesi: yedek yolu yalnız okur, hiçbir yerde silme yok. Olası neden: iOS'ta arka plandan dönüşte IndexedDB okumasının boş/eski gelmesi (paylaşım sayfası uygulamayı arka plana alır; dönüşte `visibilitychange` → `checkExternalChanges`). Eski davranış: `meta.sequence` bilinenden farklıysa (küçük de olsa) REBUILD → boş bellek → 0/0/0.
Yama (Motor): aynı depoda sequence geri gitmez; gerileme veya "olay varken atom listesi boş" = okuma anomalisi → bellek korunur, Dexie bağlantısı kapat+aç, bir kez daha okunur; yine bozuksa açık hata ("Depo geçici olarak okunamadı … Verin silinmedi; uygulamayı tamamen kapatıp yeniden aç"). Sessiz boş REBUILD yok. Testler: phase8b "Depo okuma anomalisi" (3 test). Telefonda yeniden denenmeli (M-08 tekrar).

**F-2 — Ana ekran uygulamasında güncelleme çubuğu çıkmadı.** Safari sekmesinde çıktı; ana ekran uygulaması eski sürümde kaldı. Neden: iOS ana ekran uygulaması sayfayı yeniden yüklemeden sürdürür; güncelleme denetimi yalnız açılışta yapılıyordu. Yama: uygulama öne gelince (`visibilitychange`) `registration.update()` (en az 60 s arayla, çevrimdışı sessiz). Test: phase11 "Güncelleme denetimi". Telefonda yeniden denenmeli (M-UP-01 tekrar).

**F-4 — İçe aktarmada metin yapıştırma "çalışmadı", dosya çalıştı (114 öğe).** Neden: yapay zekâ çıktısı ```json çiti ve açıklama cümlesiyle geliyor; sıkı `JSON.parse` reddediyordu. Yama: `parseLooseJson` (çit/çevre metin/BOM/akıllı tırnak sarmalayıcısı temizlenir; veri değiştirilmez), "Panodan yapıştır" düğmesi, anlaşılır hata. Test: phase13b. **Not (hata değil):** içe aktarma sonrası Bugün "9 yeni" = günlük yeni tavanı 10 − o gün yapılmış 1 (`03` §7, Veri → Günlük yeni ile değiştirilebilir).

**F-5 — CI kararsızlığı (2026-09-08, run #6).** `phase10c-ui` E-11 geri yükleme akışı sabit 12–16 makro-görev tik'i bekliyordu; Linux koşucusunda WebCrypto + fake-indexeddb daha çok tik istedi → `restore-done` null. Yama: koşul bekleme (`waitFor`, 5 s). Ürün kodu değişmedi.

**F-6 — İçe aktarmada dizin parçalandı (115 atom / 37 konu).** Yapay zekâ ünite seviyesini atlayıp her olayı ayrı `konu` yaptı ("Tarih › Küçük Kaynarca"), alt başlık hiç kullanılmadı. Yama: şablonda üç seviye ve "1–3 konu, 5–20 alt başlık" kuralı; içe aktarma ekranında **Ünite** alanı (tümünü o ünitenin altına koyar); parçalı dizinde uyarı; mevcut veriyi düzeltmek için **İçerik → Konular** ekranı (çoklu seçim → ünite altına taşı; tek seçim → yeniden adlandır; aynı ad → birleştir). İçerik listesi artık ünite bazında gruplanır, alt başlıklar grup içinde etiketlidir. Testler: phase13c. Öğrenme geçmişi ve vadeler etkilenmez (Attempt atoma bağlıdır).

**F-7 — Bağımsız denetimde bulunan 8 hata (2026-09-08, iki inceleme ajanı; hepsi düzeltildi, `tests/phase13d-audit-fixes.test.ts`).**
1. Konular ekranında ad alanı önceki seçimin adını tutuyordu → yanlış konu sessizce **birleştirilebiliyordu** (veri kaybı riski). Artık seçim değişince alan yenilenir, seçim kalkınca temizlenir, sayaç seçili konunun adını yazar.
2. Toplu taşımada farklı ünitelerin aynı adlı alt başlıkları (iki ayrı "Islahatlar") istemsiz birleşiyordu → çakışma önceden saptanır, taşıma yapılmaz, hangi konuların çakıştığı söylenir.
3. Adı değiştirmeden "yeniden adlandır" demek atomları boş kabuk konuya taşıyordu → ad aynıysa hiçbir şey yapılmaz.
4. İçe aktarmada zaten var olan atomun satır içi `cengel`'i sessizce kayboluyordu → mevcut atoma bağlanır (çift ise atlanır). Şablon kodlamaları bu alana yazdırdığı için önemliydi.
5. Ekle bir hatayla dönerse düğme kalıcı kilitli kalıyordu → hata sonrası yeniden denenebilir.
6. Çengel kaydetmede çift dokunuş aynı çengeli iki kez yazıyordu (silme yolu yok) → tek yazma.
7. Ünite/metin değişince ekrandaki önizleme bayat kalıyordu → önizleme geçersizleşir, Ekle yeniden Önizle ister.
8. `parseLooseJson` metin içindeki ``` dizisini siliyordu ve JSON sonrası açıklamada `}` varsa geçerli girdiyi reddediyordu → çit yalnız kendi satırındayken atılır, dengeli parantezle ikinci bir aday denenir. Ayrıca "N ayrı konuya dağılmış" uyarısı artık ünite sayar (ideal dizinde yanlış uyarı vermez).
Ek: arayüz genelinde render sonrası odak/imleç ve açık paneller korunur (aramada telefon klavyesi kapanmıyor).

**F-3 — iPhone depo ayrımı (davranış, hata değil).** Safari sekmesi ile ana ekran uygulaması **ayrı** veri ve ayrı service worker tutar; birinde Yenile'ye basmak diğerini güncellemez. İkonu silip yeniden eklemek **yeni, boş bir uygulama** oluşturur; eski ikonun verisi onunla gider. Kural: tek ikon kullan, ikonu silmeden önce dış yedek al; güncelleme uygulamanın içinde gelir, ikon yeniden eklenmez. README'ye yazıldı.
