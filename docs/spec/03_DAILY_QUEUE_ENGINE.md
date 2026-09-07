# 03_DAILY_QUEUE_ENGINE.md — Günlük Kuyruk Motoru

Revizyon 2: oturum kuyruk snapshot'ı kaldırıldı; sonraki öğe her seferinde güncel MemoryState ile seçilir (§3, §6). Sebep: snapshot, FSRS'nin 1 dakika sonra vadeye düşürdüğü atomu listenin bitmesine kadar bekletiyordu; bu, vade tarihini fiilen geciktiren gizli bir zamanlayıcıydı (A15 ihlali).

Referans: `00_ANAYASA.md` A15, A16, A20; `01_DOMAIN_MODEL.md` §6; `02_EVIDENCE_FSRS_ENGINE.md` §3.

## 1. Üç ayrı soru, üç ayrı bileşen

| Bileşen | Soru | Yazdığı şey | Okuduğu şey |
|---|---|---|---|
| FSRS (scheduler) | **Ne zaman** tekrar gerekli? | `MemoryState.due` | ReviewEvent |
| DailyQueue | **Şu an hangi atom** gösterilmeli; bugün kaç tane? | tek aday (`selectNext`) veya aday listesi (`buildQueue`, yalnız görüntüleme) | Atom, MemoryState, QueueConfig, bugünkü Attempt'lar |
| Resolver | Seçilen atom **hangi somut eylemle** gösterilir? | LearningAction | Question, Attempt geçmişi, MemoryState.lastAttemptKind |

DailyQueue ve Resolver **hiçbir şeyi diske yazmaz** ve `due`'ya dokunmaz (A16). Yalnız FSRS adaptörü `due` yazar (A15).

## 2. QueueConfig

```json
{ "reviewCap": 25, "newPerDay": 10 }
```
- `reviewCap`: **gerçek günlük benzersiz tekrar tavanı.** Bir yerel günde tekrarına **başlanan** farklı (distinct) atom sayısının üst sınırı. Aynı atomun aynı gün öğrenme/yeniden öğrenme adımıyla tekrar gelmesi tavana **ikinci kez sayılmaz**; atom o gün bir kez "başlamış" sayılır. Aday penceresi tavanı değildir.
- `newPerDay`: bir yerel günde **başlatılan** farklı yeni atom sayısının üst sınırı.
- İkisi de `Attempt` geçmişinden hesaplanır (§3.3); bellekte sayaç tutulmaz, böylece dinamik seçim tavanı delemez ve uygulama yeniden açılınca sayım kaybolmaz.
- Ayarlar ekranından değiştirilebilir; değişiklik yalnız görünürlüğü etkiler, hafıza durumunu etkilemez.

## 3. Seçim politikası (v0)

### 3.1 Girdi
`atoms` (archived = false), `memory` (atomId → MemoryState), `now`, `config`, `todayAttempts` (yerel günde void edilmemiş Attempt'lar).

### 3.2 Bugünkü sayaçlar (Attempt geçmişinden)
```
startedToday(todayAttempts)   = { a.primaryAtomIdAtAttempt : a.mode = "new" }      // bugün yeni başlatılan distinct atomlar
reviewedToday(todayAttempts)  = { a.primaryAtomIdAtAttempt : a.mode = "review" }   // bugün review Attempt'ı olan distinct atomlar
reviewQuotaAtoms              = reviewedToday − startedToday                        // bugün eski backlog'dan açılan distinct atomlar
```
Pretest ve external Attempt'lar sayılmaz. Void edilmiş Attempt'lar sayılmaz. Gün sınırı cihazın yerel gece yarısı.

Amaç: `newPerDay` bugün yeni öğrenilen atom sayısını sınırlar; `reviewCap` eski review backlog'undan bugün açılan **benzersiz** atomları sınırlar; bir atom bir kez başladıktan sonra FSRS'nin learning/relearning adım devamı (continuation) günlük tavanla **kesilmez**.

### 3.3 Tek aday seçimi — `selectNext`
Oturum içinde her öğeden sonra çağrılır; **her çağrı güncel MemoryState ve `now` ile** yeniden değerlendirir.
```
eligibleDue(atoms, memory, scheduler, now, config, todayAttempts):
  active   ← atoms where archived = false and studyable(a)     // studyable: prompt dolu (01 §2.3)
  started  ← startedToday(todayAttempts)
  rvd      ← reviewedToday(todayAttempts)
  quota    ← rvd − started                                      // reviewQuotaAtoms
  remainingReview ← max(0, config.reviewCap − |quota|)

  cont ← [] ; backlog ← []
  for a in active:
    s ← memory[a.id]
    if s exists and s.due <= now:
      item ← { atomId: a.id, reason: "due", retrievability: scheduler.retrievability(s, now) }
      // continuation: bugün new başlatılmış VEYA bugün review'una başlanmış VEYA FSRS öğrenme adımında (state ∈ {Learning, Relearning})
      if a.id ∈ started or a.id ∈ rvd or s.state ∈ {1, 3}: cont.push(item)
      else: backlog.push(item)
  sort backlog by (retrievability ASC, due ASC, atomId ASC)
  chosen ← cont ++ backlog[0 : remainingReview]              // eski backlog'dan yalnız kalan kota kadar
  sort chosen by (retrievability ASC, due ASC, atomId ASC)   // tek sıralama: continuation önceliği yoktur; R eşitse (gün içi R=1) en eski vade önce
  return chosen

eligibleNew(atoms, memory, config, todayAttempts):
  started ← startedToday(todayAttempts)
  remainingNew ← max(0, config.newPerDay − |started|)
  fresh ← active where memory[a.id] does not exist
  sort fresh by (subject.sortOrder, topic.sortOrder, atom.sortOrder, atom.id)
  return fresh[0 : remainingNew] as { reason: "new", retrievability: null }

buildQueue(...) = eligibleDue(...) ++ eligibleNew(...)        // görüntüleme ve tahmin
selectNext(...) = buildQueue(...)[0] ?? null                  // seçim; aynı yardımcılar, aynı sıra
```

### 3.4 Kurallar
1. Vadeli atom her zaman yeni atomdan önce gelir; yeni atom yalnız o an uygun vadeli atom yokken gelir.
2. `due <= now` milisaniye hassasiyetinde; tam eşitlik vadeli sayılır.
3. `selectNext` **hiçbir şeye yazmaz**; `due` değişmez (A16). Tavan dışında kalan vadeli atomun vadesi değişmez; ertesi gün hâlâ gecikmiştir ve düşük R ile öne gelir. Birikim ekranı, "erteleme", "yeniden dağıtma" yoktur.
4. Tavanlar `Attempt` geçmişinden hesaplandığı için dinamik seçim tavanı delemez: `|quota|` yalnız eski backlog'dan gelen gerçek review Attempt'larıyla büyür; `|started|` yalnız gerçek `new` Attempt'larıyla büyür. Oturumun kaç kez `selectNext` çağırdığının önemi yoktur. Bugün `new` başlatılan atomun aynı günkü ilk learning review'u (mode = review) `quota`'ya girmez, çünkü `started` içindedir; `reviewCap = 0` olsa bile o atom vadesi gelince gelir.
5. Az önce cevaplanan atom, FSRS onu `due <= now` yapmadıkça **gelmez**. Yanlış yapıldı diye elle öne çekilmez; öğrenme adımı dolduğunda kendiliğinden uygun olur. Uygulama dakikayı kendi hesaplamaz; `scheduler.next` tarafından yazılan `due`'yu kullanır.
6. R eşitliğinde `due` ASC (en eski vade önce; pinli kütüphane gün içinde R = 1 döndürdüğünden bu eşitlik sık görülür), sonra `atomId` ASC; determinizm için zorunlu.
7. Pretest edilmiş ama hafıza durumu olmayan atom hâlâ "başlanmamış"tır.
8. Bir atom `new` olarak seçilip okunduktan sonra ilk denemesi yapılmadan oturum kapanırsa `started` kümesine girmez; ertesi çağrıda yeniden `new` olarak gelir.
9. Kalan kotalar her zaman `max(0, limit − kullanım)`; tavan gün içinde kullanımın altına indirilirse liste boş kalır, negatif sayı hiçbir yerde görünmez. Ayarlar sonlu, negatif olmayan tamsayı kabul eder.
10. Gece yarısını aşan öğrenme adımı: 23:59'da Again yiyen atom 00:09'da `started`/`rvd` kümelerinde değildir; continuation muafiyeti bu yüzden FSRS durumuna da bakar (`state ∈ {Learning, Relearning}`), atom tavana takılmaz. Kota sayımı değişmez.
11. Uygun aday yalnız çalışılabilir atomdur: `prompt` boş olan atom kuyruğa girmez, İçerik ekranında "soru yüzü eksik" olarak listelenir (`01` §2.3).

### 3.5 Görüntüleme için liste — `buildQueue`
Bugün ekranındaki "Başla · N öğe" ve sayılar için, `selectNext` ile **aynı uygunluk kuralları** kullanılarak o anki adayların listesi üretilir:
`buildQueue` ve `selectNext` §3.3'teki **aynı** `eligibleDue` / `eligibleNew` yardımcılarını kullanır; `selectNext` tanım gereği `buildQueue[0]`'dır. Continuation atomları kotadan kesilmez ama sırada öncelik almaz: uygun küme belirlendikten sonra tek ölçüt `(R, atomId)`. Karşı örnek (U-DQ-13): A bugün çalışılmış ve yeniden vadeli R=0.90, B eski backlog R=0.20, kota var → ikisi de uygun, ikisinde de ilk öğe B.
Bu liste yalnız gösterim ve tahmin içindir; oturum bu listeyi **sırayla tüketmez**. Oturum her adımda `selectNext` çağırır.

### 3.6 Yeni atom sırası (deterministik)
Sıralama anahtarı: `(Subject.sortOrder, Topic.sortOrder, Atom.sortOrder, Atom.id)`. "Aktif ders" kavramı yoktur; sıra global çalışma planıdır. Bir atom başlatıldığı anda (ilk `new` Attempt) `memory`'de yer alır ve `fresh` listesinden düşer; aynı gün tekrar gelmesi yalnız FSRS vadesiyle olur.

## 4. Resolver

### 4.1 Girdi
`atomId`, tüm Question'lar, tüm Attempt'lar (void'ler dâhil değil; Resolver void'e bakmaz, `lastAttemptKind` projeksiyondan gelir), `memory`.

### 4.2 Algoritma
```
resolve(atomId, questions, revisions, attempts, memory):
  own ← questions where primaryAtomId = atomId
                    and archived = false
                    and QuestionRevision(q.id, q.currentVersion).integrityStatus = "complete"   // aday sözleşmesi
  if own is empty: return { kind: "recall", atomId, actionId: newId() }

  // T20: aynı atom art arda aynı sunumla gelmez
  if memory[atomId]?.lastAttemptKind = "question": return { kind: "recall", atomId }

  lastTrySequence ← map questionId → max(attempt.sequence) over attempts where kind = question   // A19: sıra = sequence
  sort own by (hiç çözülmemiş önce, lastTrySequence[q.id] ASC, q.id ASC)
  return { kind: "question", questionId: own[0].id, questionVersion: own[0].currentVersion, actionId: newId() }
  // sunum anında sürüm SABİTLENİR; cevap bu revision'a göre değerlendirilir (01 §4.2a), kayıt anındaki baş kayda bakılmaz
```

### 4.3 Kurallar
- Soru seçimi **güncel** `Question.primaryAtomId`'ye bakar (sunum kararı); hafıza güncellemesi ise Attempt'a yazılan snapshot'a bakar (`02` §5.6). İki farklı soru, iki farklı kaynak; karıştırılmaz.
- Yakınlık `timestamp` ile değil `sequence` ile ölçülür (A19: kesin olay sırası sequence, timestamp yalnız gerçek/hafıza zamanı). Cihaz saati geriye gitse bile rotasyon doğru devam eder (U-RS-06).
- `lastTrySequence` hesabında void edilmiş Attempt'lar da sayılır (soru gösterilmiştir; tekrarını azaltmak amaç). Bu bilinçli bir seçimdir.
- Sorusu olan atomda dönüşüm: soru → kart → soru → kart. Sorusu olmayan atom her zaman kart.
- Aynı sorunun art arda gelmesi ancak atomun tek sorusu varsa ve arada kart gelmişse olur; bu kabul edilir.
- Resolver sonuçta hiçbir şey yazmaz.
- Arşivli soru (`archived = true`) aday değildir; yalnız arşivli sorusu olan atom kart yoluna düşer; arşivli sorunun geçmişi korunur (U-RS-07).
- Soru gösterilirken sürüm **sunum anında** sabitlenir (`questionVersion` LearningAction'da); kullanıcı v1'i açıkken soru başka yerde v2 olsa bile cevap, doğruluk, seçenekler ve ana atom v1'e aittir (U-RS-08, I-09). `actionId` çift dokunmaya karşı kayıt kimliğidir (`01` §4.1).

### 4.4 Hatırlama kartı (RecallCard)
- Gösterilen: `Atom.prompt` (zorunlu alan, `01` §2.3). Konu adından üretilen genel bir soru **yoktur**; prompt'suz atom zaten kuyruğa girmez.
- Kullanıcı isteğe bağlı "Çengeli göster" (varsa) → `support = hook`; yoksa `support = none`.
- "Cevabı aç" → Atom.text, why, how gösterilir → öz değerlendirme: Hatırladım (good) / Zorlandım (hard) / Hatırlayamadım (again).
- `responseTimeMs` = kartın gösteriminden **"Cevabı aç"** dokunuşuna kadar (hatırlama anı). Cevabı okuma ve öz değerlendirme süresi v0'da saklanmaz; ileride ayrı alan olarak eklenir, `responseTimeMs`'in anlamı değişmez.

## 5. Yanlış / Again sonrası görünürlük

Ayrı gizli scheduler **yoktur**. Akış:
```
Again → applyAttempt → scheduler.next → MemoryState.due = now + (learning/relearning adımı)
     → due <= now olduğunda DailyQueue onu vadeli olarak döndürür
```
Pinli kütüphanenin adım süreleri `02` §3.1a'da belgelidir (Again ≈ 1 dk, Hard ≈ 6 dk, Good ≈ 10 dk, Relearning ≈ 10 dk). Uygulama bu süreleri bilmez ve hesaplamaz; yalnız `scheduler.next`'in yazdığı `due`'ya bakar.

## 6. Oturum (Session)

### 6.1 Tanım
Oturum yalnız **oturum durumu** tutar: `sessionId`, `startedAtMono` (monoton saat, `Clock.monotonicMs()`), `budgetMs` (null | 3/5/10 dk), `activeMs` (ön planda geçen süre), `answered` (gösterim sayacı). Kuyruk snapshot'ı **tutmaz**. Olay zamanı (`Attempt.timestamp`) duvar saatidir; oturum bütçesi **duvar saatine bağlı değildir** (U-DS-12).

### 6.2 İlerleme
```
nextItem():
  if budgetMs ≠ null and activeMs ≥ budgetMs: end("budget")     // activeMs: monoton saat; uygulama gizliyken durur
  item ← selectNext(atoms, memory, scheduler, now, config, todayAttempts(now))
  if item = null: end("empty")
  if item.reason = "new": show ReadScreen(item)       // okuma review değildir (A11)
  else: show resolve(item.atomId)
```
- `nextItem()` bir öğe tamamlandıktan sonra çağrılır; her çağrı güncel MemoryState ve `now` ile değerlendirir. Void sonrası `nextItem()` değil, §6.5'teki tek seferlik tekrar sunumu çalışır. Böylece 1 dakika önce Again yiyen atom, vadesi geldiği anda uygun olur; eski bir listenin bitmesini beklemez.
- Bütçe kontrolü öğe **başlangıcında** yapılır: süre dolduğunda aktif öğe tamamlanır, yenisi başlamaz.
- Oturum içinde yeni atomlar da gelebilir (uygun vadeli kalmadıysa ve `newPerDay` dolmadıysa); günlük tavan Attempt geçmişinden korunur (§3.4 kural 4).
- `answered`: kaydedilen Attempt sayısı; void edilince düşmez, gösterim amaçlıdır.

### 6.5 Geri al = tek seferlik düzeltme tekrarı (correction replay)
Undo bir scheduler kararı değildir. Akış:
```
0. cevap kaydında UI'ya bir undoToken verilir: { targetAttemptId, action, expiresAt: now+30 s }
1. geri al isteği yalnız bu token'la yapılır: undo(targetAttemptId) → hedef zaten void ise veya token süresi geçmişse → null, hiçbir şey olmaz
   ("oturumun son void edilmemiş Attempt'ı" gibi kayan hedef YOKTUR; önceki kayda düşülmez — U-UN-08)
1b. hedef için AttemptVoid yaz
2. REBUILD
3. void edilen Attempt'ı üreten EXACT LearningAction'ı bir kez yeniden sun:
     question → aynı questionId ve void edilen Attempt'ın questionVersion'ı (hemen düzeltme bağlamı; eski revision fiziksel olarak vardır)
     recall   → aynı atomId, hatırlama kartı
   bu tekrar sunumu selectNext'i atlar ve hiçbir due değeri yazmaz/değiştirmez
4. kullanıcı yeniden cevaplayınca normal Attempt oluşur; sonra normal selectNext devam eder
5. kullanıcı tekrar sunumundan çıkarsa (Bugün'e dön / uygulama kapanır) özel tekrar zorunluluğu kalmaz; sonraki açılışta normal kuyruk çalışır
```
Tekrar sunumu geçici oturum durumudur (`pendingReplay`), persist edilmesi zorunlu değildir. Başka bir vadeli atomun R'si daha düşük olsa bile düzeltme tekrarı önce gelir (bir kez). Geri al doğru **ve** yanlış cevaplar için aynı biçimde vardır: yanlış cevapta neden çipi → Attempt → sonuç ekranı (S5) `Geri al` düğmesi; token o Attempt'a bağlıdır.

**Ölçüm dürüstlüğü:** geri al, yanlış dokunuşu düzeltmek içindir; cevabı gördükten sonra "temiz hatırlama" üretmek için değil. Bu yüzden: (a) geri al yalnız cevap kaydından sonraki **30 saniye** içinde ve her LearningAction için **bir kez** mümkündür; (b) tekrar sunumdan doğan Attempt `replayOfAttemptId` (void edilen Attempt'ın id'si) taşır — ham, değiştirilemez bağ; (c) EvidencePolicy v1 bu Attempt'ı normal kanıt sayar (yanlış dokunuş düzeltmesi amaçlanan kullanım), analiz katmanı `replayOfAttemptId` ile geri alma oranını ve "cevap sonrası Good" örüntüsünü görebilir; policy v2'de bu Attempt'lar farklı ele alınabilir, ham veri bunu mümkün kılar. Testler: U-UN-01…07.

### 6.3 Mikro mod (3 / 5 / 10 dk)
- Ayrı kuyruk **yoktur**. Aynı `selectNext`, `budgetMs` ile.
- "İlk N öğe" değil, zaman bütçesi: soru 12 sn de sürebilir, 90 sn de.
- Bütçe `Clock.monotonicMs()` ile ölçülür; cihaz saatinin ileri/geri alınması bütçeyi değiştirmez. Uygulama arka plana/gizliye geçince sayaç durur, öne gelince devam eder; uyku sırasında geçen süre bütçeye **sayılmaz** (`06` §11 Clock).
- Bitiş ekranı: "Süre doldu" + oturumda cevaplanan sayı.

### 6.4 Oturum bitişi
- `empty`: "Bugünlük bu kadar." + bugün toplam. 15 dakika içinde vadeye düşecek atom varsa sayısı gösterilir (öğrenme adımı bilgisi); kullanıcı isterse bekleyip yeniden başlatır, uygulama beklemez ve bildirim atmaz.
- `budget`: "Süre doldu."

## 7. Bugün ekranı sayıları
- **tekrar** = `due <= now` olan aktif atom sayısı (tavan uygulanmadan).
- **yeni** = `min(başlanmamış çalışılabilir atom sayısı, max(0, newPerDay − |startedToday|))`.
- **bugün yapılan** = yerel günde void edilmemiş Attempt sayısı.
- "Başla · N öğe": N = `buildQueue(...)` uzunluğu (tahmin; oturum sırasında değişebilir).
Seri (streak), "bilgi borcu" birikim uyarısı yoktur.

## 8. Determinizm ve uç durumlar

| Durum | Davranış |
|---|---|
| İki atom aynı R | `due` ASC, sonra `atomId` ASC |
| Atom `due` tam `now`'a eşit | vadeli |
| `reviewCap` = 0 | eski backlog'dan ilk kez alınacak atom yok; bugünkü continuation (started/rvd/Learning-Relearning) devam eder; yeni atomlar gösterilir; vadeler değişmez |
| Hiç atom yok | boş kuyruk; Bugün ekranı "atom yok" |
| Tüm atomlar vadesiz ve yeni tavanı dolmuş | boş kuyruk; "vadesi gelen yok" |
| Gece yarısı oturum ortasında | sonraki `selectNext` yeni güne göre sayar; tavanlar sıfırlanmış gibi davranır; öğrenme adımındaki atom `state` muafiyetiyle gelir; vadeler değişmez |
| Tavan gün içinde kullanımın altına indirildi | kalan kota 0; negatif değer yok; liste boş kalır |
| Arşivli soru | Resolver adayı değil; geçmişi korunur |
| Soru v1 açıkken v2 oluştu | cevap v1'e yazılır (sürüm sunumda sabit) |
| `prompt` boş atom | kuyruğa girmez; İçerik'te "soru yüzü eksik" |
| Cihaz saati geri alındı | kuyruk `now`'a göre hesaplanır; hafıza hesabı `02` §5.3 kırpması ile korunur |
| Atom arşivlendi, MemoryState var | kuyruğa girmez; MemoryState korunur (silinmez) |
| Sorunun primaryAtom'u başka atoma taşındı | Resolver yeni bağa göre sunar; eski atomun sorusu kalmadıysa kart gelir |
| Void sonrası aynı öğe | §6.5: exact LearningAction bir kez tekrar sunulur; `selectNext` atlanır; due değişmez |
| Bugün new başlamış atom, reviewCap dolu, Again → 1 dk | vadesi gelince gelir; `started` içinde olduğundan tavana tabi değil; `quota` artmaz |
| Oturum içinde aynı atom 1 dk sonra vadeye düşer | bir sonraki `nextItem()` çağrısında, R en düşükse hemen gelir; beklemez |
| `reviewCap` dolduktan sonra öğrenme adımı | bugün zaten başlamış atom (`rvd` içinde) tavandan bağımsız gelir |
| Tavan dolu, yeni vadeli atom | gelmez; `due` değişmez; ertesi gün öne gelir |
| Aynı anda iki atom `due <= now` | R düşük olan; eşitse atomId ASC |

## 9. Bu dosyaya özel kabul kriterleri
- `selectNext` ve `buildQueue` saf fonksiyondur; aynı girdiyle aynı sonucu döndürür; `selectNext = buildQueue[0]` tanım gereği (U-DQ-11, U-DQ-13).
- Çağrı öncesi/sonrası tüm `MemoryState.due` değerleri aynıdır (T14).
- Again sonrası vade ilerletilmiş saatle `selectNext` o atomu döndürür; ilerletilmemiş saatle döndürmez (U-DS-01, U-DS-02).
- Dinamik seçim günlük tavanları delmez; continuation tavanla kesilmez (U-DS-03, U-DS-04, U-DS-09…11).
- Resolver yakınlığı `sequence` ile ölçer (U-RS-06).
- Geri al exact LearningAction'ı bir kez tekrar sunar ve due yazmaz (U-UN-01…05).
- Mikro mod aynı `selectNext`'i kullanır; ayrı fonksiyon yoktur (kod incelemesi).
- Resolver soru ↔ kart dönüşümünü sağlar (T20).
- Sorusuz atom her zaman kart (T11).
