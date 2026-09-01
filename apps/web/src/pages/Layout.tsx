import { NavLink, Outlet } from "react-router";

const link = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-200"}`;

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <NavLink to="/" className="text-lg font-bold tracking-tight">
            llmEval
          </NavLink>
          <nav className="flex gap-1">
            <NavLink to="/" end className={link}>
              Datasets
            </NavLink>
            <NavLink to="/runs" className={link}>
              Runs
            </NavLink>
            <NavLink to="/compare" className={link}>
              Compare
            </NavLink>
            <NavLink to="/settings" className={link}>
              Settings
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
