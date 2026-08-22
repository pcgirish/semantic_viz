"""Part of billing, filed under workers/ because that is where the runner looks."""
from app.shared.money import Money


def enqueue_invoice(order_id: str) -> None:
    _queue.append(order_id)


def settle(amount: Money) -> Money:
    return amount


_queue: list[str] = []
