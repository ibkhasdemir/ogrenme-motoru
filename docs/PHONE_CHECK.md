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
| M-01 (T8) | Uygulamayı bir kez aç, uçak modu, kapat-aç, tam döngü | çalışır; veri kalır | ☐ | |
| M-02 | Ana ekrana ekle | standalone açılır, ikon doğru | ☐ | |
| M-03 | Cevap sonrası uygulamayı öldür, yeniden aç | son cevap kayıtlı (raw önce disk) | ☐ | |
| M-04 | Yanlış nedeni ekranında (S6) öldür | o cevap yok **ve** doğru cevap görülmemişti; öğe yeniden sunulur; S5'te öldürülürse cevap diskte | ☐ | |
| M-05 | 1 dk öğrenme adımı | oturum bitince "N atom 15 dakika içinde" görünür; bekleyince Başla vadeli getirir | ☐ | |
| M-06 | Düğme boyutları | tek elle ulaşılır; yanlış dokunuş yok (48 px hedef, Geri al ile Devam bitişik değil) | ☐ | |
| M-07 | Gece yarısı | bugün sayıları sıfırlanır; vadeler değişmez | ☐ | |
| M-08 | Yedek dosyası Dosyalar'a kaydedilir ve geri yüklenir | iPhone: paylaşım sayfasından iCloud Drive'a (standalone PWA'dan, BL-09); Android: İndirilenler → geri yükleme başarılı | ☐ | |
| M-09 | Geri yükleme sırasında öldür | commit'ten hemen sonra öldürülür → açılışta "yarım kalan geri yükleme çözümleniyor" → tutarlı durum | ☐ | |
| M-10 | Kurtarma ekranı | (sahte migration hatası ile) normal açılış başarısızken kurtarma dökümü alınabilir; DB değişmez | ☐ | |

## 3. PWA güncelleme (M-UP — Phase 11, `13` §7)

| ID | Adım | Beklenen | Durum | Cihaz / not |
|---|---|---|---|---|
| M-UP-01 | v1 kurulu + veri; yeni sürüm deploy; çevrimiçi açılış | eski build kendi önbelleğinden açılır; arka planda yeni build tam indirilir; Bugün'de "Yeni sürüm hazır → Yenile"; çalışma sırasında sessiz değişim yok | ☐ | |
| M-UP-02 | güncelleme sonrası | IndexedDB verisi korunmuş; sayılar aynı | ☐ | |
| M-UP-03 | eski önbellek | activate sonrası yalnız eski `motor-shell-*` silinmiş; IndexedDB'ye dokunulmamış | ☐ | |
| M-UP-04 | çevrimdışı yeni sürüm | uçak modunda yeni sürüm açılır ve tam döngü çalışır | ☐ | |
| M-UP-05 | DB wipe yok | hiçbir sürüm geçişi veriyi silmez; migration gerekiyorsa çalışır ve kurtarma noktası bırakır | ☐ | |
| M-UP-06 | eski JS'te kilitlenme yok | Yenile'ye basılırsa hemen; basılmazsa tüm istemciler kapandıktan sonraki açılışta yeni sürüm | ☐ | |
| M-UP-07 | hash'li varlıklar | değişmeyen `assets/*.js` ağ olmadan önbellekten; değişen varlık yeni adıyla ağdan | ☐ | |
| M-UP-08 | yarım sürüm yok | bir JS varlığı engellenir → yeni SW install başarısız, eski build çalışır; ağ kesilir → eski tam build çevrimdışı açılır | ☐ | |

## 4. Notlar
- Bu liste `11` kural 4'e göre kod yazan tarafından yazılan dokümanlardandır; sonuçlar buraya işlenir, spec'e değil.
- Yıkıcı yollar (geri yükleme, sıfırlama) telefonda denenmeden önce dış yedek alınır (`13` §2).
