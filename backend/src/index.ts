import "./config/load-env";
import { getEnv } from "./config/env";
import { buildServer } from "./server";

const env = getEnv();

buildServer()
  .then((app) =>
    app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err: unknown) => {
      app.log.error(err);
      process.exit(1);
    }),
  )
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
