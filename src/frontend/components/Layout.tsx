import {
  ChevronDown, Database, History, Inbox, LayoutDashboard, ListOrdered, LogOut, Megaphone, MessageSquareText,
  Radar, Settings, Smartphone, Wifi, WifiOff,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { realtime } from '../services/realtime';
import { ROLE_LABELS } from '../types';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

function Section({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="mb-4">
      <p className="mb-1 px-3 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">{title}</p>
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.to === '/'}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors',
              isActive ? 'bg-white/10 font-medium text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
            )
          }
        >
          <span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{i.icon}</span>
          <span className="flex-1">{i.label}</span>
          {!!i.badge && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-semibold text-white">{i.badge}</span>}
        </NavLink>
      ))}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const [online, setOnline] = useState(false);
  const [menu, setMenu] = useState(false);
  const { data } = useApi<{ unreadChats: number; queue: number }>('/dashboard', { refreshOn: ['chat.updated', 'queue.updated'] });
  useEffect(() => realtime.onStatus(setOnline), []);

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col bg-ink">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-black text-white">M</div>
          <div>
            <p className="text-sm font-bold tracking-[0.18em] text-white">MEGAZORD</p>
            <p className="text-[10px] text-slate-500">Prospecção · Dados · Multi-WhatsApp</p>
          </div>
        </div>
        <nav className="scroll-thin flex-1 overflow-y-auto px-3">
          <Section title="Geral" items={[{ to: '/', label: 'Dashboard', icon: <LayoutDashboard /> }]} />
          <Section
            title="Prospecção"
            items={[
              { to: '/prospeccao/descobrir', label: 'Descobrir empresas', icon: <Radar /> },
              { to: '/prospeccao/historico', label: 'Histórico e contatos', icon: <History /> },
            ]}
          />
          <Section
            title="WhatsApp"
            items={[
              { to: '/inbox', label: 'Inbox', icon: <Inbox />, badge: data?.unreadChats },
              { to: '/whatsapp/canais', label: 'Canais', icon: <Smartphone /> },
              { to: '/whatsapp/mensagens', label: 'Mensagens de ativação', icon: <MessageSquareText /> },
            ]}
          />
          <Section
            title="Automação"
            items={[
              { to: '/automacao/fila', label: 'Fila e monitor', icon: <ListOrdered />, badge: data?.queue },
              { to: '/automacao/campanhas', label: 'Campanhas', icon: <Megaphone /> },
            ]}
          />
          <Section title="Dados" items={[{ to: '/dados', label: 'Casa dos Dados', icon: <Database /> }]} />
          <Section title="Sistema" items={[{ to: '/configuracoes', label: 'Configurações', icon: <Settings /> }]} />
        </nav>
        <div className="border-t border-white/5 p-3">
          <div className="mb-2 flex items-center gap-1.5 px-2 text-[11px] text-slate-500">
            {online ? <Wifi className="h-3 w-3 text-emerald-400" /> : <WifiOff className="h-3 w-3 text-red-400" />}
            {online ? 'Tempo real ativo' : 'Reconectando…'}
          </div>
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-white">{user?.name.charAt(0).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-slate-200">{user?.name}</p>
                <p className="text-[10px] text-slate-500">{user ? ROLE_LABELS[user.role] : ''}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
            </button>
            {menu && (
              <div className="absolute bottom-11 left-0 w-full rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-xl">
                <NavLink to="/configuracoes" onClick={() => setMenu(false)} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5">
                  <Settings className="h-3.5 w-3.5" /> Perfil e configurações
                </NavLink>
                <button onClick={() => void logout()} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-red-300 hover:bg-white/5">
                  <LogOut className="h-3.5 w-3.5" /> Sair
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

