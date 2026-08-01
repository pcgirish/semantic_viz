import path from "node:path";
import { buildApp } from "./app.js";

const root = process.argv[2] ?? process.cwd();
const scvDir = path.join(path.resolve(root), ".scv");
const port = Number(process.env.PORT ?? 3000);

const app = buildApp({ scvDir });

app
  .listen({ port, host: "127.0.0.1" })
  .then(() => {
    app.log.info(`serving ${scvDir} on http://127.0.0.1:${port}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
