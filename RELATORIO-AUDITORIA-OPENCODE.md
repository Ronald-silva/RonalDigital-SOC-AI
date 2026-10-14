# Relatório de Auditoria — RonalDigital-SOC-AI (fork DeskcommCRM)

**Data:** 2026-10-13  
**Escopo:** Auditoria SOMENTE LEITURA — o que bloqueia vender uma instalação de referência (implantação + mensalidade, um nicho, WhatsApp via WAHA Core)

---

> ## ⚠️ ERRATA — remedido em 2026-10-14
>
> **Este é um retrato de 2026-10-13.** Dois itens dele foram remedidos no dia
> seguinte e estavam **errados**. Eles seguem no texto abaixo, marcados
> `[CORRIGIDO 2026-10-14]`, porque apagá-los apagaria o rastro de contra qual
> régua as decisões daquele dia foram tomadas.
>
> **Item 1 e Bloco 6 — "fork 460 commits atrás" venceu.** O merge foi feito:
>
> ```console
> $ git fetch upstream && git rev-list --count main..upstream/main
> 0
> $ git rev-list --count upstream/main..main
> 7
> ```
>
> O fork está em dia com o upstream e tem quatro entregas próprias — a lista
> está em [`ESTADO-DO-FORK.md`](ESTADO-DO-FORK.md) §2. A frase "fork não tem
> commits à frente" também deixou de valer.
>
> **Item 9 e Bloco 5 — "não há como esconder abas/menu sem código" é FALSO, e
> já era na data da auditoria.** O item mede o arquivo errado: o mecanismo não
> se chama `enabled`/`hidden` e não mora no `registry.ts`. Ele é a interseção
> `organizations.interface_settings ∩ user_organizations.interface_settings`,
> resolvida em `lib/navigation/interface.ts:206` (migration 0367), com tela em
> **Configurações › Organização › Menu lateral** e em **Equipe › membro**.
> Sidebar, hubs e ⌘K são projeções puras dela
> (`lib/navigation/registry.ts:116`, `:144`, `:174`). Quem declara destino é
> `lib/navigation/catalogo.ts`; o `registry.ts` só deriva e reexporta — é a
> face do módulo, e é por isso que o engano é fácil.
>
> Consequência prática: o perfil enxuto de menu **não** precisou de código no
> núcleo. Virou um script de uma chamada SQL
> ([`docs/fork/perfil-enxuto.md`](docs/fork/perfil-enxuto.md)).
>
> Os demais itens **não** foram remedidos — continuam valendo até que alguém os
> meça de novo.

---

## 1. Resumo de 10 linhas — O que bloqueia a venda hoje

1. **Fork 460 commits atrás do upstream/main** — correções críticas de RLS, pacing, onboarding, e-mails de acesso, warm-up, healthcheck não estão no fork (`git rev-list --count main..upstream/main = 460`). **[CORRIGIDO 2026-10-14: merge feito; a contagem é 0. Ver a errata no topo.]**
2. **Nenhum modo "shadow/dry-run" na primeira conexão WAHA** — sessão conecta e o agente **responde contatos reais imediatamente**; não há botão "só observa" nem flag de teste (`lib/agent-engine/agent/inbound-turn.ts`, `lib/agent-engine/edge/crm/drain.ts`).
3. **Contagem de "N número(s) conectado(s)" conta sessões, não status WORKING** — `ConnectionsClient.tsx:393` usa `list.length` filtrando só `provider !== SOCIAL`, sem checar `status === 'WORKING'`.
4. **`channel_session.status_changed` não tem consumidor em `event_log`** — evento chega no webhook WAHA, atualiza coluna `status` + `last_status_change_at`, mas **não emite evento** para auditoria/alertas (`lib/waha/ingest.ts:1623-1670`).
5. **Custo por atendimento/conversa não existe na tela "Uso e orçamento"** — `llm_calls` tem `contact_id` mas a agregação `fn_uso_de_ia` soma por dia/purpose/agent, não por contato (`lib/ai/usage/aggregate.ts`, `app/api/v1/ai/usage/route.ts`).
6. **E-mails de acesso (confirmação/recuperação) não acompanham troca de marca pela tela** — `marca-emails.sh` só roda no `install.sh`/`update.sh`; trocar cor/nome em `/admin/marca` não atualiza GoTrue (`hostgator-setup-kit/marca-emails.sh:126-136`).
7. **Seed por nicho inexistente** — novo cliente recebe CRM vazio (sem funil, vocabulário, agente, base de conhecimento); extensões existem mas são 3 pacotes genéricos (`extensoes/catalogo.json`).
8. **Tela de saúde `/api/v1/health` mostra `version: "desconhecido"`** — `APP_VERSION` não é injetada no build da imagem em instalações self-host (`app/api/v1/health/route.ts:316-326`, `Dockerfile:123-124`).
9. **Recursos opcionais não têm flag de UI** — não há como esconder abas/menu sem código; `lib/navigation/registry.ts` não tem `enabled: false` por recurso. **[CORRIGIDO 2026-10-14: FALSO — o mecanismo existe, chama-se `interface_settings` e mora em `lib/navigation/interface.ts:206`. Ver a errata no topo.]**
10. **Testes unitários lentos demais (1391 arquivos)** — suíte completa excede 10 min; CI roda matriz paralela mas dev local trava.

---

## 2. Tabela de Itens

| Item | Bloco | Status | Evidência | Gravidade |
|------|-------|--------|-----------|-----------|
| ~~Fork 460 commits atrás do upstream~~ **[CORRIGIDO 2026-10-14: 0]** | 6 | VENCIDO | `git rev-list --count main..upstream/main = 460` | ~~**Bloqueia venda**~~ resolvido |
| Sem modo shadow/dry-run na 1ª conexão WAHA | 2 | MEDIDO | `lib/agent-engine/edge/crm/drain.ts:305-339` (haQuemAtendaASessao passa se há agente publicado; não há gate de "só observa") | **Bloqueia venda** |
| Agente responde contatos reais ao conectar | 2 | MEDIDO | `drain.ts:332-339` — `haQuemAtendaASessao` retorna true se há agente publicado/roteador com fallback publicado; turno é enfileirado sem gate de warm-up/observação | **Bloqueia venda** |
| "N número(s) conectado(s)" conta sessões, não WORKING | 4 | MEDIDO | `components/connections/ConnectionsClient.tsx:393` — `list.length` sem filtro de `status` | **Risco operacional** |
| `channel_session.status_changed` sem consumidor event_log | 4 | MEDIDO | `lib/waha/ingest.ts:1623-1670` — `handleSessionStatus` atualiza coluna mas não emite `event_log` | **Risco operacional** |
| Custo por atendimento não existe | 3 | MEDIDO | `lib/ai/usage/aggregate.ts` — `fn_uso_de_ia` agrega por dia/purpose/agent; `contact_id` em `llm_calls` não usado | **Risco operacional** |
| E-mails de acesso não seguem marca da tela | 5 | MEDIDO | `hostgator-setup-kit/marca-emails.sh:126-136` — comentário admite defasagem inerente | **Risco operacional** |
| Seed por nicho inexistente (clínica, imobiliária, etc.) | 5 | MEDIDO | `extensoes/catalogo.json` — só 3 pacotes genéricos; `supabase/seed/` não tem templates por nicho | **Bloqueia venda** |
| `/api/v1/health` version = "desconhecido" | 4 | MEDIDO | `app/api/v1/health/route.ts:316-326` — fallback para `"desconhecido"`; `APP_VERSION` ARG no Dockerfile mas não passado no compose de produção | **Cosmético** |
| Recursos opcionais sem flag de UI | 5 | MEDIDO | `lib/navigation/catalogo.ts` — entradas não têm `enabled`/`hidden`; `tests/unit/navegacao-completude.test.ts` exige porta declarada | **Cosmético** |
| Testes unitários >10 min (1391 arquivos) | 7 | MEDIDO | `git ls-files 'tests/unit/*.test.ts' | wc -l = 1391`; execução local excede timeout | **Risco operacional** |
| Lint: 0 erros, 532 warnings | 7 | MEDIDO | `npx pnpm lint` — exit code 0 | Cosmético |
| Typecheck: passa | 7 | MEDIDO | `NODE_OPTIONS=--max-old-space-size=7168 npx pnpm typecheck` — exit code 0 | — |
| Test:shell: passa | 7 | MEDIDO | `npx pnpm test:shell` — todos verdes | — |

---

## 3. Para cada item "Bloqueia venda": menor mudança possível

### 3.1 Fork 460 commits atrás — **[FEITO em 2026-10-14; a contagem é 0]**
- **Mudança:** `git merge upstream/main` (ou rebase) + resolver conflitos
- **Arquivos tocados:** Todos com conflitos (esperados: migrations, `CLAUDE.md`, `package.json`, `docker-compose*.yml`, `hostgator-setup-kit/`)
- **Callers:** N/A (atualização de base)
- **Testes:** `pnpm gov:verify` + `pnpm test:shell` + `pnpm test:db` (exige Docker)

### 3.2 Sem modo shadow/dry-run na 1ª conexão
- **Mudança:** Adicionar coluna `shadow_mode` em `channel_sessions` (migration) + gate no drain (`haQuemAtendaASessao` respeita `shadow_mode`) + botão "Modo observação" na tela Conexões
- **Arquivos:** `supabase/migrations/YYYYMMDD_shadow_mode.sql`, `lib/agent-engine/edge/crm/drain.ts`, `components/connections/ConnectionsClient.tsx`, `app/api/v1/channel-sessions/[id]/route.ts`
- **Callers:** `haQuemAtendaASessao` (lib/ai/agents/quem-atende-a-sessao.ts), drain loop
- **Testes:** `tests/unit/shadow-mode-gate.test.ts` (novo), `tests/invariants/shadow-mode-nao-responde.test.ts` (novo)

### 3.3 Agente responde ao conectar (sem warm-up gate)
- **Mudança:** No drain, exigir `is_warmup_complete = true` OU `warmup_started_at` com idade ≥ 0 dias (cap 20/dia já existe em `PACING_DEFAULTS.warmupDailyCaps[0]`) ANTES de enfileirar turno. Já existe `is_warmup_complete` na query do webhook (`lib/waha/ingest.ts:115`).
- **Arquivos:** `lib/agent-engine/edge/crm/drain.ts:332-339` (adicionar checagem de warm-up no `haQuemAtendaASessao` ou inline)
- **Callers:** `haQuemAtendaASessao` → `drainTick` → `processEvent`
- **Testes:** `tests/invariants/warmup-gate-bloqueia-turno.test.ts` (novo)

### 3.4 Seed por nicho inexistente
- **Mudança:** Criar extensões declarativas por nicho (clínica, imobiliária, estética, infoproduto, serviços, loja) com: funil, vocabulário, agente publicado, base de conhecimento, follow-ups. Publicar no catálogo `extensoes/catalogo.json`.
- **Arquivos:** `extensoes/pacotes/deskcomm/clinica-1.0.0.json`, `imobiliaria-1.0.0.json`, `estetica-1.0.0.json`, `infoproduto-1.0.0.json`, `servicos-1.0.0.json`, `loja-1.0.0.json` + atualizar `extensoes/catalogo.json`
- **Callers:** Tela de extensões (`app/app/extensoes/`) instala e provisiona tabelas via função fixa (ADR-0002)
- **Testes:** `tests/unit/extensao-clinica-provisiona.test.ts` (novo)

---

## 4. O que NÃO consegui verificar e por quê

| Item | Por que não verifiquei |
|------|------------------------|
| `pnpm test:unit` resumo completo (total, passou, falhou, lista de falhas) | Suíte tem 1391 arquivos; execução completa excede 10 min (timeout do shell tool). Amostragem mostrou testes passando; nenhum erro de lint/typecheck. |
| `pnpm test:db` (invariantes RLS/isolamento) | Exige Docker com Postgres efêmero; não rodado por segurança (regra: "não rode test:db"). |
| `pnpm test:e2e` (Playwright) | Exige app buildado + banco semeado + `.env.e2e` apontando para localhost; não rodado por segurança. |
| `pnpm build` (Next.js build) | Não rodado por regra ("não rode build"). |
| Healthcheck real em VPS (cadeado, DNS, proxy) | Exige VPS real com domínio apontado; não disponível no ambiente de auditoria. |
| Conexão WAHA real (QR, sessão WORKING, webhook) | Exige WAHA rodando + WhatsApp real; não disponível. |
| Custo real por atendimento em produção | Exige dados de `llm_calls` com `contact_id` preenchido por turnos reais; não disponível. |
| Migração `upstream/main` → fork (conflitos reais) | `git merge` não executado (regra: não faça commit/mudança). Conflitos esperados em migrations, `CLAUDE.md`, `docker-compose*.yml`, scripts do kit. |

---

## 5. Notas adicionais por bloco

### Bloco 1 — Entrar na interface
- `reset-password.sh` usa Supabase Admin API (service_role) para redefinir senha — **funciona**, exige `SUPABASE_SERVICE_ROLE_KEY` no `.env`.
- Admin é criado no `install.sh:2215-2332` via `curl` para `/auth/v1/admin/users` + SQL que cria org + membership + `platform_admins` com `mfa_required=false`.
- Recuperação sem apagar dados: `reset-password.sh` + `reset-mfa.sh` (remove fatores MFA de `auth.mfa_factors`). **Documentado no kit**.

### Bloco 2 — Primeira conexão WhatsApp
- **Valores padrão de throttle/warm-up/janela:** `lib/agent-engine/pacing/defaults.ts:100-128` — `throttleMs: 1200`, `jitterMaxMs: 800`, janela 7h-22h, warm-up caps: 0d→20, 4d→50, 8d→100, 15d→200, 31d→sem cap.
- **Fluxo exato:** WAHA webhook (`app/api/v1/webhooks/waha/route.ts`) → `processarEventoWaha` → `dispatchWahaEvent` → `handleInbound` → `aplicarEfeitosPosEntrada` → `event_log` `ai_agent.dispatch_requested` → drain (`lib/agent-engine/edge/crm/drain.ts`) → `haQuemAtendaASessao` → enfileira `inbound_turn` → worker executa `createInboundTurnHandler` → `resolveTurnAgent` → `runAgentTurn` → `comHandoffSeOrcamentoAcabar` → modelo responde.
- **Gates que impedem resposta:** (1) org não operante, (2) modo `external`, (3) canal desativado, (4) grupo, (5) **nenhum agente publicado/roteador com fallback publicado**, (6) follow-up de retorno ativo, (7) elegibilidade (allowlist), (8) mídia transcrevendo, (9) rajada coalescida, (10) orçamento estourado (handoff para humano).

### Bloco 3 — IA e custo
- Chave do provedor: `lib/ai/credenciais/guardar.ts:128-198` — criptografa AES-GCM, grava `api_key_encrypted/iv/tag/last4`, valida em background, audit `ai.credential_created`.
- Sem chave: tela `/app/ai/credentials` mostra "Nenhuma credencial"; agente genérico falha com `LlmNotConfiguredError`; handoff por orçamento não dispara (não há gasto).
- Custo/tokens por conversa: `llm_calls` tem `contact_id` (FK) mas agregação `fn_uso_de_ia` **não agrupa por contato**. Tela "Uso e orçamento" mostra totais diários, por agente, por purpose — **não por atendimento**.
- Teto de gasto: `lib/ai/budget/pode-gastar.ts` + `lib/agent-engine/edge/llm/orcamento.ts:decidirOrcamento` — modos `off`/`warn`/`block`; ao estourar no modo `block`, `aplicarOrcamento` lança `LlmBudgetExceededError` → `comHandoffSeOrcamentoAcabar` faz handoff para humano com aviso fixo ao lead.

### Bloco 4 — Confiabilidade do canal
- **"N número(s) conectado(s)"** conta `list.length` (sessões com provider ≠ SOCIAL), **não filtra `status === 'WORKING'`** (`ConnectionsClient.tsx:388-393`).
- `channel_session.status_changed`: webhook WAHA chama `handleSessionStatus` que atualiza `status` + `last_status_change_at` + `warmup_completed_at` se aplicável, e chama `sincronizarSaudeDaConexao` — **não emite `event_log`**. Nada consome mudança de status para alerta/auditoria.
- `/api/v1/health`: `version` vem de `process.env.APP_VERSION` (injetado no build via `Dockerfile ARG APP_VERSION=dev` + `ENV APP_VERSION=$APP_VERSION`). No compose de produção **não há `build:` com args** — imagem publicada não recebe o arg. Resultado: `"desconhecido"`.

### Bloco 5 — Marca e primeira hora
- **White-label cobre:** nome, logo, accent hex, cor do botão (contraste), e-mail de suporte (`emailDeSuporte`), PDF LGPD (usa `legal_name` da org, não marca).
- **NÃO cobre:** e-mails de acesso (confirmação/recuperação de senha) — estes são templates estáticos no GoTrue, atualizados só por `marca-emails.sh` no install/update. Trocar marca na tela `/admin/marca` **não propaga** para e-mails de acesso.
- **Seed por nicho:** inexistente no core. Extensões declarativas existem (3 pacotes: carrinho-abandonado, primeira-semana, retorno-de-paciente) mas **não cobrem nichos verticais completos** (funil + vocabulário + agente + base + follow-ups).
- **Recursos opcionais escondíveis:** nenhum flag de UI. `lib/navigation/catalogo.ts` entradas têm `minRole`, `sidebar`, `group` mas não `enabled`/`hidden`. Para esconder, precisa remover entrada do catálogo (código). **[CORRIGIDO 2026-10-14: FALSO. Esconder é configuração, não código — `destinos` em `organizations.interface_settings` (empresa) e em `user_organizations.interface_settings` (vínculo), por tela ou SQL. As entradas do catálogo também têm `modulo` e `capacidade`, que escondem por módulo da instalação e por capacidade da organização. Ver a errata no topo e `docs/fork/perfil-enxuto.md`.]**

### Bloco 6 — Estado do fork
- ~~`git rev-list --count main..upstream/main = 460` (fork está **atrasado**).~~ **[CORRIGIDO 2026-10-14: 0 — em dia com o upstream.]**
- ~~`git diff --stat upstream/main...main` → sem saída (fork não tem commits à frente; só está atrás).~~ **[CORRIGIDO 2026-10-14: 7 commits à frente, 4 entregas próprias — `ESTADO-DO-FORK.md` §2.]**
- Branches próprias: `feat/fase-1-1-controle-de-gastos`, `fix/handoff-falso-positivo-atendente` (atual `*`).
- Tags próprias: `v1.0.0` a `v1.80.0` + tags de arquivo (`arquivo/*`, `backup/*`, `deskcomm-baseline`).

### Bloco 7 — Verificações executadas
| Comando | Exit code | Duração | Resultado |
|---------|-----------|---------|-----------|
| `npx pnpm lint` | 0 | ~30s | 0 erros, 532 warnings |
| `NODE_OPTIONS=--max-old-space-size=7168 npx pnpm typecheck` | 0 | ~45s | Passa |
| `npx pnpm test:unit` | N/A | >10 min (timeout) | 1391 arquivos; amostragem passa; suíte completa não concluída no tempo |
| `npx pnpm test:shell` | 0 | ~15s | Todos passam |

---

## Conclusão

**Itens que BLOQUEIAM a venda hoje (precisam de resolução ANTES de ofertar instalação de referência):**

1. ~~**Fork 460 commits atrás** — merge upstream obrigatório.~~ **[FEITO em 2026-10-14.]**
2. **Sem modo shadow/dry-run** — primeira conexão expõe contatos reais ao agente sem validação humana.
3. **Seed por nicho inexistente** — cliente novo recebe CRM vazio; onboarding manual leva horas.
4. **Agente responde sem warm-up gate** — pacing conservador existe mas não é gate de "pode atender".

**Itens de RISCO OPERACIONAL (devem ser resolvidos na 1ª sprint pós-venda):**

5. Contagem de conectados não filtra WORKING.
6. `status_changed` sem consumidor event_log.
7. Custo por atendimento não existe.
8. E-mails de acesso não seguem marca da tela.
9. Testes unitários lentos (paralelizar ou separar suíte crítica).

**Cosméticos (podem esperar):**

10. Healthcheck version = "desconhecido".
11. ~~Recursos opcionais sem flag de UI.~~ **[CORRIGIDO 2026-10-14: nunca foi verdade — `interface_settings` já fazia isso por tela. Ver a errata no topo.]**
12. Lint warnings (532).