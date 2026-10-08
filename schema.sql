-- =====================================================================
-- MEGAZORD — schema PostgreSQL
-- Compatível com PostgreSQL 14+, Supabase, Neon, Cloud SQL e PGlite.
-- Idempotente: pode ser executado várias vezes.
--
-- Relacionamento central:
--   companies → contacts → leads → chats → messages → whatsapp_channels
-- =====================================================================

CREATE TABLE IF NOT EXISTS accounts (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  bridge_token_hash TEXT,
  bridge_token_last4 TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'sdr' CHECK (role IN ('admin','supervisor','sdr')),
  active        BOOLEAN NOT NULL DEFAULT true,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  user_agent  TEXT,
  ip          TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Credenciais de integrações (Casa dos Dados, Evolution). Valor criptografado (AES-256-GCM).
CREATE TABLE IF NOT EXISTS api_credentials (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  last4           TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ,
  last_error      TEXT,
  usage_today     INTEGER NOT NULL DEFAULT 0,
  usage_date      DATE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, provider)
);

-- Canais WhatsApp (WA 01..WA 08). order_index define o rodízio.
CREATE TABLE IF NOT EXISTS whatsapp_channels (
  id                 SERIAL PRIMARY KEY,
  account_id         INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_index        INTEGER NOT NULL CHECK (order_index BETWEEN 1 AND 8),
  name               TEXT NOT NULL,
  phone              TEXT,
  transport          TEXT NOT NULL DEFAULT 'firefox' CHECK (transport IN ('firefox','evolution')),
  evolution_instance TEXT,
  status             TEXT NOT NULL DEFAULT 'not_configured'
                     CHECK (status IN ('connected','connecting','disconnected','not_configured')),
  paused             BOOLEAN NOT NULL DEFAULT false,
  queue_enabled      BOOLEAN NOT NULL DEFAULT true,
  daily_limit        INTEGER NOT NULL DEFAULT 80,
  cooldown_seconds   INTEGER NOT NULL DEFAULT 60,
  cooldown_until     TIMESTAMPTZ,
  last_sent_at       TIMESTAMPTZ,
  sent_count         INTEGER NOT NULL DEFAULT 0,
  received_count     INTEGER NOT NULL DEFAULT 0,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, order_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_evolution_instance
  ON whatsapp_channels(evolution_instance) WHERE evolution_instance IS NOT NULL;

-- Firefox Container associado a cada canal (WA 0N → Container 0N).
CREATE TABLE IF NOT EXISTS firefox_containers (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id      INTEGER NOT NULL UNIQUE REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  cookie_store_id TEXT,
  color           TEXT NOT NULL DEFAULT 'green',
  icon            TEXT NOT NULL DEFAULT 'briefcase',
  status          TEXT NOT NULL DEFAULT 'not_found'
                  CHECK (status IN ('ok','not_found','unknown')),
  wa_status       TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (wa_status IN ('ready','not_open','logged_out','loading','unknown')),
  last_seen_at    TIMESTAMPTZ
);

-- Ponteiro persistente do rodízio.
CREATE TABLE IF NOT EXISTS rotation_state (
  account_id       INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_order_index INTEGER NOT NULL DEFAULT 0,
  last_channel_id  INTEGER,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS companies (
  id                SERIAL PRIMARY KEY,
  account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cnpj              TEXT NOT NULL,
  razao_social      TEXT,
  nome_fantasia     TEXT,
  situacao          TEXT,
  cnae              TEXT,
  cnae_descricao    TEXT,
  data_abertura     DATE,
  porte             TEXT,
  logradouro        TEXT,
  numero            TEXT,
  complemento       TEXT,
  bairro            TEXT,
  cidade            TEXT,
  uf                TEXT,
  cep               TEXT,
  email             TEXT,
  phones            JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw               JSONB,
  source            TEXT,
  -- pending | found | not_found | error  (não encontrado ≠ erro)
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  enrichment_error  TEXT,
  enriched_at       TIMESTAMPTZ,
  presented_at      TIMESTAMPTZ,
  presented_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, cnpj)
);
CREATE INDEX IF NOT EXISTS idx_companies_presented ON companies(account_id, presented_at);

CREATE TABLE IF NOT EXISTS contacts (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT,
  role        TEXT,
  phone       TEXT,
  phone_type  TEXT CHECK (phone_type IN ('celular','fixo','desconhecido')),
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  source      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(account_id, phone);

CREATE TABLE IF NOT EXISTS leads (
  id               SERIAL PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_id       INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id       INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'novo' CHECK (status IN (
                     'novo','em_contato','aguardando_resposta','interessado','reuniao_agendada',
                     'sem_interesse','nao_respondeu','nao_contatar','convertido')),
  owner_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_channel_id  INTEGER REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  first_contact_at TIMESTAMPTZ,
  last_contact_at  TIMESTAMPTZ,
  last_reply_at    TIMESTAMPTZ,
  contact_count    INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  do_not_contact   BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(account_id, status);

CREATE TABLE IF NOT EXISTS chats (
  id                   SERIAL PRIMARY KEY,
  account_id           INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id           INTEGER NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  lead_id              INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  contact_id           INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  remote_phone         TEXT NOT NULL,
  remote_name          TEXT,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count         INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, channel_id, remote_phone)
);
CREATE INDEX IF NOT EXISTS idx_chats_last ON chats(account_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS message_templates (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'ativacao',
  body        TEXT NOT NULL,
  favorite    BOOLEAN NOT NULL DEFAULT false,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               SERIAL PRIMARY KEY,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  template_id      INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  audience         JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_at         TIMESTAMPTZ,
  window_start     TEXT NOT NULL DEFAULT '09:00',
  window_end       TEXT NOT NULL DEFAULT '18:00',
  weekdays         JSONB NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  interval_seconds INTEGER NOT NULL DEFAULT 90,
  daily_limit      INTEGER NOT NULL DEFAULT 100,
  cadence          JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
  last_sent_at     TIMESTAMPTZ,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_contacts (
  id            SERIAL PRIMARY KEY,
  campaign_id   INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id       INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','queued','sent','skipped','error','cancelled')),
  step          INTEGER NOT NULL DEFAULT 1,
  reason        TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);

-- Fila central persistente. O canal é escolhido no PROCESSAMENTO (não na criação).
CREATE TABLE IF NOT EXISTS message_queue (
  id            SERIAL PRIMARY KEY,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id   INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id       INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  company_id    INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  template_id   INTEGER REFERENCES message_templates(id) ON DELETE SET NULL,
  phone         TEXT NOT NULL,
  body          TEXT,
  channel_mode  TEXT NOT NULL DEFAULT 'auto' CHECK (channel_mode IN ('auto','manual')),
  channel_id    INTEGER REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL DEFAULT 'activation' CHECK (kind IN ('activation','followup','manual')),
  step          INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                  'pending','processing','sent','delivered','read','error','cancelled','paused')),
  priority      INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  last_error    TEXT,
  skip_reason   TEXT,
  message_id    INTEGER,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_pick ON message_queue(status, scheduled_at, priority DESC);

CREATE TABLE IF NOT EXISTS messages (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  chat_id        INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  company_id     INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id     INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  lead_id        INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  channel_id     INTEGER REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  campaign_id    INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  queue_item_id  INTEGER REFERENCES message_queue(id) ON DELETE SET NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('in','out')),
  body           TEXT,
  media          JSONB,
  status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN (
                   'pending','sent','delivered','read','failed','received')),
  transport      TEXT,
  container_name TEXT,
  external_id    TEXT,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at        TIMESTAMPTZ,
  delivered_at   TIMESTAMPTZ,
  read_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_external ON messages(external_id);

CREATE TABLE IF NOT EXISTS contact_history (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  company_id  INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel_id  INTEGER REFERENCES whatsapp_channels(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_lead ON contact_history(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opt_outs (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone       TEXT,
  cnpj        TEXT,
  reason      TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_optouts_phone ON opt_outs(account_id, phone);
CREATE INDEX IF NOT EXISTS idx_optouts_cnpj ON opt_outs(account_id, cnpj);

CREATE TABLE IF NOT EXISTS system_logs (
  id          SERIAL PRIMARY KEY,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  level       TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('debug','info','warn','error')),
  category    TEXT NOT NULL,
  action      TEXT NOT NULL,
  message     TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_logs_account ON system_logs(account_id, created_at DESC);

-- Histórico de buscas de prospecção (critérios utilizados / paginação "Próximos 20").
CREATE TABLE IF NOT EXISTS prospect_searches (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filters      JSONB NOT NULL,
  next_page    INTEGER NOT NULL DEFAULT 1,
  total        INTEGER,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cache de consultas externas (pode ser limpo sem afetar o histórico comercial).
CREATE TABLE IF NOT EXISTS lookup_cache (
  key         TEXT PRIMARY KEY,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  value       JSONB NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Idempotência / anti-replay de webhooks.
CREATE TABLE IF NOT EXISTS webhook_events (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL,
  event_key   TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, event_key)
);
