import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*",
  "!packages/skins",
  "packages/skins/*",
  { test: { name: "scripts", include: ["scripts/test/**/*.test.mjs"] } },
]);
