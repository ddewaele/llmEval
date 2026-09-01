import type {
  AvailableModel,
  Dataset,
  DatasetSummary,
  GenerateGroundTruths,
  GenerateItems,
  ImportRequest,
  ImportResult,
  Item,
  Job,
  ListItemsQuery,
  NewItem,
  Page,
  PublishResult,
  Run,
  RunComparison,
  RunItem,
  ScorerInfo,
  StartRun,
  DatasetVersion,
  VersionDiff,
  VersionItem,
  UpdateItem,
  CreateDataset,
  UpdateDataset,
} from "@llmeval/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? "HTTP",
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return data as T;
}

const qs = (params: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== "" && v !== null) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : "";
};

export const api = {
  datasets: {
    list: (includeArchived = false) =>
      request<DatasetSummary[]>("GET", `/datasets${qs({ includeArchived })}`),
    get: (id: string) => request<DatasetSummary>("GET", `/datasets/${id}`),
    create: (body: CreateDataset) => request<Dataset>("POST", "/datasets", body),
    update: (id: string, body: UpdateDataset) => request<Dataset>("PATCH", `/datasets/${id}`, body),
    archive: (id: string, archived: boolean) =>
      request<Dataset>("POST", `/datasets/${id}/archive`, { archived }),
    delete: (id: string, force = false) =>
      request<void>("DELETE", `/datasets/${id}${qs({ force })}`),
  },
  items: {
    list: (datasetId: string, query: Partial<ListItemsQuery>) =>
      request<Page<Item>>("GET", `/datasets/${datasetId}/items${qs(query)}`),
    add: (datasetId: string, items: NewItem[]) =>
      request<{ items: Item[] }>("POST", `/datasets/${datasetId}/items`, { items }),
    update: (id: string, body: UpdateItem) => request<Item>("PATCH", `/items/${id}`, body),
    delete: (ids: string[]) => request<{ deleted: number }>("POST", "/items/delete", { ids }),
    review: (ids: string[], approve: boolean) =>
      request<{ updated: number }>("POST", "/items/review", { ids, approve }),
    import: (datasetId: string, body: ImportRequest) =>
      request<ImportResult>("POST", `/datasets/${datasetId}/import`, body),
  },
  generation: {
    groundTruths: (datasetId: string, body: Omit<GenerateGroundTruths, "datasetId">) =>
      request<Job>("POST", `/datasets/${datasetId}/generate/ground-truths`, body),
    items: (datasetId: string, body: Omit<GenerateItems, "datasetId">) =>
      request<Job>("POST", `/datasets/${datasetId}/generate/items`, body),
  },
  versions: {
    list: (datasetId: string) =>
      request<DatasetVersion[]>("GET", `/datasets/${datasetId}/versions`),
    publish: (datasetId: string, body: { label?: string; notes?: string }) =>
      request<PublishResult>("POST", `/datasets/${datasetId}/versions`, body),
    items: (datasetId: string, n: number, cursor?: string) =>
      request<Page<VersionItem>>(
        "GET",
        `/datasets/${datasetId}/versions/${n}/items${qs({ cursor, limit: 100 })}`,
      ),
    diff: (datasetId: string, from: number | "draft", to: number | "draft") =>
      request<VersionDiff>("GET", `/datasets/${datasetId}/versions/diff${qs({ from, to })}`),
    exportUrl: (datasetId: string, n: number) => `/api/datasets/${datasetId}/versions/${n}/export`,
  },
  runs: {
    list: (params: { datasetId?: string; status?: string; cursor?: string; limit?: number }) =>
      request<Page<Run>>("GET", `/runs${qs(params)}`),
    get: (id: string) => request<Run>("GET", `/runs/${id}`),
    start: (body: Partial<StartRun> & { datasetId: string }) => request<Run>("POST", "/runs", body),
    items: (
      id: string,
      params: {
        status?: string;
        scorerKey?: string;
        maxScore?: number;
        cursor?: string;
        limit?: number;
      },
    ) => request<Page<RunItem>>("GET", `/runs/${id}/items${qs(params)}`),
    item: (runItemId: string) => request<RunItem>("GET", `/run-items/${runItemId}`),
    cancel: (id: string) => request<Run>("POST", `/runs/${id}/cancel`),
    resume: (id: string) => request<Run>("POST", `/runs/${id}/resume`),
    rescore: (
      id: string,
      scorer: { key: string; type: string; config: Record<string, unknown> },
      overwrite = false,
    ) => request<Job>("POST", `/runs/${id}/scores`, { scorer, overwrite }),
    compare: (a: string, b: string, onlyRegressions = false, scorerKey?: string) =>
      request<RunComparison>("GET", `/runs/compare${qs({ a, b, onlyRegressions, scorerKey })}`),
    eventsUrl: (id: string) => `/api/runs/${id}/events`,
  },
  jobs: {
    get: (id: string) => request<Job>("GET", `/jobs/${id}`),
    list: (datasetId?: string) => request<Job[]>("GET", `/jobs${qs({ datasetId })}`),
  },
  models: () => request<AvailableModel[]>("GET", "/models"),
  scorers: () => request<ScorerInfo[]>("GET", "/scorers"),
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
