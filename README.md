# MEGAZORD

**Plataforma de prospecção, dados e Multi-WhatsApp.**

A MEGAZORD une a prospecção comercial (antigo *Nibo Search*) e a gestão Multi-WhatsApp em **uma única aplicação**, com os mesmos objetos compartilhados por todas as telas:

```text
Empresa → Contato (sócio + celular) → Lead → Conversa → Mensagem → Canal WhatsApp → Histórico
```

O fluxo principal acontece sem sair da plataforma:

```text
Descobrir empresa → já foi trabalhada? → trazer contatos → sócio → celular
→ mensagem de ativação → escolher WhatsApp (manual ou rodízio) → enviar
→ registrar → acompanhar a resposta no Inbox
```

---

## Sumário

1. [Mapa do produto](#mapa-do-produto)
2. [Arquitetura](#arquitetura)
3. [Instalação](#instalação)
4. [Configuração](#configuração)
5. [Banco de dados](#banco-de-dados)
6. [Casa dos Dados](#casa-dos-dados)
7. [Firefox Extension, Containers e Local Bridge](#firefox-extension-containers-e-local-bridge)
8. [Evolution API](#evolution-api)
9. [Os oito canais](#os-oito-canais)
10. [Rodízio](#rodízio)
11. [Fila, campanhas e cadência](#fila-campanhas-e-cadência)
12. [Importação e exportação](#importação-e-exportação)
13. [Segurança](#segurança)
14. [Deploy](#deploy)
15. [Testes](#testes)
16. [Solução de problemas](#solução-de-problemas)

---

## Mapa do produto

| | |
|---|---|
| **Preservado** | Filtros de prospecção, Descobrir novos, Buscar 20 novos, Próximos 20, "Já usamos este CNPJ?", Trazer contatos, Tentar pela Receita, Limpar cache, histórico/status/opt-out, Firefox Containers por número, log e comunicação com o bridge, importação e exportação. |
| **Fundido** | Um único **Lead** liga a empresa da prospecção à conversa do Inbox; um único **histórico** registra enriquecimento, envios, respostas e mudanças de status; uma única **fila** atende envios individuais, respostas do Inbox, campanhas e follow-ups; uma única **tela de canais** junta WhatsApp, Container e instância Evolution. |
| **Removido** | Listas de contatos e conversas separadas por ferramenta, cadastro duplicado de mensagens, telas de "resultados" e "contatos" independentes (agora são cards e painel do lead). |
| **Novo** | Inbox unificado com filtro por canal, rodízio persistente 1→N com disponibilidade, até 8 números, campanhas com pré-visualização real, cadência D1/D3/D7 com cancelamento automático, webhooks idempotentes, tempo real (WebSocket), perfis Administrador/Supervisor/SDR. |

Menu:

```text
Dashboard
Prospecção     → Descobrir empresas · Histórico e contatos
WhatsApp       → Inbox · Canais · Mensagens de ativação
Automação      → Fila e monitor · Campanhas
Dados          → Casa dos Dados
Configurações  → Perfil · Usuários · WhatsApp · Firefox Containers · Integrações · Segurança · Importar/Exportar
```

---

## Arquitetura

```text
┌────────────── Netlify (ou o próprio backend) ──────────────┐
│ Frontend React 19 + Vite + TypeScript + Tailwind            │
└──────────────┬───────────────────────────┬──────────────────┘
               │ REST /api                 │ WebSocket /ws (tempo real)
┌──────────────▼───────────────────────────▼──────────────────┐
│ Backend Node.js + Express + TypeScript (serviço persistente)│
│  routes → controllers → services → repositories → db        │
│  integrations: CasaDosDados · Receita · Evolution · Firefox │
│  queue: fila persistente + worker + rodízio                 │
└──────┬─────────────────┬──────────────────┬─────────────────┘
       │                 │                  │ WebSocket /ws/bridge
  PostgreSQL       Evolution API     Extensão MEGAZORD (Firefox)
 (ou PGlite)      (webhooks ↗)        └─ Container WA 0N → WhatsApp Web
```

```text
src/
  frontend/   components/ pages/ hooks/ services/ types/
  backend/    controllers/ services/ repositories/ routes/ middleware/ integrations/ queue/ lib/
  db/         dbClient.ts, migrate.ts
  shared/     constantes, tipos, regras puras (rodízio, variáveis, telefone/CNPJ)
schema.sql    schema PostgreSQL idempotente
extension/    extensão Firefox (bridge local)
tests/        testes (vitest + supertest)
```

Camadas de integração:

```text
DataProvider                       WhatsAppTransport
 ├── CasaDosDadosProvider           ├── EvolutionTransport
 └── ReceitaProvider (BrasilAPI)    └── FirefoxTransport
CasaDosDadosService = único ponto de acesso (chave, cache, limite, logs)
```

---

## Instalação

Requisitos: **Node.js 20+** e Firefox (para o bridge).

```bash
npm install
cp .env.example .env      # ajuste se quiser; funciona sem nada configurado
npm run dev               # API em :3001 + frontend em :5173
```

Abra <http://localhost:5173>. O **primeiro perfil criado vira Administrador** e a conta já nasce com WA 01–WA 04, seus Containers e quatro mensagens de ativação de exemplo.

Scripts:

| Comando | O que faz |
|---|---|
| `npm run dev` | API (tsx watch) + Vite |
| `npm run build` | build do frontend (`dist/web`) e do backend (`dist/server`) |
| `npm start` | sobe o backend compilado (serve também o `dist/web`) |
| `npm test` | testes automatizados |
| `npm run typecheck` | checagem de tipos front e back |
| `npm run db:migrate` | aplica o `schema.sql` no banco configurado |
| `npm run extension:zip` | empacota a extensão Firefox |

---

## Configuração

Todas as variáveis estão documentadas em [`.env.example`](.env.example). As mais importantes:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | PostgreSQL. Vazio → PGlite local |
| `APP_ENCRYPTION_KEY` | criptografia AES-256-GCM das credenciais (obrigatória em produção, ≥ 32 caracteres) |
| `WEBHOOK_SECRET` | segredo exigido em `/api/webhook/evolution?token=…` (obrigatório em produção) |
| `PUBLIC_API_URL` | URL pública do backend (o webhook da Evolution é montado com ela) |
| `CORS_ORIGINS` | domínio(s) do frontend |
| `CASA_DOS_DADOS_API_KEY` | opcional; o admin pode cadastrar pela interface |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | opcionais; também configuráveis pela interface |
| `VITE_API_URL` | URL do backend para o build do frontend no Netlify |

Em `NODE_ENV=production` o backend **não sobe** sem `DATABASE_URL`, `APP_ENCRYPTION_KEY` e `WEBHOOK_SECRET`.

---

## Banco de dados

- **Produção:** qualquer PostgreSQL 14+ (Supabase, Neon, Cloud SQL, RDS…). Defina `DATABASE_URL`; o schema é aplicado automaticamente no boot (idempotente) ou via `npm run db:migrate`.
- **Desenvolvimento:** sem `DATABASE_URL` a MEGAZORD usa **PGlite** (Postgres real em WASM), em disco (`./data/pglite`) ou em memória (`PGLITE_DATA_DIR=memory`). As mesmas queries rodam nos dois modos.

Tabelas: `users`, `accounts`, `sessions`, `whatsapp_channels` (com `order_index`), `firefox_containers`, `rotation_state`, `companies`, `contacts`, `leads`, `chats`, `messages`, `message_templates`, `campaigns`, `campaign_contacts`, `message_queue`, `contact_history`, `opt_outs`, `system_logs`, `api_credentials`, `prospect_searches`, `lookup_cache`, `webhook_events`.

Cada mensagem registra empresa, contato, lead, conversa, canal, campanha, usuário, data/hora, status, transporte e container.

---

## Casa dos Dados

1. **Configurações → Integrações**: cole a API Key (mostrar/ocultar e copiar são restritos ao admin e auditados), defina o limite diário e clique em **Testar conexão / consultar saldo**.
2. A chave fica **criptografada no banco** e só é usada pelo backend. Nunca vai para o navegador sem ação explícita do admin e nunca é gravada em log.
3. Todas as chamadas passam pelo `CasaDosDadosService` (limite diário, cache de 7 dias, status da conexão, última consulta, logs).

Uso:

- **Descobrir empresas**: `POST /v5/cnpj/pesquisa` com CNAE contábil (6920-6/01 e 6920-6/02), situação ATIVA, UF, município, bairro, tempo de abertura e "somente com celular". O porte (ME/EPP/Demais) é filtrado no resultado.
- **Trazer contatos**: `GET /v4/cnpj/{cnpj}`: quadro societário e telefones. O contato principal é **sócio (administrador primeiro) + celular**.
- **Casa dos Dados (menu Dados)**: busca objetiva por CNPJ com destaque para **Sócio · Celular · Empresa**.

> Os caminhos e o mapeamento de campos estão isolados em `src/backend/integrations/casaDosDados/CasaDosDadosProvider.ts`, com leitura tolerante a variações (`razao_social`, `quadro_societario`, `contato_telefonico`…). Se o fornecedor mudar a versão da API, ajuste `CASA_DOS_DADOS_*_PATH` ou esse arquivo, sem mexer no resto do sistema.

**Tentar pela Receita** usa BrasilAPI (com fallback para ReceitaWS), sem chave.

"Informação não encontrada" (`not_found`) e "consulta apresentou erro" (`error`) são estados diferentes, gravados na empresa e mostrados de forma distinta na interface.

---

## Firefox Extension, Containers e Local Bridge

Cada WhatsApp tem um **Firefox Container** próprio (`WA 01 → MEGAZORD WA 01`, …), com sua sessão independente do WhatsApp Web.

```text
MEGAZORD (backend) ⇄ WebSocket /ws/bridge ⇄ Extensão MEGAZORD ⇄ Container WA 0N ⇄ WhatsApp Web
```

### Instalação da extensão

1. Firefox → `about:preferences` → ative **Abas de contêiner**.
2. `about:debugging#/runtime/this-firefox` → **Carregar extensão temporária** → selecione `extension/manifest.json`.
   (Para uso permanente, empacote com `npm run extension:zip` e assine em addons.mozilla.org como extensão *unlisted*.)
3. Na MEGAZORD: **Configurações → Firefox Containers → Gerar token**. Copie o token, que é exibido uma única vez.
4. No popup da extensão: informe a URL do backend (ex.: `http://localhost:3001`) e o token → **Salvar e conectar**.
5. A MEGAZORD cria automaticamente os Containers `MEGAZORD WA 01…08`.
6. Em **Canais**, clique em **Testar Container** em cada número e leia o QR Code do WhatsApp Web **dentro do Container**.

### Como o envio funciona

- A extensão envia **heartbeat a cada 15 s** com os Containers existentes e o estado do WhatsApp Web em cada um (`ready`, `logged_out`, `loading`).
- Para enviar, o backend manda `wa.send` com o `cookieStoreId` do Container do canal. A extensão **reaproveita a aba do WhatsApp Web daquele Container** e só cria uma aba se nenhuma existir. Ela abre a conversa, confirma o envio no DOM e responde.
- Tudo é registrado: Container, número, horário, tentativa, sucesso/erro, resposta do bridge e último heartbeat.
- Os seletores do WhatsApp Web ficam centralizados em `extension/content.js` (`SELECTORS`). Se o WhatsApp mudar o layout, ajuste apenas ali.

Diagnóstico (tela Canais):

```text
Firefox Bridge 🟢 conectado · Containers detectados: 8
WA 01 → 🟢 WhatsApp Web pronto
WA 05 → ⚪ não configurado
```

Mensagens legíveis: *"Firefox Bridge indisponível. Abra a extensão MEGAZORD no Firefox para continuar."*, *"Container não encontrado"*, *"WhatsApp Web não aberto"*, *"Sessão inválida (QR Code)"*.

---

## Evolution API

**Configurações → WhatsApp**: URL + API Key global → **Testar conexão**.

| Ação | Endpoint |
|---|---|
| Sincronizar instâncias (boot e botão) | `GET /instance/fetchInstances` (número via `ownerJid`) |
| Conectar / QR Code (modal na própria MEGAZORD) | `POST /instance/create`, `GET /instance/connect/{inst}` |
| Status | `GET /instance/connectionState/{inst}` + webhook `CONNECTION_UPDATE` |
| Reconectar / desconectar / remover | `restart` / `logout` / `delete` |
| Envio | `POST /message/sendText/{inst}` |
| Webhook | configurado automaticamente para `PUBLIC_API_URL/api/webhook/evolution?token=WEBHOOK_SECRET` |

### Firefox e Evolution coexistem sem duplicar

Cada canal tem **um transporte de envio** (`firefox` ou `evolution`, editável em Canais → Editar). Um envio usa **um único transporte**.

Configuração recomendada: **envio pelo Firefox Container** e a **mesma linha vinculada também à Evolution** como aparelho conectado, para receber respostas, status de entrega/leitura e eventos de conexão via webhook. Mensagens enviadas pelo Firefox que voltam pelo webhook (`fromMe`) são **vinculadas ao registro existente**, sem duplicar.

---

## Os oito canais

- A conta começa com **WA 01–WA 04**. O botão **+** adiciona o próximo número livre (WA 05, WA 06, WA 07, WA 08), cada um com seu Container. Um nono número não é criado.
- Estados: 🟢 Conectado · 🟡 Conectando · 🔴 Desconectado · ⚪ Não configurado · ⏸ Pausado.
- Ações: conectar, reconectar, sincronizar, pausar/retomar, ativar/desativar fila, desconectar, remover, editar, ver conversas, estatísticas e log, testar Container, zerar erros.
- Cada canal tem **limite diário** e **cooldown** entre envios.

---

## Rodízio

```text
4 canais: 1 → 2 → 3 → 4 → 1 → 2 → 3 → 4 …
5 canais: 1 → 2 → 3 → 4 → 5 → 1 …
8 canais: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 1 …
```

- Ponteiro **persistido** em `rotation_state` (último = WA 03 → próximo = WA 04), que sobrevive a refresh, navegador fechado e restart do backend.
- O canal é escolhido **no processamento** de cada item, nunca pré-distribuído.
- Canais indisponíveis são **pulados temporariamente**: pausado, fila desativada, limite diário atingido, cooldown, erros consecutivos, sem Container, bridge offline, WhatsApp Web fechado/deslogado, Evolution desconectada. Ex.: WA 03 caiu → `1 → 2 → 4 → 1`; quando volta → `1 → 2 → 3 → 4`.
- Falha de canal coloca o número em cooldown curto e o item é reenviado por outro número.
- Envio **manual**: o usuário escolhe "Enviar pelo WA 0N" (não move o ponteiro). **Automático**: rodízio.

A regra está em `src/shared/rotation.ts` e é coberta por testes.

---

## Fila, campanhas e cadência

**Fila** (`message_queue`, persistente): `Pendente → Processando → Enviado → Entregue → Lido`, além de `Erro`, `Cancelado` e `Pausado`. Antes de cada envio:

- **Canal**: conectado? Container existe? WhatsApp disponível? pausado? limite?
- **Contato**: opt-out? "Não contatar"? status bloqueante? CNPJ já trabalhado? telefone já recebeu mensagem? já está na fila?

Se qualquer regra impedir, a mensagem **não é enviada** e o motivo fica registrado.

**Campanhas**: nome, público (status, UF, cidade, nunca contatados, limite), mensagem de ativação, data inicial, janela de horário, dias da semana, intervalo entre mensagens, limite diário e WhatsApps participantes. A **pré-visualização é obrigatória** e mostra exemplos reais (empresa, sócio, celular, mensagem), canal previsto, Container e próximo canal.

**Cadência** (opcional): Dia 1 ativação, Dia 3 follow-up, Dia 7 último contato. Os follow-ups saem pelo mesmo número da ativação. Antes de cada um, a sequência é **cancelada** se o contato respondeu, a reunião foi marcada, houve bloqueio/opt-out ou o telefone é inválido. Uma resposta recebida cancela os follow-ups pendentes na hora.

Limites de uso: a MEGAZORD não tem nenhum mecanismo para contornar bloqueios ou sistemas antiabuso do WhatsApp. Os controles (intervalo, limite diário, cooldown, opt-out) existem para manter o envio responsável.

---

## Importação e exportação

**Configurações → Importar/Exportar** (e atalhos nas telas):

- Exportar CSV/Excel: leads, histórico de contatos, mensagens enviadas/recebidas, mensagens de ativação.
- Importar CSV/XLSX: histórico/leads (colunas `cnpj`, `razao_social`, `nome_fantasia`, `socio`, `telefone`, `status`, `observacoes`, `cidade`, `uf`, `quantidade_contatos`, `ultimo_contato`) e mensagens de ativação (`nome`, `categoria`, `mensagem`, `favorita`).
- CNPJs importados contam como já vistos: não reaparecem em "Descobrir novos". Use isso para trazer o histórico do Nibo Search.

---

## Segurança

- Autenticação própria: senhas com **bcrypt (12 rounds)**, sessões com token opaco (apenas o hash SHA-256 fica no banco), expiração e revogação ao trocar a senha.
- Autorização por papel em todas as rotas (Administrador / Supervisor / SDR).
- Helmet, CORS restrito, rate limiting (login e API), validação e sanitização com zod, limite de payload.
- Credenciais criptografadas (AES-256-GCM); logs passam por redação automática de campos sensíveis.
- Webhooks com segredo, idempotência (`webhook_events`) e rejeição de eventos antigos (anti-replay).
- Exportação CSV protegida contra injeção de fórmulas.

---

## Deploy

### Backend (serviço Node persistente)

O backend mantém WebSockets (frontend e bridge) e o worker da fila, então precisa de um **processo contínuo**: Render, Railway, Fly.io, Cloud Run (min-instances ≥ 1), VPS etc. Ele não deve rodar como função serverless.

```bash
npm ci
npm run build
NODE_ENV=production DATABASE_URL=... APP_ENCRYPTION_KEY=... WEBHOOK_SECRET=... \
PUBLIC_API_URL=https://api.suaempresa.com CORS_ORIGINS=https://megazord.netlify.app npm start
```

Com `SERVE_FRONTEND=true` (padrão), o mesmo serviço também entrega o frontend. Assim um único deploy já resolve tudo.

### Frontend no Netlify

O `netlify.toml` já está pronto (build `npm run build:web`, publish `dist/web`, fallback SPA). No painel do Netlify, defina `VITE_API_URL=https://api.suaempresa.com` e inclua o domínio do Netlify em `CORS_ORIGINS` do backend.

---

## Testes

```bash
npm test
```

Cobrem: rodízio (4 a 8 canais, indisponibilidade, ponteiro persistido), fila (personalização, registros vinculados, duplicidade, opt-out, "Não contatar", reenvio por outro número, item sem canal disponível), limite de 8 canais com Containers, autorização por papel, chave criptografada e ausente dos logs, deduplicação da prospecção, sócio + celular, erro ≠ não encontrado, campanha com intervalo e cadência, webhooks idempotentes e status de leitura, importação/exportação e um teste ponta a ponta do Firefox Bridge com servidor real e extensão simulada.

---

## Solução de problemas

| Sintoma | Causa provável / solução |
|---|---|
| "Firefox Bridge indisponível" | Extensão não carregada, URL/token errados no popup ou backend inacessível. Veja o log no popup da extensão. |
| Containers não detectados | Ative "Abas de contêiner" no Firefox; clique em **Criar/sincronizar Containers** na tela Canais. |
| "WhatsApp Web não aberto" / "Sessão inválida" | Use **Testar Container** e leia o QR Code dentro do Container daquele canal. |
| Envio pelo Firefox não confirma | O WhatsApp Web pode ter mudado o DOM: ajuste `SELECTORS` em `extension/content.js`. |
| "Chave da Casa dos Dados inválida" | Revise a chave em Integrações → Testar conexão. |
| Casa dos Dados recusa a consulta (400/422) | A versão da API mudou: ajuste `CASA_DOS_DADOS_*_PATH` ou o mapeamento em `CasaDosDadosProvider.ts`. |
| "Limite diário atingido" | Ajuste o limite em Integrações (Casa dos Dados) ou em Canais → Editar (WhatsApp). |
| Evolution não recebe respostas | Confira `PUBLIC_API_URL` acessível pela Evolution e `WEBHOOK_SECRET`; use **Conectar** novamente para reconfigurar o webhook. |
| Mensagens ficam "Pendente" | Nenhum canal disponível (veja "Fora do rodízio" em Canais), campanha fora da janela de horário ou intervalo ainda não decorrido. |
| Webhook retorna 401 | Token ausente/errado em `?token=` (deve ser igual a `WEBHOOK_SECRET`). |
