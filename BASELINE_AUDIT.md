# BASELINE_AUDIT.md — Phase -1 Baseline Audit

Tarih: 2026-09-08 · Spec: v1.6 FROZEN · Referans: `09_IMPLEMENTATION_PLAN.md` Phase -1, `12_CLAUDE_CODE_MASTER_PROMPT.md` madde 2–4.

## 1. Sonuç: uygulama yok → Yol B

Klasörde kaynak kod yoktur: `package.json`, `src/`, `tests/`, `public/` bulunmuyor. Tek içerik `docs/spec/` (15 Markdown dosyası; `ogrenme-motoru-spec-paketi-v1.6-FROZEN.zip`'ten açıldı, zip silindi). `00_ANAYASA.md` başlığı "v1.6, FROZEN" olarak doğrulandı.

`09` **Yol B** geçerlidir: sıfırdan gerçekleştirim. Phase 0 iskele olarak uygulanır; Phase 1–12 "yeni gerçekleştirim" olarak ilerler.

Olmayan kod değerlendirilmez. Bu yüzden aşağıdaki başlıklar bilinçli olarak boştur:
- Çalışanlar: yok (kod yok).
- Spec'e uyanlar: yok (kod yok).
- Bilinen hatalar: yok (kod yok; bkz. §5).

## 2. Ortam bulguları

| Konu | Bulgu |
|---|---|
| Git | Repo yoktu. `git init`; `.gitignore` (node_modules, dist, coverage, .env*, anahtar dosyaları, editör/OS artıkları); `.gitattributes` (`* text=auto eol=lf`). Baseline commit: `docs: spec v1.6`. |
| Node.js / npm | Başlangıçta kurulu değildi (yalnız Adobe'nin gömülü, npm'siz `node.exe`'si vardı; kullanılmadı). Kullanıcı onayıyla winget `OpenJS.NodeJS.LTS` kuruldu: **Node v24.19.0, npm 11.17.0**. `npm install` 83 paket; `npm test` 2/2 yeşil; `npm run build` (tsc --noEmit + vite build) yeşil. npm 11 allow-scripts politikası esbuild postinstall'ını çalıştırmadı; esbuild platform ikilisi isteğe bağlı bağımlılıkla geldiği için build etkilenmedi. |
| ts-fsrs pini | npm kayıt defteri: `latest = 5.4.2`, `beta = 6.0.0-beta.8`. Pin `"ts-fsrs": "5.4.2"` (`^`/`~` yok) `latest` ile uyumlu (`02` §4); `node_modules/ts-fsrs/package.json` = 5.4.2 (U-SC-01 kaynağı). Beta kullanılmaz. `02` §3.1a pinli sözleşme gerçekleri tek seferlik betikle doğrulandı, bkz. §2.1. |
| Araç zinciri (tam pin) | dexie 4.4.5 · typescript 5.9.3 · vite 7.3.6 · vitest 4.1.11 · fake-indexeddb 6.2.5 · jsdom 30.0.1. Gerekçe: TypeScript 7.x (yeni Go tabanlı derleyici), Vite 8.x ve Vitest 5.0.0 birkaç haftalıktır; olgun hatlar seçildi. Vitest 4.1.11 peer bağımlılığı `vite ^6 || ^7 || ^8` → uyumlu. |
| appVersion | `package.json` `0.2.0`: `06` §7 örneği, `07` S12 sürüm satırı ve `09` Phase 12 etiketi (`v0.2.0`) ile aynı numara. |

### 2.1 ts-fsrs 5.4.2 pinli sözleşme doğrulaması (`02` §3.1a; tek seferlik betik, repoya girmedi)

| İddia (`02` §3.1a) | Ölçülen (5.4.2, `learning_steps ["1m","10m"]`, `relearning_steps ["10m"]`, fuzz kapalı) | Sonuç |
|---|---|---|
| `generatorParameters().w` 21 eleman (FSRS-6) | 21 | ✓ |
| New + Again → Learning, adım 0, ≈ +1 dk | state 1, steps 0, +1 dk | ✓ |
| New + Hard → Learning, adım 0, ≈ +6 dk | state 1, steps 0, +6 dk | ✓ |
| New + Good → Learning, adım 1, ≈ +10 dk | state 1, steps 1, +10 dk | ✓ |
| Good→Good → Review, 2 gün | state 2, 2 gün | ✓ |
| Again→Good→Good → Review, tam 1 gün | state 2, 1 gün | ✓ |
| Hard→Good→Good → Review, tam 1 gün | state 2, 1 gün | ✓ |
| Review + Again → Relearning, lapses +1, ≈ +10 dk | state 3, lapses 1, +10 dk | ✓ |
| Learning + Again lapse saymaz | lapses 0 | ✓ |
| İlk 24 saatte R = 1 | R(+1 sa) = 1; R(+5 gün) = 0.839 | ✓ |
| Manual (0) grade hata fırlatır | "Cannot review a manual rating" | ✓ |
| Kart alanları: `learning_steps`, `last_review` var | due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, learning_steps, state, last_review | ✓ |

Pin ile spec arasında uyuşmazlık yok; U-SC-04/05/12/13a/b/c Phase 5'te bu değerlerle yazılacak.

## 3. Spec fazları ↔ mevcut modüller

| Faz | Spec modülleri | Mevcut modül | Durum |
|---|---|---|---|
| 1 | domain tipleri (`01`) | yok | yeni gerçekleştirim |
| 1b | kanonik JSON, HashService, RecoveryStore, snapshotAll, RestoreJournal çekirdeği (`06` §7, §9, §8.5) | yok | yeni |
| 2 | Repository (Memory + Dexie), schemaVersion 1→2 migration, RecoveryReader (`06` §2, §6) | yok | yeni |
| 3 | Attempt olay sistemi (`01` §4) | yok | yeni |
| 4 | EvidencePolicy (`02` §1) | yok | yeni |
| 5 | Scheduler adaptörü (`02` §3–4) | yok | yeni |
| 6 | REBUILD (`02` §5) | yok | yeni |
| 7 | DailyQueue + dinamik oturum + geri al tekrarı (`03` §3, §6) | yok | yeni |
| 8 | Resolver + hatırlama kartı + reviseQuestion (`03` §4, `01` §2.5–2.8) | yok | yeni |
| 8b | Motor cephesi, yedek/geri yükleme saf fonksiyonları, PlatformServices (`06` §8, §11) | yok | yeni |
| 9 | Minimal mobil arayüz (`07`) | yok | yeni |
| 9b | Görsel sistem temeli (`14`) | yok | yeni |
| 10 | Yedek ve kurtarma (`06` §7–§10, `13`) | yok | yeni |
| 11 | Çevrimdışı PWA + güncelleme güvenliği (`13` §7) | yok | yeni |
| 12 | Kabul ve kapanış | — | — |

## 4. Platform coupling audit

Kod olmadığı için bulgu yoktur. Kurallar ileriye dönük uygulanır (A22, `06` §2, §11, `11` kural 33–36):
- `src/domain/**` ve `src/engine/**` içinde `window`, `document`, `navigator`, `localStorage`, `indexedDB`, `location`, `fetch`, DOM tipleri, Dexie import'u bulunmaz; ts-fsrs yalnız scheduler adaptöründe.
- Bunlar A-01 (Phase 1), A-02 / A-06 (Phase 2) statik tarama testleriyle ilk fazlardan itibaren korunur; UI/app/store katmanında platform erişimi normaldir.

## 5. Belgelerdeki "bilinen kod hataları" (`09` Phase -1 madde 6)

Yol B'de bunlar **yalnız tasarım uyarısıdır**; hiçbiri mevcut kodda doğrulanmış hata değildir ve öyle raporlanmaz. İlgili faza uyarı olarak eşlenir:

| Uyarı | Kaynak | İlgili faz |
|---|---|---|
| Oturum kuyruk snapshot'ı tutulmaz; her öğede `selectNext` | `03` §3, §6 | 7 |
| `buildQueue` / `selectNext` aynı yardımcılar, aynı sıra | `03` §3.5 | 7 |
| `Atom.prompt` zorunlu; boş prompt kuyruğa girmez | `01` §2.3 | 1, 7, 9 |
| Arşivli soru Resolver adayı değil | `03` §4.2 | 8 |
| Soru sürümü sunum anında sabitlenir, kayıt anında değil | `01` §4.2a | 3, 8 |
| QuestionRevision tablosu; Question baş kaydında metin yok | `01` §2.5 | 1, 2 |
| Yedek formatı 2 + checksum | `06` §7 | 1b, 10 |
| Kurtarma noktaları | `06` §9 | 1b, 10 |
| SW önbellek adı build sürümü içerir | `13` §7 | 11 |
| Yedek dosya adında saat + backupId8 | `06` §7 | 10 |
| Geri al sonrası aynı öğe exact tekrar sunulur, `selectNext`'e bırakılmaz | `03` §6.5 | 7 |
| Resolver yakınlığı `sequence` ile | `03` §4.3 | 8 |
| U-SC-04: New+Good → +10 dk, adım 1 (pinli davranış) | `02` §3.1a | 5 |

## 6. Önerilen sıra

`09`'daki sıra aynen: -1 → 0 → 1 → 1b → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 8b → 9 → 9b → 10a → 10b → 10c → 11 → 12. Faz atlama ve birleştirme yok. Her fazın test kimlikleri faz planında listelenir (Phase 1 öncesi kullanıcı onayı).

## 7. Yol B'ye özgü varsayımlar

- **Legacy şema (schemaVersion 1):** gerçek eski veritabanı yoktur. `06` §6.2'nin tarif ettiği şekil (questions tablosunda `version`, `text`, `options`, `correctOptionId`, `primaryAtomId`, `createdAt`; attempts'ta `questionVersion`) Dexie `version(1)` tanımı olarak yazılır; migration 1→2 yine gerçekleştirilir çünkü I-17, U-QR-07…12, B-16, B-26 bunu ister. Testler v1 veritabanını kendileri kurar (`11` kural 27).
- **Test–faz bağımlılıkları:** Yol A'da mevcut olan modüller Yol B'de yoktur; `09`'un bazı test atamaları ileri faz modülü ister. Bunlar `BLOCKERS.md`'de listelenir ve faz planı onayında karara bağlanır (`09` "Test–faz bağımlılık kontrolü").
