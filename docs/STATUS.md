# STATUS.md — Proje durum raporu

> **Yeni oturum buradan başlar.** Sırasıyla oku: bu dosya → `BLOCKERS.md` §1 (karar bekleyenler) → `docs/PHONE_CHECK.md` (telefon bulguları ve bekleyen kontroller) → `README.md` (kullanım) → gerekiyorsa `docs/spec/` (değiştirilmez).
> Son güncelleme: **2026-09-09** (premium görsel tur sonrası). Bu dosyayı her önemli turun sonunda güncelle.

---

## 1. Tek paragrafta durum

Kişisel öğrenme motoru v0 **çalışıyor ve yayında**. Spec paketi v1.6 FROZEN'e göre sıfırdan yazıldı (Yol B), 12 fazın hepsi bitti, üstüne sahibinin isteğiyle 7 spec-dışı özellik eklendi (hepsi `BLOCKERS.md`'de gerekçesiyle kayıtlı). Telefonda (iPhone, ana ekran uygulaması) gerçek kullanımda. **355 otomatik test yeşil**, build temiz, çalışma ağacı temiz, canlı sürüm yereldekiyle birebir aynı. Üç bağımsız denetim turunda toplam **20 gerçek hata** bulunup kapatıldı.

| | |
|---|---|
| Repo | `C:\Projeler\ogrenme-motoru` · `https://github.com/ibkhasdemir/ogrenme-motoru` (public) |
| Canlı adres | `https://ibkhasdemir.github.io/ogrenme-motoru/` |
| Son commit | `76c6f11` · toplam 46 commit · etiket `v0.2.0` (Phase 12 kapanışında atıldı) |
| Canlı build kimliği | `8c33c5f6276e` (yerel `dist/build-id.txt` ile aynı) |
| Test | 35 dosya / 355 test yeşil |
| Kaynak | 67 TypeScript dosyası, ~4.700 satır |
| Uygulama sürümü | 0.2.0 · veri şeması 2 · yedek formatı 2 |

---

## 2. Ne yapıldı (kronolojik)

### 2.1 Çekirdek v0 — Phase -1 … 12 (2026-09-08)
Spec paketi (`docs/spec/00`–`14`, v1.6 FROZEN) tam okundu, `09_IMPLEMENTATION_PLAN.md` **Yol B** (sıfırdan) uygulandı. Her faz kendi "phase N green" commit'iyle kapandı:

| Faz | İçerik |
|---|---|
| -1 | `BASELINE_AUDIT.md`, ortam kurulumu (Node 24 winget ile), bağımlılık pinleri |
| 0 | İskele: TypeScript + Vite + Vitest + Dexie + ts-fsrs **5.4.2** (tam pin), fake-indexeddb + jsdom |
| 1 / 1b | Domain tipleri; kurtarma çekirdeği (kanonik JSON, SHA-256, RecoveryStore, RestoreJournal) |
| 2 | Repository arayüzü + Memory/Dexie gerçekleştirimleri, şema 1→2 migration, kurtarma okuyucusu |
| 3–6 | Attempt olayları, EvidencePolicy v1, scheduler adaptörü (ts-fsrs tek import noktası), REBUILD |
| 7 | DailyQueue, dinamik oturum, geri al = tek seferlik düzeltme tekrarı |
| 8 / 8b | Resolver (soru↔kart), soru sürüm kuralları, K01 cevap anahtarı düzeltmesi, Motor cephesi |
| 9 / 9b | Vanilla TS arayüz (S1–S12), görsel token sistemi (`14`) |
| 10a/b/c | Taşınabilir yedek, kurtarma noktaları, iki aşamalı güvenli geri yükleme, acil geri dönüş, kurtarma ekranı |
| 11 | Çevrimdışı PWA: tam ön-önbellek service worker, güncelleme çubuğu |
| 12 | Kabul ve kapanış: README, BLOCKERS, PHONE_CHECK; `v0.2.0` etiketi |

### 2.2 Yayına alma (2026-09-08)
GitHub reposu açıldı, `.github/workflows/pages.yml` eklendi: her `main` push'unda `npm ci && npm test && npm run build`, `dist/` → `gh-pages` dalı (peaceiris). Pages kaynağı **elle** açıldı (Settings → Pages → gh-pages / root); otomatik açılmıyor, bunu bilmek önemli.

### 2.3 Telefon bulguları ve düzeltmeler (2026-09-08)
Gerçek iPhone kullanımından çıkanlar (`docs/PHONE_CHECK.md` §6'da F-1…F-7 olarak kayıtlı):
- **F-1** Yedek paylaşımından dönüşte Bugün 0/0/0 gösterdi (veri diskteydi). Sebep: iOS arka plandan dönüşte IndexedDB'yi boş okuyor, uygulama bunu "veri değişti" sanıp boş REBUILD yapıyordu. Düzeltme: okuma anomalisi koruması (`Motor.checkExternalChanges` + `content()`, `DexieRepository.reopen`); sessiz boş REBUILD yok, açık hata var.
- **F-2** Ana ekran uygulamasına güncelleme gelmiyordu (Safari sekmesine geliyordu). Düzeltme: uygulama öne gelince de `registration.update()` (en az 60 s arayla).
- **F-3** iOS'ta Safari sekmesi ile ana ekran ikonu **ayrı** veri tutar; ikonu silip yeniden eklemek boş bir uygulama oluşturur. Davranış, hata değil — README'ye yazıldı.
- **F-4** Yapay zekâ çıktısı ```json çitiyle geldiği için metin yapıştırma reddediliyordu → `parseLooseJson` toleransı.
- **F-6** İçe aktarmada dizin parçalandı (115 atom / 37 konu) → ünite kuralı, Ünite alanı, Konular ekranı.

### 2.4 Spec dışı eklenen özellikler (sahibi kararıyla; hepsi BLOCKERS'ta)

| Kod | Özellik | Not |
|---|---|---|
| **BL-38** | **İçerik içe aktarma** — `ogrenme-motoru-icerik/1` biçimi, JSON yapıştır/dosya seç, önizle, ekle | Yalnız ekler; hatalı öğe varsa hiçbir şey eklenmez; `pre_import` kurtarma noktası |
| **BL-39** | **Ünite dizini** — `altbaslik` konu adına `" › "` ile eklenir; İçerik listesi ünite gruplu; **Konular** ekranı (Tümünü seç → ünite altına taşı, yeniden adlandır, birleştir) | Veri modeli iki seviyeli kaldı; gerçek hiyerarşi ertelendi |
| **BL-41** | **Öğrenme Kutusu** — `+ Yakala` ve `Kutu`; işlerken "Bu neden geldi?" (merak / hatırlayamadım / yanlış yaptım + emin miydin / karıştırdım) | `05` §2 kuralı: yalnız hafıza durumu OLAN atomun gerçek başarısızlığı external `again` üretir; F01 üç zaman; F02 null alanlar + tekrar-güvenlik |
| **BL-42** | **İlerleme ekranı** — emindim-ama-yanlıştı, zorlandıkların, konu kapsamı | Uydurma skor yok, yalnız sayım; ekran sıralamayı/vadeleri etkilemez |
| **BL-44** | **Uygulama içi yapay zekâ** — Claude/OpenAI/Gemini, **kullanıcının kendi anahtarıyla**, doğrudan tarayıcıdan | Anahtar `localStorage`'da (yedeğe girmez); üretilen içerik ÖNERİ, aynı önizleme/onay yolundan geçer (A18) |
| **BL-46** | **Kaydırıp arşivle / arşiv görünümü / koşullu kalıcı silme** | Kalıcı silme yalnız hiç ölçülmemiş, sorusu ve başka bağı olmayan atomda |
| **BL-47** | **Okuma → ilk deneme boşluğu** — en az 2 öğe ya da 2 dk | Kullanıcı "konu veriyor hemen ardından soru" dedi; oturum penceresi, scheduler kararı değil |

Ayrıca **BL-45** (geri hareketi: `pushState`/`popstate`, yapışkan başlık, kaydırmalı alt çubuk), **BL-48** (görsel cila + yatay taşma düzeltmesi), **BL-50** (dokunulan noktadan açılan ekran geçişi) ve **BL-51** (tasarım sisteminin yeniden yazılması: serif öğrenme metni, mürekkep birincil eylem, kenarlıksız kartlar) ve **BL-52** (hareket katmanı: kademeli varış, cevap geri bildirimi, yapışkan başlık durumu) ve **BL-54** (kabuk büyümesi: basılan tuş ekrana dönüşür; gezinme simgeleri).

### 2.5 Bağımsız denetimler — 3 tur, 20 gerçek hata
Her tur: ayrı bir ajan spec'i okur, kodu inceler, iddiaları repoda koşturur; bulunan her hata için gerileme testi yazıldı.

| Tur | Kapsam | Bulgu | Testler |
|---|---|---|---|
| 1 | İçe aktarma motoru + arayüzü | 8 (en ciddisi: bayat ad alanı yüzünden **yanlış konunun sessizce birleştirilmesi**) | `phase13d-audit-fixes` |
| 2 | Öğrenme Kutusu | 5 (en ciddisi: çökme sonrası kutu öğesinin kalıcı kilitlenmesi + onaylanmamış Again kalması) | `phase14c-capture-audit` |
| 3 | İlerleme + yapay zekâ + gezinme + arşiv/silme + boşluk | 7 (en ciddisi: **yetim Attempt → yedek geri yüklenemez**; kilit ekranından geri hareketiyle çıkış) | `phase19-audit3` |

---

## 3. Mimari haritası (nerede ne var)

```
src/domain/      saf tipler (01). DOM/Dexie/ts-fsrs YOK.
src/engine/      saf motor: evidence/ scheduler/ (ts-fsrs TEK import) rebuild/ queue/ session/
                 resolver/ question/ backup/ import/ capture/ analysis/
src/app/         uygulama katmanı: motor.ts (cephe), backup.ts, restore.ts, recoveryPoints.ts,
                 contentImport.ts, aiImport.ts, aiSettings.ts, clockSkew.ts
src/store/       repository.ts (arayüz) + memory/ + dexie/ (şema, migration) + recovery/
src/platform/    services.ts (Clock, IdGenerator, HashService, BackupFileService) + ai.ts + web/
src/ui/          app.ts (ekran makinesi + gezinme + odak koruma), transition.ts (ekran geçişi + kabuk büyümesi),
                 icons.ts (gezinme simgeleri), content.ts, contentImport.ts,
                 capture.ts, progress.ts, data*.ts, forms.ts, dom.ts, labels.ts, styles.css
src/pwa/         register.ts (SW kaydı, güncelleme denetimi)
public/sw.js     service worker (build başına tam ön-önbellek)
build/swPlugin.ts Vite eklentisi: manifest + deterministik buildId enjeksiyonu
```

**Değişmez kurallar (kod incelemesinde bunlara bakılır):**
- `due` ataması **yalnız** `src/engine/scheduler/adapter.ts` içinde.
- Attempt / AttemptVoid / QuestionRevision **append-only**; depoda update/delete API'si yok.
- `ts-fsrs` importu yalnız adaptörde; `package.json`'da tam pin (`"ts-fsrs": "5.4.2"`, `^` yok).
- `src/domain/**` ve `src/engine/**` içinde DOM/Dexie/tarayıcı importu yok; engine'de dakika/gün sabiti yok (statik taramalar: `a01`, `a02-a06`, `phase5` U-SC-14).
- MemoryState diske yazılmaz; açılışta REBUILD.
- Yapay zekâ onaysız kalıcı bilgi modelini değiştiremez (A18).

---

## 4. Şu an açık olanlar

### 4.1 Kullanıcının yapacakları (kod işi değil)
1. **Dış yedek al.** 115+ atom var, hâlâ dosya yedeği yok. Veri → Yedek al → Dosyalar'a kaydet.
2. **37 konuyu toparla.** İçerik → Konular → Tümünü seç → `18. yy Osmanlı` → taşı.
3. **Telefon kontrolleri.** `docs/PHONE_CHECK.md`: V-01…V-15 (görsel/erişilebilirlik), M-03…M-07, M-09, M-10, M-UP-02…08, ve bugünün akışları için **Y-01…Y-25**. Y-24 özellikle önemli: yedek dosyasında API anahtarının geçmediğini gözle doğrulama.
4. **Yapay zekâyı denemek isterse** kendi API anahtarını uygulamaya girecek (sohbete yazmayacak).

### 4.2 Karar bekleyen büyük adaylar
| Aday | Neden bekliyor |
|---|---|
| Gerçek 3 seviyeli hiyerarşi (`Topic.parentTopicId`) | Şema 3 + migration + yedek formatı değişikliği ister; şu an ad içi `" › "` ile taşınıyor |
| Kazanım (learning outcome) alanı | Aynı şema turuna bağlı |
| Konu bazlı daha derin analiz / tanı | `10` §1 "zayıf halka, kalibrasyon" v0 dışı; spec revizyonu gerekir |
| Fotoğraf / ses yakalama | `05` §5a **F03**: medya biçimi (sürümlü ek, içerik hash'i) tasarlanmadan açılmaz |
| Bulut yedek | `10` non-goal; iPhone'da sessiz dış yedeğin tek yolu bu (BL-40) |
| Pekiştirme demeti / mini onarım (`05` §4) | Spec "ileride" diyor |

### 4.3 BLOCKERS §1'de duran, varsayılanla ilerlenmiş maddeler
BL-04, BL-05, BL-06, BL-07, BL-08, BL-09, BL-10, BL-11, BL-36 — kullanıcı 2026-09-08'de "varsayılanla ilerle" dedi; hepsi uygulandı, spec sahibi isterse değiştirir. **BL-10** hâlâ soruyor: elde gerçek bir format-1 yedek dosyası varsa fixture ona göre uyarlanır.

---

## 5. Çalışma düzeni (yeni oturum için)

### 5.1 Ortam
```bash
export PATH="/c/Program Files/nodejs:$PATH"   # Bash'te şart
npm test          # 329 test
npm run build     # tsc --noEmit + vite build
npm run dev       # geliştirme sunucusu (SW yok)
```
- Node v24.19.0 + npm 11.17.0 (winget ile kuruldu).
- Git kimliği repo-local ayarlı: `ibkhasdemir <ibkhasdemir@gmail.com>`.
- **Push = yayın.** `main`'e her push CI'da test + build koşturur ve siteyi günceller (2–3 dk). Telefonda "Yeni sürüm hazır · Yenile" çıkar.

### 5.2 Bilinen tuzaklar
- **Bash heredoc** ~10 KB üstünde kırılıyor; büyük dosyalar için `Write` aracını kullan. Karmaşık çok satırlı yamalar için scratchpad'e Python betiği yazıp çalıştırmak en güvenlisi.
- **Otomatik izin modu** bazen `git commit`/`git push`'u engelliyor; engellenirse kullanıcıya Run bloğu ver (PowerShell'de `&&` yok).
- **Gömülü tarayıcı paneli** service worker kaydını engelliyor → SW testleri gerçek Chrome'da (claude-in-chrome).
- Tarayıcı paneli telefon görünümünü **kırpar**; ölçüm için JS ile `getBoundingClientRect`/taşma kontrolü daha güvenilir.
- Testler `data-testid` ve görünen metinle çalışıyor; etiket değiştirirken testleri de güncelle.

### 5.3 Çalışma disiplini (bu projede işe yarayan)
1. Spec'i oku, kuralı uygula, sapıyorsan `BLOCKERS.md`'ye gerekçesiyle yaz. `docs/spec` **asla** düzenlenmez.
2. Önce test, sonra kod; kırmızı testle ilerleme.
3. Her özellik turundan sonra **bağımsız denetim ajanı** çalıştır — üç turda 20 gerçek hata çıkardı, hepsi testlerin gözünden kaçmıştı. Ajana "kaynak dosyayı değiştirme, sadece raporla" de.
4. Her push sonrası canlı `build-id.txt`'yi yerelle karşılaştırarak yayını doğrula.

---

## 6. Public repo — ne açık, ne değil (2026-09-09 tarandı)

Kullanıcı haklı olarak sordu: repo public, risk var mı?

**Repoda OLMAYAN şeyler (kontrol edildi):**
- Öğrenme verisi. Atomlar, sorular, cevap geçmişi **yalnız telefonun tarayıcısında** (IndexedDB). Repoda tek bir kullanıcı atomu bile yok.
- API anahtarı. Anahtar `localStorage`'da, cihazda. `git grep` ile tarandı: tek eşleşme `tests/phase16-ai-ux.test.ts` içindeki **sahte** `sk-ant-gizli-1234` dizesi — bilerek konmuş test verisi, gerçek anahtar değil.
- Yedek dosyası. `.gitignore` `dist/`, `.env*`, `*.key`, `*.pem` vb. kapsıyor; izlenen hiçbir yedek JSON'u yok.

**Açık olan (normal):** kaynak kod, spec paketi, karar kayıtları (`BLOCKERS.md`), telefon kontrol listesi. Bir de git geçmişindeki commit e-postası (`ibkhasdemir@gmail.com`) — GitHub'da olağan; istenirse GitHub ayarlarından e-posta gizliliği açılabilir (`noreply` adresi).

**Kurallar (bunlara uyulduğu sürece sorun yok):**
1. **Yedek dosyasını repoya asla koyma.** İçinde tüm öğrenme geçmişin var.
2. **API anahtarını koda/committe asla yazma.** Uygulamadaki alana gir, orada kalır.
3. Ekran görüntüsü paylaşırken içerikte kişisel not olmamasına dikkat.

**Private yapılabilir mi?** Ücretsiz GitHub hesabında **Pages yalnız public repoda** çalışır. Private'a çekilirse site kapanır (GitHub Pro gerekir). Şu anki içerikle public kalması güvenli.

---

## 7. "Premium" görsel tur — YAPILDI (2026-09-09)

Kullanıcının cümleleri: *"biraz makyaj yapalım, UX daha premium dursun, şu an eğreti duruyor"*, *"bir yere basınca iOS'un uygulama açma efekti gibi büyüterek gelsin"*, *"renk paleti daha premium bir şey olabilir"*. Üçü de yapıldı; ayrıntı ve gerekçe `BLOCKERS.md` **BL-50**'de.

1. **Ekran geçişi.** `src/ui/transition.ts`: son dokunulan nokta izlenir, yeni ekran o noktadan büyüyerek açılır (`screen-push`), geri gidiş uzaklaşarak gelir (`screen-pop`), aynı ekranın adımı yalnız belirir (`screen-fade`). Eski `screen-in` **her render'da** çalışıyordu (aramada her tuşta yanıp sönme); artık yalnız gerçek geçişte.
2. **Palet.** Sıcak bej/tan → nötr-derin sistem; vurgu `#1e4f86` (koyu modda `#8fb9e8`). Semantik rollerin anlamı ve ailesi korundu. Kontrast gerçek Chrome'da ölçüldü: açık temada ≥ 5.5:1, koyu temada ≥ 7.1:1; yatay taşma 0 px.
3. **Dokunma ve derinlik.** Basılı geri bildirim, kapsül gezinme düğmeleri, cam yapışkan başlık, iki katmanlı yumuşak gölge, hafif zeminli bildirim şeridi.

**Bu turun en önemli dersi (tekrarlanmaması için):** geçiş kurallarında `animation-fill-mode: both` KULLANILMAZ. Gerçek tarayıcıda gözlendi: sekme boyanmazken animasyonun zaman çizgisi donuyor, `fill: both` ile ekran `opacity: 0`'da kilitli kalıyordu — yani hareketin bozulması içeriği gizliyordu. Artık fill yok, üstüne `animationend` gelmezse sınıfı düşüren zaman aşımı var. `tests/phase20-visual-polish.test.ts` bu kuralı statik olarak da bekçiliyor.

### 7.2 İkinci tur — BL-51 "editoryal sakinlik" (aynı gün)
Kullanıcı BL-50'den sonra **"hiçbiri olmamış, ultra premium istiyorum"** dedi. İki sebep de gerçekti:
- **Telefon eski sürümü gösteriyordu.** Canlı CSS denetlendi, yayın doğruydu; ana ekran uygulaması service worker kopyasını gösteriyordu. **Ders: görsel bir turdan sonra ilk iş kullanıcıya "Yenile"ye bastığını doğrulatmak** (telefon listesine Y-30 olarak eklendi).
- **BL-50 gerçekten fazla ölçülüydü.** `#f6f5f1 → #f3f2ef` gibi farklar telefonda ayırt edilmiyor. Cila yetmedi, sistem değişti.

`styles.css` tek tutarlı sistem olarak yeniden yazıldı: öğrenme metni **sistem serif** / arayüz sans (§6 bunu serbest bırakır); birincil eylem **mürekkep kapsül**, mavi yalnız anlam taşır (§18); açık temada kartlar **kenarlıksız**, gölgeyle ayrışır; Bugün sayıları tek kart içinde saç teli bölmeler; yarıçap hiyerarşisi; kırıntı harf boşluklu büyük harf; geçiş 320 ms / `scale(0.86)` ve ileri gidişte sayfa başa sarar.

**iOS özel:** `:active` sözde-sınıfı iOS Safari'de yalnız sayfada bir dokunma dinleyicisi varsa tetiklenir. BL-50'nin basılı geri bildirimleri telefonda bu yüzden hiç görünmemişti; boş bir `touchstart` dinleyicisi eklendi. Ayrıca `index.html` `theme-color` ve `manifest.webmanifest` renkleri yeni zemine çekildi.

Ölçüm: açık temada en düşük kontrast 4.67:1, koyu temada 7.04:1, yatay taşma 0 px. Ayrıntı `BLOCKERS.md` **BL-51**.

### 7.3 Üçüncü tur — BL-52 hareket katmanı
Kullanıcı tasarımı onayladı, "animasyonlar eksik" dedi. `14` §14 hareketi bir listeyle sınırlar (cevap geri bildirimi, kart geçişi, durum değişimi, yeni içeriğin açılması, sheet, ilerleme) ve bounce/konfeti/oyunlaştırmayı yasaklar; `10` §1 de "süs amaçlı ağır animasyon"u non-goal sayar. Bu turda **listenin izin verdiği ama hiç kullanılmamış** yerler dolduruldu: kademeli varış, cevap geri bildirimi (sonuç kelimesi + doğru/yanlış dolgusu), seçim noktası, grup açılışı, geri al çubuğu, yapışkan başlık durumu.

**BL-52 bozuk çıktı, BL-53'te düzeltildi.** `animationend` kabarcıklanır; temizleyici ekran köküne `{ once: true }` ile bağlıydı ve kademeli varış gelince **en hızlı çocuğun bitişi** ekranın sınıfını düşürüp henüz bitmemiş bütün animasyonları kesiyordu — ekran yarı yolda zıplıyordu. Kullanıcı bunu "pop up mı yaptın, açılıyor kapanıyor" diye bildirdi. Yama: `ev.target === el` kontrolü, `once` kaldırıldı. **Hareketin şiddeti korundu** — kullanıcı "ona benzer bir şey yap demiştim" deyince ilk refleksle yapılan kısma geri alındı; beğenilen efektin kendisi değil, kesilmesi sorundu. Ayar tek token: `--motion-settle`, `--motion-screen`.

Üç kalıcı ders:
- **Kap düzeyinde animasyon temizliğinde hedef kontrolü şart.** İçeriye sonradan animasyon eklendiğinde sessizce bozulur.
- **`animation-delay` kullanma.** Gecikmeli girişte öğe önce görünür sonra kaybolur; bunu ancak `fill-mode` gizler, `fill-mode` ise donmuş animasyonda içeriği yok eder (BL-50). Çözüm: hepsi aynı anda başlar, **farklı sürelerde varır**. Test bunu bekçiler.
- **`.is-stuck` ölü kuraldı.** BL-45'te CSS'e yazılmış, hiçbir yerde açılmamıştı. Yeni bir görsel kural yazarken "bunu kim açıyor?" sorusu sorulmalı.

### 7.4 Dördüncü tur — BL-54 kabuk büyümesi
Kullanıcı istediğini tarif etti: *"o tuş alttan ortaya doğru büyüyerek hareket edecek, sonra içi açılacak içindekiler gelecek."* Yapıldı: dokunulan tuşun boş bir kopyası ("kabuk") tuşun tam kutusundan, tam yarıçapından, tam renginden başlayıp ekranı kaplayacak biçimde büyür ve yolun **%72'sinde tamamen erir**; yeni ekran aynı kutudan açılan yuvarlak dikdörtgenle (`clip-path`) ortaya çıkar; içerik kademeli olarak yerine oturur. Dokunulan kutu `pointerdown` anında en yakın `button / a / [role=button] / .list-item / .chip` atasından okunduğu için **liste satırından atom ekranına geçiş de** aynı biçimde açılır. Ayrıca yedi gezinme düğmesine tek aileden simge eklendi (`src/ui/icons.ts`) — simge etiketin yerine geçmez, önüne gelir (`14` §9).

Erken erime bilinçli: mürekkep birincil düğmede kabuk sonuna kadar opak kalsaydı tam ekran siyah bir kare çakması olurdu.

Kabuk `aria-hidden` + `pointer-events: none`, bitişte ve emniyet zaman aşımında **mutlaka** silinir (geride görünmez bir katman kalsa dokunmayı engellerdi), `prefers-reduced-motion` açıkken hiç kurulmaz, `Element.animate` yoksa sessizce CSS geçişine düşülür.

**BL-54 ilk denemede okunmuyordu, BL-55'te düzeltildi.** İki sebep: (a) ikincil düğmenin zemini beyaz, sayfa zemini kâğıt beyazı — büyüyen kabuk görünmüyordu; (b) içerik dokunulan taraftan bağımsız olarak hep aşağıdan geliyordu. Yama: kabuğun arkasına ekranı bir anlığına kısan **perde** (`--scrim`), kabuğa güçlü gölge (`--elev-2`), ve geliş yönünü dokunuş yerine bağlayan `--settle-dy`.

### 7.5 Beşinci tur — BL-56 koyu palet + cam dili
Kullanıcı: *"renk paletini koyulaştırman lazım, daha güzel semboller kullan, biraz da yapay duruyor"* ve *"iOS 26 ile gelen cam efekti; efekt çerçevesi cam olursa... var olan efekti biraz yavaşlatıp kenarlarına cam koy, alttaki kayan butonlara da ekleyebilirsin."*

- **Palet koyulaştı ve ısındı**: zemin `#e6e1d6`, kart **saf beyaz değil** (`#faf8f4`), mürekkep sıcak (`#191712`). Koyu tema `#0b0a09`.
- **"Yapay duruyor"un sebebi: her şey yüzüyordu.** İkincil düğme, çip, grup satırı hepsi gölgeliydi. Gölge artık yalnız kart, birincil eylem ve geçici çubuklarda.
- **Cam dili**: büyüyen kabuk camdır (yarı saydam tint + `blur(20px)` + ışık halkası + üst parıltı); alt gezinme **tek yapışkan cam çubuk** oldu; başlık, geri al çubuğu ve perde aynı tarifi kullanır. Hepsinin `@supports` düşüşü var.
- **Hareket yavaşladı**: ekran 320 → 420 ms, kabuk 340 → 460 ms, kademeli varış 240 → 300 ms.
- **Simgeler yeniden çizildi** (tek ızgara, tek çizgi kalınlığı). `.group-sub` kullanıcı içeriğini büyük harfe çeviriyordu — Türkçe i/İ bozulduğu için kaldırıldı.

Ölçüm: açık temada en düşük kontrast 4.68:1, koyu temada 6.84:1, yatay taşma 0.

### 7.6 Altıncı tur — BL-57 çapalı geçiş + alt çubuğun yeniden kurulması
Kullanıcı: *"efekt çok amatörce, hepsi aynı şekilde açılıyor"*, *"sağa kaydırıp geri gelince alt taraf baştaki öğelere dönüyor"*, *"iğrenç alt taraf"*, *"3 taraftan sadece olmaz ki, ara yerden basınca neresinden ölçekleyecek?"*

- **Geçiş dokunulan NOKTAYA çapalandı.** Eski kabuk kutudan kutuya interpolasyon yapıyordu; nereye basılırsa basılsın aynı hareket çıkıyordu. Yeni kabuk ekran boyunda, `transform-origin` parmağın tam pikseli, küçükten büyüğe ölçekleniyor → hareket o noktadan çapraz yayılıyor. **Üç köşe/durum yok; çapa sürekli bir koordinat**, ara noktaların ayrı kuralı da yok. Cam kenarı ölçekle incelmesin diye karşı-ölçekleniyor (`border-width` ≈ 1/ölçek).
- **Alt çubuğun asıl kusuru biçimsel değildi: yedi düğme sığmıyordu** (390 px ekranda 446 px istiyordu). `07` §6'nın "en fazla dört alan" kuralına inildi: Yakala · Kutu · İçerik · Veri, simge üstte etiket altta, kaydırma yok. **+ Atom / + Soru İçerik ekranına**, **İlerleme** sayıların altına taşındı.
- **Bildirilen hata:** kaydırılan çubuk her yeniden çizimde başa dönüyordu (`scrollLeft` korunmuyordu — odak ve açık paneller için yapılan koruma çubuk için yapılmamıştı). `captureScroll`/`restoreScroll` eklendi.

**BL-58 — kullanıcının teşhisi:** *"ilk açılma ekranı çok büyük ya."* Doğruydu. Kabuğun başlangıç ölçeği `max(genişlik oranı, yükseklik oranı)` ile hesaplanıyordu; tam genişlikteki her öğede (birincil düğme, her liste satırı) oran 1'e yaklaşıp üst sınıra çarpıyor, kabuk %60'tan başlıyordu — 1.67 kat büyüme, neredeyse görünmez. Alt çubuk düğmesinde 0.22 çıktığı için efekt orada görünüp listede görünmüyordu; "hepsi aynı / bazen yok" hissinin kaynağı buydu. Ölçek artık **alan oranından** (iki kenarın geometrik ortalaması) geliyor: birincil düğme 0.60 → 0.23, liste satırı 0.60 → 0.26.

**Ders:** "en büyük kenar" bir öğenin ekrandaki ağırlığını temsil etmez; bu arayüzün çoğunluğu tam genişlikte ama alçak öğelerdir.

**Kalan:** telefonda Y-26…Y-35.

### 7.1 Sıradaki iş adayları
Kullanıcı yeni bir yön vermezse §4.2'deki büyük adaylardan biri seçilir. Görsel tarafta bir sonraki doğal adım **semantik metin vurgusu** (`14` §5): `renderText(text, spans?)` zaten tek geçiş noktası, tarih/istisna/kişi vurgusu oradan eklenebilir. Spec revizyonu gerektirmez ama içerik varlığına isteğe bağlı sunum notu ekler; önce `BLOCKERS.md`'ye yazılmalı.

## 8. Sürüm ve veri güvenliği notları
- Yedek dosyası: tüm içerik + ham öğrenme geçmişi + soru sürümleri + config, SHA-256 sağlama toplamıyla. **API anahtarı yedeğe girmez** (localStorage'da).
- Kurtarma noktaları cihaz içi ve otomatik: günün ilk değişikliği, her geri yükleme/içe aktarma/sıfırlama öncesi, sürüm geçişi öncesi ve sonrası. Tarayıcı verisi silinirse giderler; kalıcı koruma dış dosyadır.
- Geri yükleme iki aşamalı ve doğrulamalı; bozuk yedek aktif veriye dokunmaz; yarım kalan iş açılışta çözümlenir, çözülemezse yazma-kilitli kurtarma ekranı gelir (artık geri hareketiyle terk edilemez).
