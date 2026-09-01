import { loadConfig, type Config } from "../config.js";
import type { Db } from "../db/client.js";
import { LangChainModelFactory, type ChatModelFactory } from "../llm/client.js";
import { ModelRegistry } from "../llm/models.js";
import { RunEngine, type RunEngineOptions } from "../runs/engine.js";
import { JobRunner } from "../runs/job-runner.js";
import { DatasetService } from "./datasets.js";
import { ImportService } from "./import.js";
import { ItemService } from "./items.js";
import { RunService } from "./runs.js";
import { VersionService } from "./versions.js";

export interface Services {
  config: Config;
  datasets: DatasetService;
  items: ItemService;
  versions: VersionService;
  imports: ImportService;
  runs: RunService;
  models: ModelRegistry;
  engine: RunEngine;
  jobs: JobRunner;
}

export interface CreateServicesOptions {
  config?: Config;
  /** Extra model definition files (defaults to ./models.json when it exists). */
  modelFiles?: string[];
  /** Override how chat models are built (tests inject fakes). */
  modelFactory?: ChatModelFactory;
  engine?: RunEngineOptions;
}

export function createServices(db: Db, opts: CreateServicesOptions = {}): Services {
  const config = opts.config ?? loadConfig();
  const models = ModelRegistry.fromFiles(config, opts.modelFiles);
  const jobs = new JobRunner();
  const modelFactory = opts.modelFactory ?? new LangChainModelFactory(config);
  const engine = new RunEngine(db, config, models, modelFactory, jobs, opts.engine);
  const items = new ItemService(db);
  const versions = new VersionService(db);
  return {
    config,
    datasets: new DatasetService(db),
    items,
    versions,
    imports: new ImportService(db, items),
    runs: new RunService(db, config, versions, models, engine),
    models,
    engine,
    jobs,
  };
}

export { DatasetService, ImportService, ItemService, ModelRegistry, RunService, VersionService };
