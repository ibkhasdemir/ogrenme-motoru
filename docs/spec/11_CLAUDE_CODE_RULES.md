# 11_CLAUDE_CODE_RULES.md — Claude Code Çalışma Kuralları

1. **Önce oku.** `docs/spec/00`–`14` dosyalarının tamamını, kod yazmadan önce, sırayla oku. Anlamadığın yeri tahmin etme; spec'te cevabı ara, yoksa kural 5.
2. **`00_ANAYASA.md` en yüksek otoritedir.** Spec dosyaları arasında çelişki görürsen anayasa kazanır; sonra numarası küçük dosya kazanır. Çelişkiyi `BLOCKERS.md`'ye not et.
3. **Yeni domain kavramı uydurma.** `01_DOMAIN_MODEL.md` §0 sözlüğünde olmayan varlık, enum, "route", "score", "level", "streak" vb. tanımlama. İhtiyaç görürsen kural 5.
4. **Anayasayı kendin değiştirme.** `docs/spec/` altındaki hiçbir dosyayı düzenleme; yalnız `BLOCKERS.md`, `BASELINE_AUDIT.md`, `docs/PHONE_CHECK.md` ve `README.md` senin yazdığın dokümanlardır.
5. **Blocker protokolü.** Somut çelişki, uygulanamazlık veya kütüphane uyuşmazlığı görürsen proje kökünde `BLOCKERS.md` oluştur/ekle: tarih, ilgili spec bölümü, ne gördüğün, önerdiğin en küçük çözüm, karar bekliyor mu. Kullanıcı karar verir.
6. **Blocker bütün işi durdurmaz.** Etkilenmeyen modüllerde ve fazlarda devam et. Etkilenen yeri geçici olarak en basit, spec'e en yakın davranışla kodla ve blocker'da işaretle.
7. **Minimum çözüm.** Aynı testi geçiren iki çözümden daha az kod ve daha az kavram içereni seç.
8. **Her faz sonunda testleri çalıştır** (`npm test`) ve sonucu faz notuna yaz.
9. **Kırmızı test bırakıp sonraki faza geçme.** Test yanlışsa testi spec'e göre düzelt; spec yanlış görünüyorsa kural 5.
10. **Derived state'i raw truth gibi saklama.** MemoryState/ReviewEvent silinip yeniden üretilebilir olmalı (`06` §4). Import'ta derived okunmaz.
11. **Attempt geçmişini mutate etme.** Depo katmanında Attempt/AttemptVoid için update/delete API'si yazma. Düzeltme = AttemptVoid.
12. **İkinci bir gizli scheduling sistemi yazma.** "Aynı güne ekle", "yarına at", "N dakika sonra göster" gibi mantık yasak; yalnız FSRS `due` (`03` §5).
13. **Queue FSRS `due` değerlerini değiştiremez.** `due =` ataması yalnız scheduler adaptöründe (`02` §3.2).
14. **AI/LLM ekleme.** Ne çağrı, ne anahtar, ne "ileride" için iskelet (`10`).
15. **Erken soyutlama yapma** (`10` §2). Tek gerçekleştirim = arayüz yok; **istisna:** spec'in zorunlu kıldığı sınırlar (Repository, scheduler adaptörü, v0'da kullanılan dört PlatformServices) erken soyutlama değildir, yazılır.
16. **Mobil kullanım v0'ın ana hedefidir.** Her ekranı dar ekranda (≈380 px) düşün; masaüstü düzeni ikincil.
17. **Offline-first davranışı bozma.** Uygulama ağ olmadan tam çalışır; hiçbir çekirdek yol ağ isteği yapmaz. Service worker stratejisi sabittir (`13` §7): build başına tam ön-önbellek, kabuk ve varlıklar aynı build önbelleğinden, arka planda güncelleme, çalışan oturum sessizce değişmez, service worker kullanıcı verisine hiçbir koşulda dokunmaz.
18. **Her önemli domain kararını spec'e referansla uygula.** Kodda yorum: `// 02 §1.2: doğru+guess = Again (A7)` gibi.
19. **Magic behaviour bırakma.** Sabitler (tavanlar, adımlar, hedef hatırlama) `QueueConfig`/`SchedulerConfig`/`EvidencePolicy` üzerinden; koda gömülü sihirli sayı yok.
20. **Çalışan basit çözüm, gelecekteki hayali mükemmel çözümden üstündür.** Faz 12'de telefonda "evet" alan v0, kusursuz mimariden değerlidir.

Ek: Türkçe arayüz metni, İngilizce kod tanımlayıcıları; `docs/spec` isimleri (Atom, Attempt, MemoryState…) kodda aynen kullanılır.

## Mevcut kodu koruma (Existing code preservation)
21. Mevcut gerçekleştirim varsa sıfırdan yazma. Whole-project rewrite yasak.
22. `rm -rf src`, toplu dosya değiştirme, "clean rewrite" yaklaşımı yasak.
23. Önce baseline test/build (`09` Phase -1), sonra artımlı düzeltme. Önce testle hatayı kanıtla, sonra minimum değişiklik.
24. Çalışan davranışı yalnız spec veya test gerektiriyorsa değiştir; farklı mimari tercih bir gerekçe değildir.

## Veritabanı güvenliği (Database safety)
25. Şema değişikliğinde veritabanı wipe yasak. Migration yaz (`06` §6). Migration başarısızsa eski DB korunur. Migration sahte geçmiş üretmez: kurulamayan eski içerik uydurulmaz, `content_unavailable_legacy` ile işaretlenir (A9).
26. "Sorunu çözmek için IndexedDB'yi sil" kabul edilen bir çözüm değildir; ne kodda ne kullanıcıya öneri olarak.
27. Kullanıcı verisi test fixture'ı değildir; testler kendi geçici veritabanlarını kullanır ve temizler.

## Git ve kod geri dönüşü (`13` §8)
28. Repo değilse: node_modules, dist ve gizli bilgiler hariç başlangıç durumunu koruyan **baseline commit** oluştur (Phase -1).
29. Repo ise: mevcut kullanıcı değişikliklerini `reset --hard`, `checkout --`, `clean -fd`, history rewrite ile silme. Dirty working tree varsa önce durumu raporla; kullanıcı verisini/kodunu kaybettirecek işlem yapma.
30. Her büyük faz yeşil olduğunda geri dönülebilir bir checkpoint (commit) bırak. Testler bozulduğunda son çalışan checkpoint'e **bak**; kullanıcı değişikliklerini force-revert etme.

## Önce yedek (Backup first)
31. Yıkıcı geri yükleme / içe aktarma / sıfırlama yolu, kurtarma noktası mekanizması tamamlanıp testleri geçmeden aktif veri üzerinde açılmaz (`09` Phase 10 sıra kuralı).

## Test hilesi yasağı (No test cheating)
32. Spec'e uymayan gerçekleştirimi korumak için testi gevşetme. Testi geçirmek için ham veri silme/sıfırlama yapma. Spec'in yanlış olduğunu düşünüyorsan kural 5.

## Platform bağımsızlığı (A22)
33. Öğrenme motorunu tarayıcıya kilitleme. Domain/engine içinde DOM veya native platform API kullanma.
34. Platform API'lerini adapter sınırı arkasında tut (`06` §2, §11); PWA'ya özel kodu core'a sızdırma.
35. Yalnız native geleceği için gereksiz framework/soyutlama üretme; arayüze yalnız kullanılan işlemler girer. Zorunlu sınırlar (kural 15 istisnası) bu kurala aykırı değildir.
36. Native dönüşüm gerektiğinde mevcut core yeniden yazılmamalı; bu, mimari kararların ölçütüdür.

## Görsel sistem (`14`)
37. UI'yı geliştirici demosu gibi bırakma; `14`'teki token ve bileşen sistemine taşı.
38. Inline rastgele hex/renk kullanma; semantik tasarım token'ı kullan. Domain varlığı içine UI renk kodu yazma.
39. Kritik bilgi vurgusu sistematik olmalı (semantik roller); renk tek başına anlam taşımamalı.
40. Kullanıcı cevap vermeden önce doğru cevabı görsel kodla ele verme.
41. Telefon ergonomisini masaüstünden önce düşün; UI tasarımının engine/domain bağımsızlığını bozma; tasarım uğruna öğrenme döngüsünü yavaşlatma.
