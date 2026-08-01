export function priceItems(items: { unitPrice: number; qty: number }[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
}
