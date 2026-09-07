# 00_ANAYASA.md — Öğrenme Motoru Anayasası (v1.6, FROZEN)

v1.1 (2026-09-07): A9 QuestionRevision ile uyumlu hâle getirildi; A21 (geri kazanılabilirlik) ve A22 (platform bağımsız çekirdek) eklendi; §3'e veri güvenliği kapsamı girdi.
v1.2 (2026-09-07): A9'a eksik geçmiş kuralı eklendi (sahte geçmiş üretilmez).
v1.3 (2026-09-07): son tutarlılık düzeltmesi — yeni ilke yok; §1 arayüz anlamı diğer dosyalarla eşitlendi.
v1.4 (2026-09-08): dış tasarım incelemesi sonrası — yeni ilke yok; §3'te atom girişine soru yüzü (prompt) zorunlu; yanlış cevap kaydı doğru cevabın gösteriminden önce; geri al 30 sn / bir kez ve ham bağlı; sunulan soru sürümü sabit. 
v1.5 (2026-09-08): ikinci dış inceleme sonrası — yeni ilke yok; geri yükleme günlüğü ve acil geri dönüş, sabit undo hedefi, veri nesli, SW sürüm bütünlüğü, kurtarma okuyucusu (`06`, `13`).
v1.6 (2026-09-08): son denetim — yeni ilke yok; learning çıkış aralığı fixture'ları, bağlam değişince ilişki sıfırlama, legacy sürüm tarihi uydurulmaz, cevap anahtarı hatası düzeltmesi (`content_error` void, K01). **FROZEN — belge denetimi kapandı; sonraki kanıt gerçek kod ve kullanım.**

Bu belge sistemin değişmez ilkelerini içerir. Tablo adı, kütüphane, bileşen adı, UI kilitlemez. Diğer spec dosyaları bu belgeye uymak zorundadır; çelişkide bu belge kazanır.

## 0. Tanım

Bir insanın **bilgi atomları** hakkındaki öğrenme kanıtlarını sürekli toplayan, hafıza durumunu modelleyen ve bir sonraki en değerli öğrenme eylemini seçen kişisel öğrenme motoru. Gün içinde karşılaşılan her bilgi sistemin besinidir. AGS/KPSS ilk veri setidir; motor sınava özel değildir.

Kullanıcının tek görevi: **uygulamayı aç → çalış → kapat.** Ne çalışılacağına kullanıcı değil, motor karar verir. Kullanıcıya ders, konu veya mod seçtirilmez; gösterilecek iş varsa `Bugün → Başla` en fazla tek dokunuştur.

## 1. v0 başarı testi

Tek soru: **Telefonu açtığımda motor bana ne çalışacağımı veriyor mu, ve verdiğim her cevap gelecekteki sırayı gerçekten değiştiriyor mu?**

Evetse v0 başarılıdır. Hayırsa başka hiçbir özelliğin değeri yoktur.

## 2. Değişmez ilkeler

**A1 — Atom öğrenme birimidir.** Bilginin temel birimi tek anlamlı, tek cümlelik bir Atom'dur. Hafıza durumu atoma bağlıdır; konuya, soruya veya derse değil.

**A2 — Soru ölçüm aracıdır.** Bir Question öğrenilen varlık değildir; bir atom hakkında kanıt üreten ölçüm aracıdır. Aynı atom birden çok soruyla, aynı soru (analiz için) birden çok atomla ilişkilendirilebilir.

**A3 — Attempt değiştirilemez tek kaynaktır.** Kullanıcının öğrenme davranışının tek kaynağı, yalnız eklenen (append-only) Attempt kayıtlarıdır. Attempt silinmez, düzenlenmez. Hatalı bir giriş yeni bir AttemptVoid olayıyla geçersiz kılınır; ham tarih korunur, projeksiyonlar void edilmiş kaydı yok sayar.

**A4 — FSRS durumu projeksiyondur.** Hafıza durumu (MemoryState) kaynak veri değildir; Attempt geçmişi + EvidencePolicy + SchedulerConfig'den yeniden üretilebilir. Bu yeniden üretim (REBUILD) her zaman mümkün ve **deterministik** olmalıdır: aynı ham olaylar + aynı yapılandırma → bayt bayt aynı sonuç.

**A5 — Pretest review değildir.** Henüz öğretilmemiş bilgiyi bilmemek unutma değildir. Pretest (ön yoklama) modundaki Attempt kaydedilir ama hafıza durumunu değiştirmez.

**A6 — Primary atom snapshot.** Bir Attempt, o anda hangi atomu ölçtüğünü (`primaryAtomIdAtAttempt`) ve sorunun hangi sürümünü kullandığını kendi içinde taşır. İçerik sonradan değişse bile geçmiş denemelerin anlamı değişmez. v0'da yalnız bu primary atom hafıza durumunu günceller; ikincil atomlar yalnız analiz içindir.

**A7 — Güven ayrımı.** Her soru cevabı üç güven düzeyinden biriyle verilir: emin (sure), tereddüt (unsure), sallama (guess). FSRS'nin sorusu "şıkkı tutturdun mu" değil, "bilgiyi hatırladın mı"dır; sallayarak verilen doğru cevap hafıza açısından başarısız hatırlamadır.

**A8 — Yanlış + emin ayrı sınıftır.** Yanlış cevabın güven bilgisi hafıza zamanlaması için önemsiz (hepsi başarısız), analiz için kritiktir: yanlış + emin, eksik bilgi değil yanlış model demektir ve ayrı ele alınır.

**A9 — İçerik semantiği versiyonludur.** Bir sorunun anlamını değiştiren her düzenleme (metin, seçenekler, doğru seçenek, ana atom) mevcut sürümün üzerine yazılmaz; yeni ve değiştirilemez bir soru sürümü (revision) üretir. Geçmiş sürümün yalnız numarası değil, gerçek metni, seçenekleri, doğru cevabı ve ana atomu yeniden görüntülenebilir kalır. Geçmiş Attempt'lar cevap verdikleri sürümü ve o sürümün ana atomunu taşımaya devam eder. **Eksik geçmiş kabul edilir; sahte geçmiş üretilmez:** eski bir sürümün içeriği mevcut veriden tam olarak kurulamıyorsa, güncel içerik eski sürümmüş gibi kopyalanmaz; o sürüm açıkça "içerik mevcut değil" olarak işaretlenir ve Attempt ile hafıza geçmişi olduğu gibi korunur.

**A10 — Atom kimliği semantik anlamı temsil eder.** Yazım ve dil düzeltmesi aynı atomda yapılır. Atomun anlamı değişiyor, bölünüyor veya birleşiyorsa yeni Atom açılır; eskisi arşivlenir, silinmez.

**A11 — Hafıza durumu ilk gerçek denemeyle başlar.** Bir atomun hafıza durumu, pretest olmayan ilk Attempt'ıyla başlar. Atomu okumak review değildir.

**A12 — Zorunlu giriş minimumdur.** Veri modeli zengin olabilir; kullanıcıdan istenen zorunlu giriş minimumdur. Sistemin kendisinin çıkarabildiği bilgi elle girilmez. Gelecekte lazım olacak ham veri bugünden otomatik toplanır; çıkarım veri yetince yapılır ("collect now, infer later").

**A13 — Encoding ve retrieval ayrıdır.** Motor, bilginin hangi destekle edinildiğini/sunulduğunu (`support`) ve hangi bilişsel işlemle geri çağrıldığını (`operation`) ayrı kavramlar olarak izler. Amaç tek bir ipucuna bağımlı tanıma değil, ipucusuz ve farklı bağlamlarda erişilebilir hafıza oluşturmaktır.

**A14 — Tekrarlayan başarısızlık strateji değiştirir.** Aynı atomda tekrarlayan başarısızlık yalnız tekrar sıklığını artırmaz. Motor uygun olduğunda geri çağırma işlemini veya desteği değiştirir; aynı başarısız strateji kör biçimde tekrarlanmaz.

**A15 — FSRS tek zamanlama otoritesidir.** "Ne zaman tekrar" sorusunu yalnız FSRS cevaplar. Vade tarihi (`due`) yalnız scheduler tarafından yazılır. Uygulama kendi gizli tekrar mantığını kurmaz; "aynı güne ekle", "yarına at" yoktur.

**A16 — Görünürlük vadeyi değiştirmez.** Günlük görünür setin oluşturulması, ilişkili içeriğin eklenmesi, tavan uygulanması veya Re-Exposure kararları FSRS vadelerine dokunmaz. Gösterilmeyen vadeli atom ertesi gün hâlâ gecikmiştir.

**A17 — Yakalama ölçüm değildir.** Dışarıdan gelen soru, merak, hata, fotoğraf, metin, ses birinci sınıf girdidir; ancak yakalama olayı ile hafıza ölçümü aynı şey değildir. Yalnız hafıza durumu olan bir atomun gerçek hatırlama başarısızlığı başarısız review üretir.

**A18 — Yapay zekâ önerir, kullanıcı onaylar.** Yapay zekâ içerik, atom, soru, çengel ve ilişki önerebilir; kullanıcı onayı olmadan kalıcı bilgi modelinin semantiğini değiştiremez.

**A19 — Ham olayların sırası ve zamanı ayrıdır.** Kesin işlem sırası `sequence`, gerçek zaman `timestamp`'tir. Projeksiyonlar `sequence` sırasını kullanır; hafıza hesabı `timestamp`'i kullanır.

**A20 — Çekirdek disiplini.** Bir özellik ancak gerçek çalışma döngüsünü (aç → çalış → kapat) iyileştiriyorsa çekirdeğe girer. "İleride lazım olur" bir gerekçe değildir.

**A21 — Geri kazanılabilirlik ve veri güvenliği.** Kullanıcının içeriğinin ve ham öğrenme geçmişinin kaybı kabul edilemez. Uygulama sürümü, şema veya kod değişikliği kullanıcıyı veritabanını silip sıfırdan başlamaya zorlayamaz. Yıkıcı geri yükleme, içe aktarma ve migration işlemleri ya geri döndürülebilir olur ya da başarısızlıkta eski veriyi olduğu gibi korur. Cihaz içi kurtarma noktası ile cihaz dışı taşınabilir yedek farklı kavramlardır; tarayıcı depolamasının silinme ihtimaline karşı cihaz dışı JSON yedeği nihai felaket kurtarma kaynağıdır.

**A22 — Platform bağımsız çekirdek.** Domain modeli, öğrenme motoru, EvidencePolicy, FSRS adaptör mantığı, REBUILD, DailyQueue ve Re-Exposure kararları tarayıcı, iOS veya Android arayüzüne ya da cihaz API'lerine doğrudan bağımlı olamaz. Aynı öğrenme çekirdeği PWA, iOS ve Android kabuklarından kullanılabilmelidir. Native uygulamaya geçiş hiçbir zaman öğrenme geçmişinin veya veri modelinin yeniden oluşturulmasını gerektirmez; taşınabilir yedek formatı platformlar arasında ortaktır.

## 3. v0 kapsamı

- Atom, çengel (MemoryHook) ve soru girişi; atomda iki zorunlu alan: atom cümlesi ve cevabı vermeyen soru yüzü (prompt); soru girişinde beş zorunlu alan: soru, seçenekler, doğru seçenek, ana atom, kaynak.
- Çalışma döngüsü: günlük görünür set → soru veya hatırlama kartı → cevap → güven → (yanlışsa) neden → Attempt diske → doğru cevap ve açıklama → sonraki öğe. Ölçüm kaydı her zaman doğru cevabın gösteriminden önce yazılır.
- Hatırlama kartı: sorusu olmayan atom için, kaynak kapalı kendi kendine söyleme + öz değerlendirme.
- Yanlış nedeni: üç seçenek + geç.
- Geri al: son cevabı void etme (30 saniye içinde, bir kez); aynı öğe bir kez yeniden sunulur; tekrar kaydı ham bağ taşır.
- Günlük sayılar: tekrar / yapılan / kalan. Seri (streak) yoktur.
- Mikro mod: 3 / 5 / 10 dakika zaman bütçesi, aynı kuyruk üzerinde.
- Yeni atomu okuma ekranı (review değildir), ardından ilk deneme.
- Çevrimdışı çalışan telefon uygulaması; tek dosya JSON yedek alma / yedekten geri yükleme; REBUILD.
- Her Attempt'a `operation` ve `support` alanlarının otomatik yazılması (A12, A13).
- Tek Re-Exposure kuralı: aynı atom art arda aynı sunumla gelmez (soru ↔ hatırlama kartı).
- Veri güvenliği (A21): cihaz içi kurtarma noktaları, taşınabilir tam JSON yedeği, iki aşamalı güvenli geri yükleme, şema migration'ı. Bulut yedek ve senkron değil.
- Platform bağımsız çekirdek (A22): motor bir depo ve platform servisleri sınırı arkasında çalışır; bugünkü kabuk PWA'dır, native paketleme sonradır.
- Modern mobil görsel kalite: semantik vurgu, tasarım token'ları, erişilebilirlik (`14_VISUAL_LEARNING_DESIGN.md`). Süs değil, okunabilirlik.

## 4. v0 dışı

Öğrenme Kutusu (manuel yakalama) ve sonrası; LLM, OCR, konuşma tanıma; Atlas; bulut yedek ve senkron; App Store / Google Play paketleme; gelişmiş Re-Exposure; teşhis/onarım oturumları; öncelik formülü; sınav günü projeksiyonu; ders ağırlığı; raporlar, grafikler, zayıf halka, kalibrasyon, yanlış inançlar ekranı; Mastery Score / coverage skoru; deneme analizi; test-out; ağırlık optimizasyonu; kişiye özel yöntem çıkarımı; bildirim sistemi; bulut, senkron, kimlik doğrulama. Ayrıntı: `10_V0_NON_GOALS.md`.

## 5. Bu belgenin değiştirilmesi

- Bu belge kod yazan tarafından değiştirilemez. Uygulanamaz bir madde görülürse `BLOCKERS.md`'ye yazılır (bkz. `11_CLAUDE_CODE_RULES.md`); karar sahibi kullanıcıdır.
- Değişiklik yalnız iki durumda açılır: kod yazarken çıkan somut bir problem, veya bir haftalık gerçek kullanım verisi.
- Her değişiklik sürüm numarası alır ve tarihlenir. Bölüm 2'deki ilkeler değişirse önceki sürüm arşivlenir.
- Bu belge 200 satırı geçemez; geçerse budanır.
