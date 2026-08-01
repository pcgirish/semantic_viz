import { zodToJsonSchema } from "zod-to-json-schema";
import { DeltaSchema, SnapshotSchema } from "./index.js";

export const snapshotJsonSchema = zodToJsonSchema(SnapshotSchema, "scv/1");
export const deltaJsonSchema = zodToJsonSchema(DeltaSchema, "scv-delta/1");
