import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Delta, Snapshot, Unit } from "@scv/schema";

export interface RevSummary {
  sha: string;
  kind: Snapshot["rev"]["kind"];
  pr?: number;
  ts: string;
  author: string;
  author_kind: string;
  amount: number;
}

export interface UnitWithNeighbours {
  unit: Unit;
  neighbours: Unit[];
}

/** Reads scv/1 snapshots from `<scvDir>/snapshots/*.json` and serves them in memory. */
export class SnapshotStore {
  private readonly snapshotsDir: string;
  private readonly deltasDir: string;

  constructor(scvDir: string) {
    this.snapshotsDir = path.join(scvDir, "snapshots");
    this.deltasDir = path.join(scvDir, "deltas");
  }

  private readAll(): Snapshot[] {
    let files: string[];
    try {
      files = readdirSync(this.snapshotsDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(path.join(this.snapshotsDir, f), "utf-8")) as Snapshot);
  }

  listRevs(): RevSummary[] {
    const snapshots = this.readAll().sort((a, b) => b.rev.ts.localeCompare(a.rev.ts));
    return snapshots.map((s, i) => {
      const previous = snapshots[i + 1];
      const delta = previous ? this.getDelta(previous.rev.sha, s.rev.sha) : undefined;
      const amount = delta && delta.unit_deltas.length > 0
        ? delta.unit_deltas.reduce((sum, d) => sum + d.amount, 0) / delta.unit_deltas.length
        : 0;
      return {
        sha: s.rev.sha,
        kind: s.rev.kind,
        ...(s.rev.pr !== undefined ? { pr: s.rev.pr } : {}),
        ts: s.rev.ts,
        author: s.rev.author,
        author_kind: s.rev.author_kind,
        amount,
      };
    });
  }

  getSnapshot(sha: string): Snapshot | undefined {
    return this.readAll().find((s) => s.rev.sha === sha);
  }

  getLatestSnapshot(): Snapshot | undefined {
    const [latest] = this.listRevs();
    return latest ? this.getSnapshot(latest.sha) : undefined;
  }

  getUnit(sha: string, unitId: string): UnitWithNeighbours | undefined {
    const snapshot = this.getSnapshot(sha);
    if (!snapshot) return undefined;
    const unit = snapshot.units.find((u) => u.id === unitId);
    if (!unit) return undefined;
    const neighbourIds = new Set(
      snapshot.edges.filter((e) => e.from === unitId || e.to === unitId).map((e) => (e.from === unitId ? e.to : e.from)),
    );
    const neighbours = snapshot.units.filter((u) => neighbourIds.has(u.id));
    return { unit, neighbours };
  }

  search(sha: string, query: string): Unit[] {
    const snapshot = this.getSnapshot(sha);
    if (!snapshot) return [];
    const needle = query.toLowerCase();
    return snapshot.units.filter((u) => u.qualname.toLowerCase().includes(needle));
  }

  getDelta(from: string, to: string): Delta | undefined {
    try {
      const raw = readFileSync(path.join(this.deltasDir, `${from}__${to}.json`), "utf-8");
      return JSON.parse(raw) as Delta;
    } catch {
      return undefined;
    }
  }
}
