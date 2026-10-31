/**
 * Application routes. AppLayout renders the sidebar + top bar and an <Outlet/>
 * where the active page appears.
 */
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { DashboardPage } from './pages/DashboardPage';
import { InventoryPage } from './pages/InventoryPage';
import { DriftPage } from './pages/DriftPage';
import { JobsPage } from './pages/JobsPage';
import { SyncPage } from './pages/SyncPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="sync" element={<SyncPage />} />
          <Route path="drift" element={<DriftPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
