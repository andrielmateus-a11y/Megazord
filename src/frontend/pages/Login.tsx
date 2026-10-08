import { ArrowRight, Database, Radar, Smartphone } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBox, Field, Input } from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [reg, setReg] = useState<{ firstUser: boolean; open: boolean } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '', companyName: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/auth/status').then((s) => {
      setReg(s);
      if (s.firstUser) setMode('register');
    }).catch(() => setReg({ firstUser: false, open: false }));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else await register(form);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-lg font-black">M</div>
          <span className="text-lg font-bold tracking-[0.25em]">MEGAZORD</span>
        </div>
        <div>
          <h1 className="max-w-md text-3xl leading-tight font-semibold">Encontre a empresa, identifique o sócio e ative o contato — tudo em um só lugar.</h1>
          <div className="mt-8 space-y-4 text-sm text-slate-300">
            <p className="flex items-center gap-3"><Radar className="h-4 w-4 text-brand-200" /> Prospecção de escritórios contábeis ativos e inéditos</p>
            <p className="flex items-center gap-3"><Database className="h-4 w-4 text-brand-200" /> Sócio, celular e empresa via Casa dos Dados</p>
            <p className="flex items-center gap-3"><Smartphone className="h-4 w-4 text-brand-200" /> Até 8 WhatsApps em rodízio com Firefox Containers</p>
          </div>
        </div>
        <p className="text-xs text-slate-500">Plataforma de prospecção, dados e Multi-WhatsApp.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{mode === 'login' ? 'Entrar' : reg?.firstUser ? 'Configurar a MEGAZORD' : 'Criar perfil'}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'login' ? 'Acesse sua central de prospecção.' : reg?.firstUser ? 'O primeiro perfil criado será o Administrador.' : 'Crie seu perfil de acesso.'}
            </p>
          </div>
          <ErrorBox message={error} />
          {mode === 'register' && (
            <>
              <Field label="Nome">
                <Input value={form.name} onChange={set('name')} required autoComplete="name" />
              </Field>
              {reg?.firstUser && (
                <Field label="Empresa / equipe">
                  <Input value={form.companyName} onChange={set('companyName')} placeholder="Ex.: Nibo Comercial" />
                </Field>
              )}
            </>
          )}
          <Field label="E-mail">
            <Input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
          </Field>
          <Field label="Senha" hint={mode === 'register' ? 'Mínimo de 8 caracteres, com letras e números.' : undefined}>
            <Input type="password" value={form.password} onChange={set('password')} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </Field>
          <Button type="submit" loading={busy} className="w-full" icon={<ArrowRight className="h-4 w-4" />}>
            {mode === 'login' ? 'Entrar' : 'Criar perfil'}
          </Button>
          {reg?.open && !reg.firstUser && (
            <p className="text-center text-xs text-slate-500">
              {mode === 'login' ? 'Ainda não tem acesso? ' : 'Já tem perfil? '}
              <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? 'Criar perfil' : 'Entrar'}
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
