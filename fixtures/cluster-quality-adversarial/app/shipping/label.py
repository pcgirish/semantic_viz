"""Shipping label generation."""
from app.shared.money import Money
from app.shipping.carrier import rate_for


def make_label(destination: str) -> dict:
    return {"to": destination, "cost": rate_for(destination).as_cents()}
