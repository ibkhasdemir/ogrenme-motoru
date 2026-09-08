// UI etiketleri. Depolanan değer İngilizce enum kalır (01 HookType; yedek/şema değişmez); ekranda Türkçe karşılık ve kısa ipucu.
import type { HookType } from '../domain'

export const HOOK_TYPE_LABEL: Record<HookType, string> = {
  logic: 'Mantık',
  mnemonic: 'Kodlama',
  absurd: 'Absürt imge',
  analogy: 'Benzetme',
  story: 'Hikâye',
  visual: 'Görsel',
  warning: 'Uyarı',
  personal: 'Kişisel bağ',
}

export const HOOK_TYPE_HINT: Record<HookType, string> = {
  logic: 'neden böyle olduğunu açıklayan bağ',
  mnemonic: 'baş harf, kısaltma, tekerleme',
  absurd: 'saçma ama unutulmaz bir resim',
  analogy: 'bildiğin bir şeye benzetme',
  story: 'kısa bir olay örgüsü',
  visual: 'zihinde canlanan görüntü',
  warning: 'tuzak, sık yapılan hata',
  personal: 'kendi hayatından bir bağ',
}

/** Bilinmeyen değer (eski veri) olduğu gibi gösterilir; uydurulmaz. */
export function hookTypeLabel(t: HookType | string): string {
  return (HOOK_TYPE_LABEL as Record<string, string>)[t] ?? t
}
