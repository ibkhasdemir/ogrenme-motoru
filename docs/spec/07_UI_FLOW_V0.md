# 07_UI_FLOW_V0.md — Telefon-first Arayüz Akışı (v0)

Referans: `00_ANAYASA.md` §3, A21, A22; `03_DAILY_QUEUE_ENGINE.md` §6; `02_EVIDENCE_FSRS_ENGINE.md` §6–7; `06` §7–§10; görsel sistem `14_VISUAL_LEARNING_DESIGN.md`.

Revizyon 2: S12 yedek/kurtarma ile yeniden yazıldı; mobil ergonomi ve PWA kurulum gereksinimleri (§1.1–1.2); görsel kırmızı çizgiler (§7); oturum akışı dinamik seçimle uyumlu.

## 1. İlke

**Aç → çalış → kapat.** Kullanıcı uygulamayı açtığında gösterilecek bir şey varsa ilk çalışma eylemi en fazla bir dokunuşla ("Başla") görünür olmalıdır; hiçbir seçim (ders, konu, mod) sorulmaz (T1). Ekranlar dikey, tek sütun, başparmakla ulaşılır düğmeler. Dashboard, grafik, streak, oyunlaştırma **yoktur**. **Bugün → Başla** her zaman en kısa yoldur.

### 1.1 Mobil-first ergonomi (kırmızı çizgi)
- Temel hedef iPhone ve Android telefon ekranı (≈360–430 px genişlik); masaüstü desteklenebilir ama ikincil.
- Mouse-hover gerektiren kritik işlem **yoktur**; her işlem dokunmayla tamamlanır.
- Dokunmatik hedefler 44–48 px sınıfında; kritik eylemler (Cevapla / Geri al / Sıfırla) birbirine bitişik değil.
- Safe-area / çentik / ana gösterge alanı dikkate alınır (`env(safe-area-inset-*)`); alt düğmeler ana göstergenin altına kaymaz.
- Klavye açıldığında form alanı görünür kalır; Kaydet düğmesi klavyenin altında kaybolmaz (kaydırılabilir düzen, sabit alt çubuk kullanılıyorsa klavyeyle birlikte yükselir).
- Tek elle kullanım: birincil eylem ekranın alt yarısında.
- Android sistem geri tuşu ve iOS kenar geri hareketi: çalışma ekranından Bugün'e döner; yarım cevap kaydedilmez, öğe yeniden sunulur.

### 1.2 PWA kurulabilirlik (kırmızı çizgi)
- `manifest` (`display: standalone`, `start_url`, `scope`, ikonlar, tema rengi), service worker, çevrimdışı uygulama kabuğu.
- iOS Ana Ekran için gerekli meta etiketleri ve ikon; standalone açılışta durum çubuğu ve safe-area uyumu.
- Service worker (v0 sabit stratejisi, `13` §7): her build tam ön-önbellek (eksik varlık = install başarısız, eski build kalır); kabuk ve varlıklar aktif SW'nin kendi build önbelleğinden; arka planda güncelleme kontrolü; çalışan oturum sessizce değişmez; yeni sürüm hazır olunca yalnız Bugün/Veri ekranında "Yeni sürüm hazır → Yenile"; service worker kullanıcı verisine dokunmaz.

## 2. Ekran listesi

| # | Ekran | Amaç |
|---|---|---|
| S1 | Bugün | sayılar, Başla, mikro mod, giriş kısayolları |
| S2 | Oku | yeni atomu ilk kez okuma (review değildir) |
| S3 | Soru | çoktan seçmeli sunum |
| S4 | Güven | emin / tereddüt / salladım |
| S5 | Sonuç | doğru/yanlış, doğru seçenek, atom + çengeller, geri al |
| S6 | Yanlış nedeni | üç seçenek + geç (S5'in içinde, yalnız yanlışta) |
| S7 | Hatırlama kartı | prompt → (çengel) → cevabı aç → öz değerlendirme |
| S8 | Oturum sonu | bugünlük bu kadar / süre doldu |
| S9 | Atom ekle | |
| S10 | Soru ekle | beş zorunlu alan + gelişmiş |
| S11 | İçerik | minimal liste: atomlar ve soruları, arşivle, soru sürüm geçmişi |
| S12 | Veri / Ayarlar | yedek al, yedekten geri yükle, kurtarma noktaları, hafızayı yeniden hesapla, kuyruk tavanları, sürüm bilgisi |

## 3. Durum makinesi

```
S1 ─Başla/3-5-10 dk─▶ nextItem (selectNext: güncel MemoryState + now) ─┬─ reason=new ─▶ S2 ─Okudum, sına beni─▶ resolve
                                                                       └─ reason=due ─▶ resolve
resolve ─question─▶ S3 ─seçenek seç─▶ Cevapla ─▶ S4 ─güven─▶ doğruysa: (Attempt diske) ─▶ S5 (doğru cevap + açıklama)
                                                          └─ yanlışsa: S6 ("Yanlış." + neden çipleri; doğru cevap HENÜZ gösterilmez)
                                                                       ─neden─▶ (Attempt diske) ─▶ S5 (doğru cevap + açıklama) ─Devam─▶ nextItem
S5 ─Devam─▶ nextItem        S5 ─Geri al─▶ (AttemptVoid + REBUILD) ─▶ aynı LearningAction bir kez tekrar sunulur (03 §6.5; selectNext atlanır, due değişmez) ─▶ cevap ─▶ nextItem
S7 ─öz değerlendirme─▶ kısa ömürlü "Geri al" (03 §6.5) ─▶ aynı kart tekrar sunulur
resolve ─recall─▶ S7 ─[Çengeli göster]─▶ Cevabı aç ─▶ öz değerlendirme ─▶ (Attempt) ─▶ nextItem
nextItem ─kuyruk bitti / bütçe doldu─▶ S8 ─▶ S1
```

Attempt yazılma anı (**kayıt her zaman doğru cevabın gösteriminden önce**):
- Doğru cevap: S4'te güven dokunuşunda hemen; sonra S5.
- Yanlış cevap: S6'da neden dokunuşunda (Geç dâhil); neden Attempt'ın parçasıdır ve Attempt değişmez olduğundan sonradan eklenemez. S6'da yalnız "Yanlış." ve dört çip görünür; **doğru seçenek ve atom açıklaması Attempt diske yazıldıktan sonra** S5'te açılır. Kullanıcı S6'da uygulamayı kapatırsa o cevap kaydedilmez ama doğru cevabı da görmemiştir; öğe yeniden sunulur (M-04).
- Kart: öz değerlendirme dokunuşunda; cevap zaten açılmıştır (hatırlama ölçümü "Cevabı aç" anında bitmiştir).

## 4. Ekranlar

### S1 Bugün
- Başlık: "Bugün" + tarih.
- Üç sayı: **tekrar** (vadeli), **yeni** (bugünkü kuyruktaki), **bugün yapılan**.
- Kuyruk boşsa metin: atom yoksa "Henüz atom yok" + Atom ekle; vadeli yoksa "Şu an vadesi gelen bir şey yok. Motor zamanı geldiğinde getirir."
- Gösterilecek bir şey varsa: `Başla · N öğe` (birincil; N = `03` §7 tahmini) + `3 dk` `5 dk` `10 dk`.
- Alt sıra: `+ Atom` `+ Soru` `İçerik` `Veri`.
- Yedek hatırlatması (`06` §10): son cihaz dışı yedekten beri 7 gün geçtiyse **veya** 250 yeni öğrenme olayı yazıldıysa tek satır: "Son yedek 9 gün önce · 312 yeni kayıt · Yedek al". Geri yükleme/sıfırlama sonrası veya hiç yedek yoksa: "Yedek durumu bilinmiyor · Yedek al". Bildirim değildir.
- Saat tutarsızlığı uyarısı (`06` §3.1): "Cihaz saati tutarsız görünüyor: N kayıt ileri tarihli · İncele" → Veri ekranındaki liste.
- Güncelleme çubuğu (`13` §7): bekleyen, **tamamı önbelleğe alınmış** yeni sürüm varsa tek satır "Yeni sürüm hazır · Yenile"; yalnız bu ekranda ve Veri ekranında; çalışma ekranlarında gösterilmez; Yenile o istemciyi bir kez yeniler.

### S2 Oku (yalnız `reason = new`)
- Kırıntı: "Yeni · Ders › Konu".
- Atom metni (büyük, okuma yazı tipi), varsa neden/nasıl, çengeller.
- `Okudum, sına beni` → resolve. `Bugün'e dön`.
- Bu ekranda geçen süre kaydedilmez; review değildir (A11).

### S3 Soru
- Kırıntı: "Ders › Konu · i/N".
- Soru metni; seçenekler tam genişlik düğme. İlk dokunuş `initialSelectedOptionId`, sonraki dokunuşlar `selectedOptionId`. Seçili görünür.
- `Cevapla` seçim yoksa pasif. Doğru cevap **gösterilmez**.
- Süre ölçümü: ekran gösteriminden S4 güven dokunuşuna kadar.

### S4 Güven
- Metin: "Ne kadar eminsin? Cevap henüz gösterilmedi."
- Üç düğme: `Eminim` (sure) · `İki şık arasında kaldım` (unsure) · `Salladım` (guess).
- Güven **cevap açıklanmadan önce** sorulur; sonra sorulursa yanlı olur.

### S6 Yanlış nedeni (yalnız yanlışta, S5'ten ÖNCE)
- "Yanlış." büyük; seçenekler pasif ve **nötr** (doğru seçenek henüz işaretli değil); atom açıklaması yok.
- Başlık: "Neden yanlış?" Dört çip: `Bilmiyordum` (unknown) · `Karıştırdım` (confused) · `Dikkat / işlem` (attention) · `Geç` (skipped). Tek dokunuş; form yok.
- Çip dokunuşu Attempt'ı diske yazar; başarı sonrası S5 açılır.

### S5 Sonuç
- "Doğru." / "Yanlış." büyük.
- Seçenekler pasif: doğru olan yeşil, seçilen yanlış kırmızı.
- Atom metni + neden/nasıl + çengeller (öğrenme anı).
- `Geri al` (sessiz; yalnız kayıttan sonraki 30 sn, bir kez) + `Devam` (birincil). `Geri al` → void + REBUILD + **aynı soru, aynı sürüm** bir kez yeniden sunulur (`03` §6.5); due değişmez.

### S7 Hatırlama kartı
- Kırıntı: "Hatırlama kartı · Ders › Konu".
- Soru yüzü (`Atom.prompt`; zorunlu alan, genel konu sorusu yok).
- Alt metin: "Önce kendi kendine söyle (sesli olabilir). Sonra cevabı aç."
- Düğmeler: `Çengeli göster` (çengel varsa; basınca çengeller görünür, `support = hook`) · `Cevabı aç` (birincil).
- Cevap açılınca: atom metni + neden/nasıl; üç düğme: `Hatırladım` (good) · `Zorlandım` (hard) · `Hatırlayamadım` (again).
- Öz değerlendirme dokunuşundan sonra, bir sonraki öğeye geçmeden önce kısa ömürlü ve görünür bir `Geri al` affordance'ı (ekran altında en fazla 30 saniyelik çubuk "Son kartı geri al"). Basılırsa: void + REBUILD + aynı hatırlama kartı bir kez yeniden sunulur (`03` §6.5); yeni Attempt `replayOfAttemptId` taşır. Basılmazsa normal akış; gecikmiş geri alma yoktur.

### S8 Oturum sonu
- "Bugünlük bu kadar." veya "Süre doldu."
- Sayılar: bu oturum / bugün toplam.
- "N atom 15 dakika içinde yeniden gelecek (öğrenme adımı)." varsa. Uygulama beklemez, bildirim atmaz.
- `Bugün'e dön`.

### S9 Atom ekle
- Ders (metin, yoksa oluşturulur), Konu (metin, yoksa oluşturulur), **Atom** (zorunlu, tek cümle), **Soru yüzü** (zorunlu; yardım metni: "Cevabı vermeyen, bu konudaki diğer atomlardan ayırt edilen tek soru"), Neden (isteğe bağlı), Tür çipleri (facet; varsayılan olgu), Çengel (tür + metin, isteğe bağlı; yardım metni: "Cevabı yazma, cevabı çağrıştır").
- `Kaydet` / `Vazgeç`. Hata: "Atom metni ve soru yüzü boş olamaz."

### S10 Soru ekle
- Zorunlu: **Soru**, **Seçenekler** (2–5; doğru olanı radyo ile işaretle), **Ana atom** (arama/seçim listesi; yoksa "önce atom ekle" bağlantısı), **Kaynak** (metin).
- `+ Gelişmiş` (kapalı başlar): yanlış seçenek → karıştırılan atom (OptionAtom), ikincil atomlar, tuzak tipi, soru tipi. Hiçbiri zorunlu değil.
- Hata: "Beş alan da gerekli: soru, en az iki seçenek, doğru seçenek, ana atom, kaynak."

### S11 İçerik (minimal)
- Ders › Konu › Atom listesi; atomda soru sayısı ve (varsa) sonraki vade.
- Atom aç: metin, soru yüzü, çengeller, sorular; `Arşivle` (silme yok). Soru yüzü boş (eski veri) atomlar listede "soru yüzü eksik" etiketiyle en üstte; tamamlanana kadar çalışılmaz.
- Soru `Arşivle`: soru artık sunulmaz; geçmişi ve sürümleri kalır.
- Soru aç: mevcut sürüm; `Düzenle` semantik değişiklikte yeni sürüm üretir (A9) ve kısa uyarı gösterir: "Bu değişiklik yeni bir sürüm oluşturur; eski cevapların eski sürümle saklanır." Soru kökü, doğru cevap veya ana atom değiştiyse ek satır: "Yanlış-şık ve ikincil atom ilişkileri sıfırlandı; gerekirse Gelişmiş'ten yeniden işaretle." Doğru cevap değiştiyse ayrıca tek soru: **"Eski cevap anahtarı hatalı mıydı?"** — Evet → etkilenen N deneme listelenir ("bu cevaplar yanlış anahtarla ölçülmüştü") → `Bu ölçümleri geçersiz kıl` (AttemptVoid reason content_error) → hafıza yeniden hesaplanır; Hayır → yalnız yeni sürüm. `Sürüm geçmişi`: v1, v2… her biri tam metin/seçenek/doğru/ana atomla görüntülenebilir; düzenlenemez; tarihi bilinmeyen sürümde "sürüm tarihi bilinmiyor"; içerik hatası nedeniyle geçersiz kılınan denemeler gerekçesiyle görünür. İçeriği eski veri modelinde saklanmamış sürüm (`content_unavailable_legacy`) için satır: "Bu eski denemeye ait soru metni eski veri modelinde saklanmadığı için mevcut değil." Güncel metin bu satırın yerine **gösterilmez**.
- Arama kutusu (metin içinde).

### S12 Veri / Ayarlar
Kullanıcı dili teknik değildir. Dört bölüm:

**Yedek al**
- "Son yedek: 2 Eylül · 312 yeni öğrenme olayı o zamandan beri."
- `Yedek al` → `ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS-<backupId8>.json` dosyası (Dosyalar / iCloud Drive / Google Drive'a kaydedilebilir). Sonuç duruma göre (`06` §11): kaydetme doğrulandıysa "Yedek alındı."; yalnız indirme başlatılabildiyse "İndirme başlatıldı. Dosyanın kaydedildiğini doğrula." + `Kaydettim` (teyit yedek işaretçisini günceller; teyit yoksa durum "doğrulanmamış"); iptal/başarısızda işaretçi değişmez.
- Tek satır açıklama: "Yedek dosyası telefondan bağımsızdır; tarayıcı verisi silinse bile geri yükler. Kurtarma noktaları ise bu cihazın içindedir ve tarayıcı verisiyle birlikte silinebilir."

**Yedekten geri yükle**
1. `Dosya seç`
2. "Doğrulanıyor…" (parse → format → checksum → bütünlük → deneme hesabı; `06` §8 adım 1–6)
3. Yedek özeti: tarih, uygulama/şema sürümü, atom / soru / öğrenme olayı sayısı, uyarılar (örn. "farklı zamanlayıcı sürümü: hafıza durumu yeniden hesaplanacak"); "Mevcut verin bu yedekle değiştirilecek."
4. `Bu yedeğe geri dön` (birincil, kızıl değil; yıkıcı ama planlı) / `Vazgeç`
5. "Kurtarma noktası alınıyor…" (pre_restore)
6. "Geri yükleniyor…"
7. "Doğrulandı: 128 atom, 240 soru, 3.412 öğrenme olayı." → `Bugün'e dön`
- Bozuk dosyada: **"Yedek doğrulanamadı. Mevcut verine dokunulmadı."** + neden (kısa: "sağlama toplamı uyuşmuyor", "eksik soru sürümü").
- Geri yükleme sonrası hata: "Geri yükleme tamamlanamadı. Önceki durumuna dönülüyor…" (acil geri dönüş, yeni nokta yazmadan, tek deneme) → başarısızsa yazma-kilitli kurtarma ekranı: `Kurtarma noktasına dön` + `Kurtarma dökümü al`.
- Yarım kalmış iş (uygulama geri yükleme sırasında kapanmışsa): açılışta "Yarım kalan geri yükleme çözümleniyor…" → doğrulanmış yeni durum ya da eski durum; başka ekran açılmaz (`06` §8.5).

**Kurtarma noktaları**
- Liste: tarih · neden (Geri yükleme öncesi / Günlük / Sıfırlama öncesi / Sürüm geçişi öncesi) · atom / öğrenme olayı sayısı.
- Satırda `Bu noktaya dön` → aynı özet + onay akışı; dönüşten önce yeni bir "Geri yükleme öncesi" noktası alınır.
- Üstte tek satır: "Bu noktalar cihazın içindedir; tarayıcı verisi silinirse kaybolur. Kalıcı koruma için Yedek al."

**Motor**
- `Hafızayı yeniden hesapla` (REBUILD) → "Hafıza durumu öğrenme geçmişinden yeniden hesaplandı."
- Kuyruk tavanları: günlük tekrar (reviewCap), günlük yeni (newPerDay).
- Sürüm bilgisi tek satır: uygulama 0.2.0 · şema 2 · ts-fsrs 5.4.2 · FSRS-6 · hedef hatırlama 0.90 · fuzz kapalı · policy v1.
- `Tüm veriyi sıfırla` yalnız burada, iki onay, öncesinde otomatik kurtarma noktası (pre_reset); RestoreJournal ile (`06` §8.5).
- `İleri tarihli kayıtlar` (yalnız varsa): liste + "Bu kayıtları geçersiz kıl" (`AttemptVoid reason: clock_skew`); silme yok.
- Normal açılış başarısızsa (migration hatası / daha yeni şema) bu ekran yerine **kurtarma ekranı**: kurtarma okuyucusuyla `Yedek al` veya `Kurtarma dökümü al` (`06` §6.3); yazma kapalı.
- Örnek veri düğmesi yalnız depo boşken.

## 5. Yazım kuralları
- Türkçe, sade, aktif fiil. Düğme adı akış boyunca aynı ("Yedek al" → "Yedek alındı").
- Hata metinleri ne olduğunu ve ne yapılacağını söyler; özür dilemez.

## 6. Navigasyon
- v0'da alt sekme çubuğu gerekmez; Bugün ekranındaki dört kısayol yeter. İleride alt navigasyon eklenirse en fazla dört alan: Bugün · İçerik · Yakala · Ayarlar.
- Çalışma ekranlarında (S2–S8) navigasyon geri çekilir; yalnız `Bugün'e dön` kalır.

## 7. Görsel kırmızı çizgiler (ayrıntı `14_VISUAL_LEARNING_DESIGN.md`)
- Modern mobil görsel kalite: sakin zemin, güçlü içerik hiyerarşisi, ölçülü yüzeyler; "dershane sitesi" görünümü yok.
- Semantik vurgu: kritik bilgi (tarih, istisna, karıştırılan kavram, çengel) sistematik ve tutarlı vurgulanır; aynı ekranda vurgu enflasyonu yok.
- Tema token'ları: renk/boşluk/tipografi/yarıçap yalnız token'lardan; bileşen içinde ham hex yok; light/dark hazır.
- Erişilebilirlik: renk tek taşıyıcı değil (ikon + metin + kenarlık); WCAG AA kontrast; büyük yazı boyutunda düzen bozulmaz.
- Öğrenme / ölçüm ayrımı: cevap açıklanmadan önce doğru seçenek yeşil, yanlış kırmızı görünmez; istisna/uyarı rengi soru içinde cevabı ele vermez.
- iOS/Android ergonomisi: §1.1.
- Hareket yalnız kullanıcı eylemine cevap olarak; `prefers-reduced-motion` saygılı.

## 8. Yapılmayacaklar (UI)
Dashboard, grafik, streak, rozet, süs animasyonu, bildirimler, sosyal paylaşım, çoklu tema seçici, onboarding turu, pixel-perfect iOS/Material kopyası. Ayrıntı `10_V0_NON_GOALS.md`.
