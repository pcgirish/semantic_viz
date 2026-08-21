"""Invoice assembly. Lives under app/billing, but the module it belongs to spans
three directories — the case a directory-shaped clustering cannot express."""
from app.shared.money import Money
from workers.billing_worker import enqueue_invoice


def build_invoice(order_id: str, amount: Money) -> dict:
    enqueue_invoice(order_id)
    return {"order": order_id, "total": amount.as_cents()}
