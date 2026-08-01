import { priceItems } from "./pricing";

export function createOrder(items) {
  return priceItems(items);
}
