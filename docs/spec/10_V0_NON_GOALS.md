# 10_V0_NON_GOALS.md — v0'da Kesinlikle Yazılmayacaklar

Referans: `00_ANAYASA.md` A20, §4. Bu liste kapsam genişlemesini önlemek içindir. Listedekiler "kötü fikir" değildir; **v0'ın fikri değildir.**

## 1. Yazılmayacaklar

| Alan | Yazılmayacak | Neden / nerede ele alınır |
|---|---|---|
| Yapay zekâ | LLM çağrısı, prompt, API anahtarı, "bana öğret", soru üretimi, açıklama üretimi | M4 (`05` §3.4). Çekirdeği doğrulamaz. |
| Girdi | OCR, konuşma tanıma, fotoğraf işleme | M4 |
| Yakalama | Öğrenme Kutusu ekranı, `+ Yakala` | M2 (`05`). Alan tanımları hazır, ekran yok. |
| Re-Exposure | operation/support rotasyonu, Familiarity Trap, Bridge, Context Rotation, Rescue, Misconception Repair, Coverage hesabı | M3+ (`04`). v0: yalnız otomatik `operation`/`support` alanı + soru↔kart dönüşümü. |
| Kişiselleştirme | facet × yöntem × başarı çıkarımı, "sen şöyle öğreniyorsun" | `04` §8. Veri yok. |
| Analiz | haftalık rapor, zayıf halka, kalibrasyon skoru, yanlış inançlar ekranı, deneme röntgeni, X vs Y tablosu, süre/performans eğrisi | Sonrası. Attempt verisi bunları sonradan mümkün kılar. |
| Skorlar | Mastery Score, coverage skoru, ustalık vektörü, öncelik formülü, sınav günü projeksiyonu, ders ağırlığı / ihmal uyarısı | Sonrası. |
| Görselleştirme | grafik, çizelge, ilerleme çubuğu, ısı haritası, Atlas (mekânsal harita) | Sonrası. |
| Oyunlaştırma | streak, rozet, seviye, kutlama animasyonu | Hiçbir zaman (anayasa "seri yoktur"). |
| Bildirim | push bildirimi, zamanlanmış hatırlatma, kilit ekranı kartı | Sonrası; günde tavanlı tasarlanacak. v0'da yalnız ekran içi metin (`07` S1). |
| Sosyal | paylaşım, liderlik tablosu, çok kullanıcı | Hiçbir zaman planlanmadı. |
| Altyapı | **bulut yedek**, senkron, kimlik doğrulama, hesap, telemetri | Sonrası. **Ama** cihaz içi kurtarma noktaları + taşınabilir manuel JSON yedeği + güvenli geri yükleme + şema migration'ı v0'ın **veri güvenliği kapsamındadır**, non-goal değildir (A21, `06` §7–§10, `13`). Yedek (dosya, tam değiştirme) ile senkron (birleştirme, sunucu) karıştırılmaz. |
| Native paketleme | App Store build, Google Play build, Xcode projesi, Android Studio projesi, Capacitor entegrasyonu | Sonrası, zorunlu değil. **Ama** native taşınabilirlik mimari gereksinimdir ve v0 dışı değildir (A22): çekirdek platform API'sine bağlanmaz, depo ve platform servisleri arayüz arkasındadır, yedek formatı platformdan bağımsızdır. Native'e geçiş kabiliyeti bugünden korunur, paketleme sonra yapılır. |
| Ağırlıklar | FSRS weight optimizasyonu, optimizer | Veri yetince, config v2. |
| Test-out | "biliyorum → kanıtla" | Sonrası. |
| Hata nedeni | 7 seçenekli neden | v0: 3 + geç. |
| İkincil atom | secondary atom kanıt ağırlıkları, çok atomlu FSRS güncellemesi | A6 v0 kısıtı. |
| Yapı | React/Vue/Svelte, state yönetim kütüphanesi, DI konteyneri, plugin mimarisi, event bus, ORM üstü katman, "core/adapters/ports" katman şişkinliği | Vanilla TS + küçük modüller yeter. |
| Görsel cila | pixel-perfect Apple kopyası, Material kopyası, onlarca tema, zorunlu özel yazı tipi paketi, karmaşık rich text editör, süs amaçlı ağır animasyon, splash, onboarding turu | **Ama** yüksek kaliteli modern mobil görünüm, semantik tipografi ve semantik renk sistemi, light/dark hazır token'lar ve erişilebilirlik v0 **kalitesinin parçasıdır** (`14`). Süs değil, okunabilirlik. |

## 2. Erken soyutlama yasağı

"İleride lazım olabilir" gerekçesiyle:
- generic repository/unit-of-work katmanı,
- strateji deseniyle çoklu scheduler desteği,
- çoklu policy motoru,
- plugin/hook sistemi,
- soyut "LearningEngine" arayüzü ve tek gerçekleştirimi,
- konfigürasyonla açılıp kapanan özellik bayrakları

yazılmaz. Bugün tek gerçekleştirim varsa arayüz de yoktur; ikinci gerçekleştirim gerektiğinde arayüz o gün çıkarılır. **İstisna — anayasa/spec'in açıkça zorunlu kıldığı mimari sınırlar erken soyutlama sayılmaz:** Repository sınırı (A22, `06` §2), scheduler adaptörü (`02` §3), v0'da gerçekten kullanılan PlatformServices (Clock, IdGenerator, HashService, BackupFileService). Bunların dışındaki geleceğe dönük arayüzler yine yasaktır.

## 3. Nasıl karar verilir

Bir şey "gerekli" görünüyorsa üç soru:
1. `00_ANAYASA.md` §1 başarı testi bunsuz "hayır" mı oluyor? Hayırsa gerekli değil.
2. `01`–`08` içinde tanımlı mı? Değilse spec'te yok demektir; uydurulmaz (`11` kural 3).
3. Yine de kaçınılmaz görünüyorsa `BLOCKERS.md`'ye yaz, etkilenmeyen modüllerde devam et.

## 4. v0'da olan ama "az" görünenler (bilinçli)
Tek Re-Exposure kuralı (soru ↔ kart). Üç hata nedeni. Tek sayfa Veri ekranı (yedek/kurtarma dâhil). Örnek veri düğmesi. Dört PlatformServices (Clock, IdGenerator, HashService, BackupFileService); diğerleri arayüz olarak bile yok. Bunlar eksik değil, ölçülü.

## 5. Masada, v0 dışı (dış inceleme önerileri; spec'e girmedi)
"Bu kart sorunlu" işareti (M1.5 adayı, revision sistemine bağlanır) · atom yazarken cevabı seçip soru yüzü önizlemesi (M2) · "Bunu neden getirdin?" tek satırlık seçim açıklaması (seçim `reason` verisi zaten var; M1 sonrası) · "bir kelime değişti, cevap değişir mi?" (Re-Exposure `contrast/detect` uygulaması, M3+).

## 6. Mevcut kod
Elde çalışan bir gerçekleştirim vardır. "Temiz yeniden yazma" bir non-goal'dur: `src/` silinmez, çalışan modül mimari tercih farkı yüzünden yeniden yazılmaz (`09` Phase -1, `11`).
