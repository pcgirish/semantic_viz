export function priceItems(items) {
  return items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0);
}
