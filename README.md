# Öğrenme Motoru — v0 (0.2.0)

Kişisel öğrenme motoru: uygulamayı aç → çalış → kapat. Ne çalışılacağına kullanıcı değil motor karar verir (`docs/spec/00_ANAYASA.md`).
Spec paketi v1.6 FROZEN; bu gerçekleştirim `docs/spec/09_IMPLEMENTATION_PLAN.md` Yol B (sıfırdan) ile üretildi.

Vanilla TypeScript + Vite + Vitest + Dexie + ts-fsrs **5.4.2** (tam pin). Çevrimdışı PWA. Çerçeve, LLM, backend, bulut yok.

## Kurulum

Gereksinim: Node.js ≥ 20 (geliştirme sırasında Node 24 LTS kullanıldı).

```bash
npm install
npm test          # 242 otomatik test (birim, entegrasyon, jsdom uçtan uca, statik taramalar)
npm run build     # tsc --noEmit + vite build → dist/ (service worker manifesti build sırasında enjekte edilir)
npm run dev       # geliştirme sunucusu (service worker yok; PWA davranışı için build + preview)
npm run preview   # dist/'i yerel sunar (127.0.0.1)
```

## Telefonda açma

PWA için HTTPS (veya localhost) gerekir.

1. `npm run build` → `dist/` klasörünü herhangi bir statik HTTPS sunucusuna koy (GitHub Pages, Netlify, kendi sunucun). `base: './'` olduğu için alt yolda da çalışır.
2. Telefonda tarayıcıdan adresi aç. İlk açılışta service worker o build'in **tüm** varlıklarını önbelleğe alır.
3. **iPhone:** Safari → Paylaş → "Ana Ekrana Ekle". **Android:** Chrome → menü → "Ana ekrana ekle / Uygulamayı yükle".
4. Ana ekrandan açılış standalone'dır; uçak modunda tam döngü çalışır.
5. Yeni sürüm yayımlandığında: uygulama arka planda indirir (açılışta ve uygulama öne gelince denetler), bitince Bugün/Veri ekranında "Yeni sürüm hazır · Yenile" çıkar. Yenile'ye basmazsan çalışan oturum değişmez; tüm sekmeler kapanıp yeniden açılınca yeni sürüm gelir. Güncelleme kullanıcı verisine dokunmaz.
6. **iPhone notu:** Safari sekmesi ile ana ekran uygulaması **ayrı** veri tutar ve ayrı güncellenir. İkonu silip yeniden eklemek yeni, **boş** bir uygulama oluşturur; eski ikonun verisi onunla gider. Tek ikon kullan; güncelleme ikonun içinde gelir, ikonu yeniden ekleme. Bir cihazdan diğerine (ya da Safari ↔ ikon) veri taşımanın tek yolu yedek dosyasıdır.

Telefonda el ile kontrol listesi: `docs/PHONE_CHECK.md` (V-01…V-15, M-01…M-10, M-UP-01…08).

## Kullanım (kısaca)

- **Bugün → Başla**: motor sıradaki öğeyi seçer (vadeli önce, sonra yeni). Ders/konu/mod seçilmez. `3 dk / 5 dk / 10 dk` aynı kuyrukta zaman bütçesidir.
- **Yeni atom** önce okunur (review değildir), sonra ilk deneme gelir.
- **Soru**: seçenek → Cevapla → güven (Eminim / İki şık arasında kaldım / Salladım) → yanlışsa neden çipi → sonuç. Kayıt her zaman doğru cevabın gösteriminden önce diske yazılır.
- **Hatırlama kartı**: soru yüzü → (Çengeli göster) → Cevabı aç → Hatırladım / Zorlandım / Hatırlayamadım.
- **Geri al**: kayıttan sonraki 30 saniye içinde, bir kez; aynı öğe aynı sürümle bir kez yeniden sunulur. Ham kayıt silinmez, `AttemptVoid` yazılır.
- **+ Atom**: ders, konu, atom cümlesi ve **soru yüzü** zorunlu. **+ Soru**: soru, 2–5 seçenek, doğru seçenek, ana atom, kaynak zorunlu.
- **İçerik**: atom/soru listesi, arşivle (silme yok), soru düzenleme yeni sürüm üretir, sürüm geçmişi.

## Yedek ve geri yükleme (Veri ekranı)

Veri bir dosyadır; senkron yok, birleştirme yok, geri yükleme tam değiştirmedir.

- **Yedek al** → `ogrenme-motoru-backup-YYYY-MM-DD-HHmmss-SSS-<id>.json`. Tüm içerik, tüm ham öğrenme geçmişi (Attempt + AttemptVoid), soru sürümleri ve yapılandırma; SHA-256 sağlama toplamı. Telefonda Dosyalar / iCloud Drive / Google Drive'a kaydet. Kaydetme gözlemlenemediyse "İndirme başlatıldı… doğrula" + **Kaydettim** teyidi ister.
- Bugün ekranı 7 günden eski yedekte veya 250 yeni öğrenme olayında hatırlatır; hiç yedek yoksa "Yedek durumu bilinmiyor · Yedek al".
- **Yedekten geri yükle** → Dosya seç → doğrulama (sağlama toplamı, bütünlük, deneme hesabı) → özet ("Mevcut verin bu yedekle değiştirilecek") → **Bu yedeğe geri dön**. Önce mevcut durumdan otomatik bir **kurtarma noktası** alınır; yazılamazsa geri yükleme başlamaz. Bozuk yedek aktif veriyi asla değiştirmez.
- **Kurtarma noktaları**: cihaz içi tam kopyalar (geri yükleme/sıfırlama öncesi, sürüm geçişi, günlük). Tarayıcı verisi silinirse bunlar da gider; kalıcı koruma dış yedektir.
- **Tüm veriyi sıfırla**: iki onay; öncesinde kurtarma noktası.
- Eski sürümle alınmış yedekler (format 1) okunur ve bellekte güncel formata çevrilir; eski soru sürümlerinin metni yoksa "eski veri modelinde saklanmadığı için mevcut değil" olarak işaretlenir, uydurulmaz.
- Farklı bir zamanlayıcı sürümüyle alınan yedek: ham geçmiş ve içerik olduğu gibi yüklenir, hafıza durumu kurulu motorla yeniden hesaplanır (uyarı gösterilir).

## Mimari (özet)

```
src/domain      saf tipler (01)                        src/store       Repository arayüzü; Memory ve Dexie gerçekleştirimleri; migration 1→2; kurtarma deposu
src/engine      EvidencePolicy, scheduler adaptörü      src/platform    Clock, IdGenerator, HashService, BackupFileService (arayüz + web)
                (ts-fsrs'in TEK import noktası), REBUILD,  src/app         Motor cephesi, yedek/geri yükleme orkestrasyonu, saat tutarsızlığı
                DailyQueue, Resolver, Session, yedek     src/ui          vanilla TS ekranlar, token'lar (styles.css)
                doğrulama (platformdan bağımsız)          public/sw.js    service worker (build başına tam ön-önbellek)
```

Kurallar: `due` yalnız scheduler adaptöründe yazılır; Attempt/AttemptVoid/QuestionRevision yalnız eklenir (depoda update/delete yok); MemoryState diske yazılmaz, açılışta REBUILD.

## Belgeler

- `docs/spec/` — spec paketi v1.6 (değiştirilmez)
- `BASELINE_AUDIT.md` — Phase -1 (Yol B) ve ortam bulguları
- `BLOCKERS.md` — spec çelişkileri, uygulanan varsayılanlar, karar bekleyen maddeler
- `docs/PHONE_CHECK.md` — telefonda el ile kontrol listesi

## Sürüm notu — 0.2.0 (2026-09-08)

- Uygulama sürümü 0.2.0 · veri şeması 2 · yedek formatı 2 · zamanlayıcı ts-fsrs 5.4.2 / FSRS-6 / hedef hatırlama 0.90 / fuzz kapalı · EvidencePolicy v1.
- Phase 0–11 tamamlandı; 236 otomatik test yeşil; `yedek → ana DB sil → geri yükle → REBUILD` eşitliği (B-01) geçer.
- Service worker yaşam döngüsü (tam ön-önbellek, bekleyen sürüm, tek istemci yenileme, eski önbellek temizliği) masaüstü Chrome'da doğrulandı; telefon kontrolleri `docs/PHONE_CHECK.md`'de bekliyor.
- Açık kararlar ve uygulanan varsayılanlar: `BLOCKERS.md` §1.
