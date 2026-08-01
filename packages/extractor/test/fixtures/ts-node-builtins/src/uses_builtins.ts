import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";
import elk from "elkjs/lib/elk-api";
import { plugin } from "@tailwindcss/vite";

export function hashFile(file: string): string {
  const contents = fs.readFileSync(path.resolve(file), "utf-8");
  return crypto.createHash("sha256").update(contents).digest("hex");
}

export function validate(): typeof z {
  return z;
}

export function layout(): typeof elk {
  return elk;
}

export function tailwind(): typeof plugin {
  return plugin;
}
