import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { ModelRegistry } from "../llm/models.js";
import { DatasetService } from "./datasets.js";
import { ItemService } from "./items.js";
import { VersionService } from "./versions.js";

export interface Services {
  datasets: DatasetService;
  items: ItemService;
  versions: VersionService;
  models: ModelRegistry;
}

export interface CreateServicesOptions {
  config?: Config;
  /** Extra model definition files (defaults to ./models.json when it exists). */
  modelFiles?: string[];
}

export function createServices(db: Db, opts: CreateServicesOptions = {}): Services {
  const config = opts.config ?? loadConfig();
  return {
    datasets: new DatasetService(db),
    items: new ItemService(db),
    versions: new VersionService(db),
    models: ModelRegistry.fromFiles(config, opts.modelFiles),
  };
}

export { DatasetService, ItemService, ModelRegistry, VersionService };
