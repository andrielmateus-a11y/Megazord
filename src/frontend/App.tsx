import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ToastProvider } from './hooks/useToast';
import { CampaignsPage } from './pages/Campaigns';
import { ChannelsPage } from './pages/Channels';
import { DashboardPage } from './pages/Dashboard';
import { DataPage } from './pages/Data';
import { DiscoverPage } from './pages/Discover';
import { HistoryPage } from './pages/History';
import { InboxPage } from './pages/Inbox';
import { LoginPage } from './pages/Login';
import { QueuePage } from './pages/Queue';
import { SettingsPage } from './pages/Settings';
import { TemplatesPage } from './pages/Templates';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (!user) return <Navigate to="/entrar" replace />;
  return <Layout />;
}

function PublicOnly() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : <LoginPage />;
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/entrar" element={<PublicOnly />} />
            <Route element={<Protected />}>
              <Route index element={<DashboardPage />} />
              <Route path="prospeccao/descobrir" element={<DiscoverPage />} />
              <Route path="prospeccao/historico" element={<HistoryPage />} />
              <Route path="inbox" element={<InboxPage />} />
              <Route path="whatsapp/canais" element={<ChannelsPage />} />
              <Route path="whatsapp/mensagens" element={<TemplatesPage />} />
              <Route path="automacao/fila" element={<QueuePage />} />
              <Route path="automacao/campanhas" element={<CampaignsPage />} />
              <Route path="dados" element={<DataPage />} />
              <Route path="configuracoes" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
