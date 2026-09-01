import type { Db } from "../db/client.js";
import { DatasetService } from "./datasets.js";
import { ItemService } from "./items.js";

export interface Services {
  datasets: DatasetService;
  items: ItemService;
}

export function createServices(db: Db): Services {
  return {
    datasets: new DatasetService(db),
    items: new ItemService(db),
  };
}

export { DatasetService, ItemService };
