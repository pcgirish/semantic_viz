import { priceItems } from "./pricing";

export function createOrder(items: { unitPrice: number; qty: number }[]): number {
  return priceItems(items);
}
