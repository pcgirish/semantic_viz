"""Also billing: a one-off backfill that shares the module's vocabulary and imports.
Filed under scripts/ alongside a completely unrelated ops script."""
from app.billing.invoice import build_invoice
from app.shared.money import Money


def backfill(order_ids: list[str]) -> list[dict]:
    return [build_invoice(oid, Money(0)) for oid in order_ids]
