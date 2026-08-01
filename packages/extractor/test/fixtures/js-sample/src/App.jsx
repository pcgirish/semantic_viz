import { createOrder } from "./orders";

export function App() {
  const total = createOrder([{ unitPrice: 10, qty: 2 }]);
  return <div>{total}</div>;
}
