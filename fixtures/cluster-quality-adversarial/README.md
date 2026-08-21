# cluster-quality-adversarial

A small repository built to be **hard** for a directory-shaped clustering, so that
"our clustering is better than bucketing by directory" is a measured claim rather than
an impression. Built before the algorithm it exists to judge (plan 4b), which is the
point: the expectations are fixed in advance, so a later algorithm cannot be tuned
until it happens to look right.

Every property below is asserted automatically in
`packages/interpreter/test/cluster-quality-adversarial.test.ts`, from `manifest.json`.
Nothing here is eyeballed.

## What makes it adversarial

| Trap | Where |
|---|---|
| A conceptual module spanning three directories | `billing` — `app/billing/invoice.py`, `workers/billing_worker.py`, `scripts/billing_backfill.py` |
| Two unrelated modules sharing one directory | `scripts/billing_backfill.py` (billing) beside `scripts/rotate_logs.py` (ops) |
| A high-fan-in utility every cluster imports | `app/shared/money.py` — reached from all four clusters, so a clustering driven by import count alone collapses the repo around it |
| A cycle | `app/shipping/label.py` ↔ `app/shipping/carrier.py`, so an algorithm assuming a DAG cannot pass by accident |
| Generated code | `app/generated/pb_orders.py`, which imports across every cluster and would smear the boundaries if it drove the partition |
| Test code | `tests/` — present for coverage, excluded from clustering |

## The numbers

Scored with `clusteringQuality` (`packages/interpreter/src/checker.ts`):

| Partition | modularity | clusters | largest share | singletons |
|---|---|---|---|---|
| Directory baseline | 0.30 | 7 | 0.20 | 4 |
| Intended | **0.70** | 4 | 0.43 | 2 |

The gap is the fixture's reason to exist. If a plain directory bucketing already matched
the intended answer, the fixture would prove nothing.

`manifest.json` is the single source of truth: the file list, the import edges with
weights, the intended partition, and each trap's coordinates. The tests read it rather
than restating it, so the fixture and its expectations cannot drift apart.
