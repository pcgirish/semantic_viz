"""Ops, not billing. Shares scripts/ with billing_backfill.py and has nothing to do
with it — the case where one directory holds two unrelated modules."""
from app.shared.money import Money


def rotate(path: str) -> int:
    _ = Money
    return len(path)
