/**
 * Значок свежести цены на услугу.
 *
 * Показ отключён до следующего обхода прайсов клиник. Врать про дату нельзя,
 * а показывать настоящую сейчас незачем: ярлык «данные за такое-то число»
 * рядом с каждой строкой отвлекает от самой цены и ничего не меняет в
 * решении. Цены на препараты живут отдельно, у них дата приходит от аптеки
 * и показывается в таблице «Цены по аптекам» как есть.
 *
 * Чтобы вернуть: поставить SHOW_SERVICE_FRESHNESS в true.
 */
const SHOW_SERVICE_FRESHNESS = false;

export function FreshnessBadge({
  parsedAt,
}: {
  parsedAt: string | null | undefined;
}) {
  if (!SHOW_SERVICE_FRESHNESS || !parsedAt) return null;
  return null;
}
