import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";

export function hashFile(file: string): string {
  const contents = fs.readFileSync(path.resolve(file), "utf-8");
  return crypto.createHash("sha256").update(contents).digest("hex");
}

export function validate(): typeof z {
  return z;
}
