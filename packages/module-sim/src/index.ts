import "./load-env";
import { buildApp } from "./app";
import { loadConfig } from "./config";

// module-sim emulates modules for local/dev use only — it must never run
// alongside real modules in production. Guard first, before any config
// validation or network setup.
if (process.env.NODE_ENV === "production") {
  console.error("module-sim is a dev tool and refuses to run with NODE_ENV=production");
  process.exit(1);
}

const config = loadConfig();
const app = buildApp(config);

app.listen({ port: config.port }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
