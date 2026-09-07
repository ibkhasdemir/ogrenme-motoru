# 12_CLAUDE_CODE_MASTER_PROMPT.md — Claude Code'a verilecek başlangıç promptu (spec paketi v1.6 FROZEN — Claude Code'a hazır, 2026-09-08)

Aşağıdaki metin, `docs/spec/00`–`14` dosyaları proje klasörüne konduktan sonra Claude Code'a olduğu gibi yapıştırılır.

---

Bu klasörde bir kişisel öğrenme motorunun teknik spec paketi var: `docs/spec/00_ANAYASA.md` … `14_VISUAL_LEARNING_DESIGN.md` (15 dosya).

**Bu repository boş olmayabilir.** Mevcut çalışan bir gerçekleştirim varsa onu **baseline** kabul et (`09` Yol A): sıfırdan proje kurma, `src/` silme, çalışan kodu wholesale rewrite etme. Kaynak kod yoksa (`09` Yol B) bunu `BASELINE_AUDIT.md`'ye "uygulama yok" diye yaz ve Phase 0'ı iskele olarak uygula; olmayan kodu varmış gibi değerlendirme. Mimari tartışması açma; kararlar verilmiş ve dondurulmuştur.

İlk görev, sırayla:
1. `docs/spec/` altındaki 15 dosyanın tamamını oku. `11_CLAUDE_CODE_RULES.md`'deki kuralları bir cümleyle özetleyip onayla.
2. Mevcut repo/dosya ağacını tara. `package.json` varsa `npm install`, `npm test`, `npm run build` çalıştır; sonuçları olduğu gibi kaydet. Yoksa Yol B.
3. Git: repo değilse node_modules/dist/gizli bilgiler hariç **baseline commit** oluştur; repo ise `git status` raporla, hiçbir şeyi reset/checkout/clean ile silme.
4. `09_IMPLEMENTATION_PLAN.md` **Phase -1 Baseline Audit**'i yap: mevcut kodu spec fazlarıyla eşleştir, platform coupling audit'i yap, `BASELINE_AUDIT.md` yaz (çalışanlar, spec'e uyanlar, eksikler, bilinen hatalar, yama sırası).
5. Mevcut gerçekleştirim ile spec arasındaki farkları çıkar; sonra Phase 0'dan Phase 12'ye **minimum değişikliklerle** devam et. Faz atlama, faz birleştirme yok.
6. Her fazda önce `08_TEST_PLAN.md`'de o faza atanmış testleri yaz, sonra kodu değiştir, sonra `npm test`. Kırmızı test varken sonraki faza geçme; testi gevşetme; ham veri silerek geçirme.

Kırmızı çizgiler:
- Kapsam: `00_ANAYASA.md` §3 içi, `10_V0_NON_GOALS.md` dışı. "İleride lazım" diye hiçbir şey ekleme.
- **Veri wipe yasak.** Şema değişikliği = migration (`06` §6); migration başarısızsa eski DB korunur.
- **Yedek/kurtarma kırmızı çizgi:** yıkıcı geri yükleme yolu, kurtarma noktası mekanizması test edilmeden açılmaz; `yedek → sil → geri yükle → REBUILD` eşitliği (B-01) geçmeden Phase 10 bitmez.
- **Code checkpoint zorunlu:** her yeşil fazda commit; testler bozulursa son yeşil checkpoint'e bak, kullanıcı değişikliklerini force-revert etme.
- **Test başarısızlığında sıfırdan yeniden yazma yok:** hatayı testle kanıtla, minimum yama yap.
- Çekirdek platform bağımsız (A22): domain/engine içinde DOM, Dexie, navigator, Capacitor yok; depo ve platform servisleri arayüz arkasında.
- UI: semantik token'lar, cevap öncesi görsel sızıntı yok, telefon ergonomisi (`07` §7, `14`).
- Spec'te çelişki veya uygulanamazlık görürsen `BLOCKERS.md`'ye yaz (tarih, bölüm, gözlem, en küçük öneri) ve etkilenmeyen işe devam et. Spec dosyalarını düzenleme.
- Phase 11'de telefon kontrol listesini `docs/PHONE_CHECK.md`'ye yaz.

Bitince: `npm test` çıktısı, `BASELINE_AUDIT.md`, `BLOCKERS.md` durumu, `README.md` (kurulum, telefonda açma, yedek/geri yükleme) ve `00_ANAYASA.md` §1 başarı testine kendi cevabın.

Sabitler: TypeScript + Vite + Vitest + Dexie + `ts-fsrs` **5.4.2** (tam pin), vanilla TS arayüz, çevrimdışı PWA. Çerçeve, LLM, backend, bulut yok.

Başla: Phase -1.
