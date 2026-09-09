# STATUS.md — Proje durum raporu

> **Yeni oturum buradan başlar.** Sırasıyla oku: bu dosya → `BLOCKERS.md` §1 (karar bekleyenler) → `docs/PHONE_CHECK.md` (telefon bulguları ve bekleyen kontroller) → `README.md` (kullanım) → gerekiyorsa `docs/spec/` (değiştirilmez).
> Son güncelleme: **2026-09-09**. Bu dosyayı her önemli turun sonunda güncelle.

---

## 1. Tek paragrafta durum

Kişisel öğrenme motoru v0 **çalışıyor ve yayında**. Spec paketi v1.6 FROZEN'e göre sıfırdan yazıldı (Yol B), 12 fazın hepsi bitti, üstüne sahibinin isteğiyle 7 spec-dışı özellik eklendi (hepsi `BLOCKERS.md`'de gerekçesiyle kayıtlı). Telefonda (iPhone, ana ekran uygulaması) gerçek kullanımda. **329 otomatik test yeşil**, build temiz, çalışma ağacı temiz, canlı sürüm yereldekiyle birebir aynı. Üç bağımsız denetim turunda toplam **20 gerçek hata** bulunup kapatıldı.

| | |
|---|---|
| Repo | `C:\Projeler\ogrenme-motoru` · `https://github.com/ibkhasdemir/ogrenme-motoru` (public) |
| Canlı adres | `https://ibkhasdemir.github.io/ogrenme-motoru/` |
| Son commit | `76c6f11` · toplam 46 commit · etiket `v0.2.0` (Phase 12 kapanışında atıldı) |
| Canlı build kimliği | `8c33c5f6276e` (yerel `dist/build-id.txt` ile aynı) |
| Test | 34 dosya / 329 test yeşil |
| Kaynak | 65 TypeScript dosyası, ~4.500 satır |
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

Ayrıca **BL-45** (geri hareketi: `pushState`/`popstate`, yapışkan başlık, kaydırmalı alt çubuk) ve **BL-48** (görsel cila + yatay taşma düzeltmesi).

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
src/ui/          app.ts (ekran makinesi + gezinme + odak koruma), content.ts, contentImport.ts,
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

## 7. Sıradaki iş — "premium" görsel tur (kullanıcı isteği, 2026-09-09)

Kullanıcının kendi cümleleri: *"biraz makyaj yapalım, UX daha premium dursun, şu an eğreti duruyor"*, *"bir yere basınca iOS'un uygulama açma efekti gibi büyüterek gelsin"*, *"renk paleti daha premium bir şey olabilir"*. Kendisi bunun spec'in sonraki turlarının işi olduğunu biliyor ama **şimdi görmek istiyor**.

Yapılacaklar (yeni oturumda):
1. **Ekran geçiş animasyonu.** Şu an yalnız `screen-in` opaklık geçişi var (`styles.css`). İstenen: dokunulan öğeden büyüyerek açılan iOS tarzı geçiş. Uygulanabilir yol: dokunulan elemanın `getBoundingClientRect`'i alınıp yeni ekranın `transform: scale + translate` ile o noktadan açılması (View Transitions API iOS Safari'de henüz güvenilir değil, elle yapmak gerekir). **`prefers-reduced-motion` mutlaka kapatmalı** (`14` §14).
2. **Renk paleti.** Şu an sıcak bej/lacivert. Daha "premium" bir yön: koyu modda daha derin nötr zemin + tek bir doygun vurgu; açık modda daha yüksek kontrastlı kâğıt tonu. **Kural: ham hex yalnız `styles.css` `:root` bloklarında** (`11` kural 38), bileşenler token adı bilir. Semantik renklerin (doğru/yanlış/uyarı/çengel) anlamı korunmalı, kontrast AA (`14` §9).
3. **Dokunma geri bildirimi ve derinlik.** Kart/liste basılı hâli, birincil düğmede daha belirgin yükselti, ince ayırıcılar.
4. **Sınırlar.** `10` §1: pixel-perfect Apple kopyası, onlarca tema, süs animasyon YASAK. `14` §1 önceliği: öğrenilebilirlik > okunabilirlik > ergonomi > estetik > süs. Yani cila okunabilirliği bozmayacak, çalışma ekranında dikkat dağıtmayacak.
5. Bittiğinde `BLOCKERS.md`'ye **BL-50** olarak yaz (spec `14` revizyonu gerekiyorsa not düş) ve telefon kontrol listesine bir madde ekle.

Kullanıcının 2026-09-09 durum bildirimi: yedek **alındı**, yapay zekâ **düzgün çalışıyor**, site telefonda **çalışıyor**.

---

## 8. Sürüm ve veri güvenliği notları
- Yedek dosyası: tüm içerik + ham öğrenme geçmişi + soru sürümleri + config, SHA-256 sağlama toplamıyla. **API anahtarı yedeğe girmez** (localStorage'da).
- Kurtarma noktaları cihaz içi ve otomatik: günün ilk değişikliği, her geri yükleme/içe aktarma/sıfırlama öncesi, sürüm geçişi öncesi ve sonrası. Tarayıcı verisi silinirse giderler; kalıcı koruma dış dosyadır.
- Geri yükleme iki aşamalı ve doğrulamalı; bozuk yedek aktif veriye dokunmaz; yarım kalan iş açılışta çözümlenir, çözülemezse yazma-kilitli kurtarma ekranı gelir (artık geri hareketiyle terk edilemez).
