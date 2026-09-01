import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router";
import "./index.css";
import { DatasetPage } from "./pages/DatasetPage.js";
import { DatasetsPage } from "./pages/DatasetsPage.js";
import { Layout } from "./pages/Layout.js";
import { RunPage } from "./pages/RunPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ItemsTab } from "./pages/dataset/ItemsTab.js";
import { RunsTab } from "./pages/dataset/RunsTab.js";
import { VersionsTab } from "./pages/dataset/VersionsTab.js";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <DatasetsPage /> },
      {
        path: "datasets/:id",
        element: <DatasetPage />,
        children: [
          { index: true, element: <ItemsTab /> },
          { path: "versions", element: <VersionsTab /> },
          { path: "runs", element: <RunsTab /> },
        ],
      },
      { path: "runs", element: <RunsPage /> },
      { path: "runs/:id", element: <RunPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
