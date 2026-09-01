import type { Config, Services } from "@llmeval/core";

export interface AppEnv {
  Variables: {
    services: Services;
    config: Config;
  };
}
