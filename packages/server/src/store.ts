import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Delta, Snapshot, Unit } from "@scv/schema";

export interface RevSummary {
  sha: string;
  kind: Snapshot["rev"]["kind"];
  ts: string;
  author: string;
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
    return this.readAll()
      .map((s) => ({ sha: s.rev.sha, kind: s.rev.kind, ts: s.rev.ts, author: s.rev.author }))
      .sort((a, b) => b.ts.localeCompare(a.ts));
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
