# Estado deste fork

`Ronald-silva/RonalDigital-SOC-AI`, fork de
[`melgarafael/DeskcommCRM`](https://github.com/melgarafael/DeskcommCRM).

> **Este arquivo descreve só o que é DESTE fork.** O produto, a doutrina e os
> 258 documentos de `docs/` são do upstream e não são mantidos aqui — quando
> esta página e o upstream discordarem sobre o produto, vale o upstream
> (`CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/index.md`).
>
> **Afirmação de estado tem prazo.** Onde dá, abaixo há o **comando** em vez do
> número: o comando não envelhece. Antes de agir sobre qualquer linha sem
> comando ao lado, remeça. É a mesma regra do aviso de
> [`docs/current-state.md`](docs/current-state.md), que é um retrato datado **de
> propósito** e não deve ser "atualizado".

---

## 1. Posição em relação ao upstream

```bash
git fetch upstream
git rev-list --count main..upstream/main   # quanto falta trazer
git rev-list --count upstream/main..main   # o que é só nosso
git log --oneline upstream/main..main      # e quais commits são
```

Antes de qualquer trabalho, a regra de higiene de branches do `CLAUDE.md` vale
inteira: `git fetch origin && git merge origin/main`, nunca `reset --hard`.

Remotos:

| remoto     | aponta para                        | papel                   |
| ---------- | ---------------------------------- | ----------------------- |
| `origin`   | `Ronald-silva/RonalDigital-SOC-AI` | onde este trabalho vive |
| `upstream` | `melgarafael/DeskcommCRM`          | de onde vem o produto   |

## 2. O que este fork tem a mais

Quatro entregas, nenhuma delas no upstream:

| data       | commit     | entrega                                                                                                                                  | fragmento em `.changes/`                                             |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2026-10-08 | `2122106b` | prévia do agente fora da janela de envio (`lib/agent-engine/agent/preview.ts`)                                                           | **não**                                                              |
| 2026-10-11 | `d692152e` | handoff não transfere de novo quem já falou com o atendente (`lib/agent-engine/agent/human-handoff.ts`, `lib/escalacao/continuidade.ts`) | sim, 2                                                               |
| 2026-10-13 | `d640d211` | preço do `deepseek-v4-pro` no mapa do agent-engine (`lib/agent-engine/edge/llm/pricing.ts`)                                              | **não**                                                              |
| 2026-10-14 | `6f576c9d` | perfil enxuto de menu por organização (`scripts/perfil-enxuto.sh`)                                                                       | sim — ver [`docs/fork/perfil-enxuto.md`](docs/fork/perfil-enxuto.md) |

Para remedir a lista e os arquivos tocados:

```bash
git log --oneline --no-merges upstream/main..main
git diff --stat upstream/main...main
```

**Dívida declarada:** duas das quatro entregas não trazem fragmento de release
(DoD 17). Nenhuma das duas muda comportamento visível a quem opera uma VPS
— a prévia é tela de teste do agente, e o preço só alimenta o cálculo de custo
—, mas quem for levá-las ao upstream precisa escrever o fragmento no PR.

## 3. Documentos deste fork

| arquivo                                                                | assunto                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/fork/perfil-enxuto.md`](docs/fork/perfil-enxuto.md)             | o script de menu enxuto: o que grava, o que não esconde, limitação do `DB_CONTAINER`, como desfazer                                                                     |
| [`docs/fork/implantacao-cliente.md`](docs/fork/implantacao-cliente.md) | checklist de 10 itens para implantar um cliente novo, com estado medido, não medido e pendências explícitas                                                             |
| [`RELATORIO-AUDITORIA-OPENCODE.md`](RELATORIO-AUDITORIA-OPENCODE.md)   | auditoria de 2026-10-13 — o que bloqueia vender uma instalação de referência. **Retrato datado**; dois itens dela já foram corrigidos (ver a errata no topo do arquivo) |
| [`docs/fork/base-de-conhecimento-chatgpt.md`](docs/fork/base-de-conhecimento-chatgpt.md) | resumo autocontido do produto, da implantação e dos limites conhecidos, escrito para ser carregado numa base de conhecimento externa — sem identificadores nem valores sensíveis |

## 4. Achados medidos em 2026-10-14 que vale guardar

Nenhum destes é defeito **deste** fork — são comportamentos do produto,
medidos no código, que mudam decisões de implantação. Cada linha tem a
evidência para reconferir.

### Menu e navegação

| achado                                                                                                                                                      | evidência                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| O menu É configurável por organização e por vínculo, sem código: `organizations.interface_settings ∩ user_organizations.interface_settings`, depois o papel | `lib/navigation/interface.ts:206`; aplicado em `lib/auth/server.ts:258`; migration 0367                                     |
| Hubs e ⌘K **respeitam** a escolha; o link do hub em si e a tela de fim do onboarding **não**                                                                | `lib/navigation/registry.ts:144`/`:174` vs. `lib/navigation/catalogo.ts:89-100` e `lib/onboarding/o-que-mais-existe.ts:159` |
| Não existe preset por nicho que aplique menu + configurações juntos                                                                                         | o que existe: `lib/onboarding/pacotes-de-funil.ts` (etapas do funil) e `lib/followup/modelos/`                              |

### Pausa da IA quando alguém responde pelo celular

| achado                                                                                                                                                        | evidência                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Quem grava o silêncio é `pausarIaPorAtendimentoManual`; o motivo gravado distingue celular de painel                                                          | `lib/escalacao/atendimento-manual.ts:207`, motivo em `:169`; disparo em `lib/waha/ingest.ts:1554`                 |
| O prazo é **por empresa** (`settings.routing.manual_reply_silence_minutes`, 5 a 1440 min, padrão 60), editável em Configurações › Distribuição de atendimento | leitor em `lib/escalacao/atendimento-manual.ts:126-133`; tela em `app/app/settings/atendimento/_form.tsx:319-338` |
| **Não há como desligar** a pausa: o mínimo é 5 min                                                                                                            | `lib/schemas/routing.ts:59-65`                                                                                    |
| O painel do CRM usa outro mecanismo: janela fixa de 5 min, sem motivo gravado                                                                                 | `app/api/v1/messages/_handler.ts:414`, `:420-425`, `:1356-1359`                                                   |
| ⚠️ Com silêncio finito, a tela diz **"Automático volta em instantes"** mesmo numa pausa de até 24 h, e não nomeia o celular como causa                        | ramo em `lib/inbox/comando-da-conversa.ts:283-289`; rótulos em `:316-323`                                         |

### Latência e custo da IA (medido sobre `deepseek-v4-pro`)

| achado                                                                                                                                                                                                           | evidência                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| O raciocínio da DeepSeek nasce **ligado** e o token de raciocínio é cobrado como saída. O knob é `DEEPSEEK_THINKING` (`provider` \| `disabled`), **por processo do worker** — não por agente nem por organização | `lib/agent-engine/env.ts:175`; injeção em `lib/agent-engine/edge/llm/providers.ts:167-193`, só na fábrica da DeepSeek (`:383-387`)  |
| O knob **não** está em `.env.example` nem em `lib/env.ts` — um operador de VPS não tem como descobri-lo                                                                                                          | `grep -c DEEPSEEK .env.example` → 0                                                                                                 |
| O teto de saída padrão é 4096, com override só por organização (`settings.llm.params.maxOutputTokens`); `checkpoint` e `operator_turn` não passam teto próprio                                                   | `lib/agent-engine/edge/llm/run-model-call.ts:212`, `:214-217`, `:958`                                                               |
| Corte por teto **não é detectado**: o motor nunca lê `finishReason` e `llm_calls` não tem coluna para ele. Ele aparece como "JSON do fechamento recusado" e custa uma re-execução do turno inteiro               | `fecharOTurno` em `lib/agent-engine/agent/abertura/checkpoint.ts:239-260`, racional em `:224-238`                                   |
| Binding por ponto (`ai_purpose_bindings`) vence para `checkpoint`, `jailbreak_detect`, `promise_semantic` e `stage_classifier`; **não** vence para `operator_turn` (manda a versão publicada do agente)          | `lib/ai/pontos/resolver.ts:194-198` e `:460-475`                                                                                    |
| O tier econômico automático não ajuda em DeepSeek: ele só age em provedor de catálogo curado, e o da DeepSeek é sincronizável                                                                                    | `lib/ai/pontos/resolver.ts:269-272`, `:281-283`; `lib/ai/pontos/provedores.ts:127-132`                                              |
| Turnos do mesmo **contato** são serializados: um job `running` do contato bloqueia o claim dos outros. O checkpoint roda dentro do mesmo job, e o `operator_turn` entra na mesma fila                            | `CLAIM_SQL` em `lib/agent-engine/queue/queue.ts` (`distinct on (coalesce(j.contact_id, j.id))` + `not exists … status = 'running'`) |

### Configuração aplicada na instalação de referência

Estado medido em 2026-10-14, sem copiar identificadores nem valores sensíveis
da instalação:

| área                        | configuração aplicada                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Equipe › Atendimento        | jornada de atendimento configurada                                                                                                              |
| Configurações › Atendimento | silêncio da IA depois de resposta pelo celular em **15 min**                                                                                    |
| processo do worker          | `DEEPSEEK_THINKING=disabled` no `.env.local`; é knob por processo, não por agente nem por organização, e continua sem entrada no `.env.example` |
| tipo de agendamento         | local configurado como **Link de vídeo**                                                                                                        |
| Uso de IA › Orçamento       | teto mensal **US$ 50,00**, aviso em **80%**, modo **"Parar a IA ao chegar no limite"**, carência de 72 h (ver seção 5)                          |
| `settings.llm` da org       | `default_model` e `enabled_models` fixados no modelo que o motor sabe custear (ver seção 5)                                                     |
| processo do worker          | `FLYWHEEL_INTERVAL_MS=0` no `.env.local` — desliga o laço periódico do flywheel, nada mais                                                      |

O knob deixou de ser apenas hipótese neste fork. A forma aplicada foi:

```
DEEPSEEK_THINKING=disabled
```

Nenhum valor do `.env.local` foi versionado. O nome do knob é público porque o
contrato está em `lib/agent-engine/env.ts:175`; o arquivo local continua fora do
repositório, e o knob não foi promovido ao contrato do instalador.

### Resultado medido do knob

Comparação dos `llm_calls` de `purpose = 'agent_turn'` antes e depois de
desligar o raciocínio do provedor:

| medida                    |                antes |               depois |
| ------------------------- | -------------------: | -------------------: |
| latência por `agent_turn` |         **29–157 s** |            **6–8 s** |
| tokens de saída           | cerca de **4,4 mil** | **algumas centenas** |

É uma medição da instalação de referência, não benchmark geral nem promessa de
SLA para outro modelo, carga ou prompt.

### Custo e teto

- Depois do commit `d640d211` incluir o preço do `deepseek-v4-pro` no mapa do
  agent-engine, `cost_cents` passou a ser gravado nas chamadas medidas desse
  modelo; antes, o custo não era calculado por esse mapa.
- Na mesma conferência, o contador usado pelo teto de gasto bateu com a soma de
  `llm_calls.cost_cents`. A afirmação vale para a janela conferida; não é uma
  auditoria histórica de todas as chamadas.

### Pendências abertas da implantação

1. Provar o push HTTP de ponta a ponta.
2. Provar entrada e tratamento de imagem e áudio.
3. Configurar e provar o embedding da base de conhecimento.
4. Ajustar `scripts/perfil-enxuto.sh` para uso em VPS; hoje o padrão do script
   ainda aponta para o contêiner do ambiente local. **Segundo defeito medido em
   2026-10-18:** nem `BASE` nem `SETUP` do script incluem `/app/ai/usage`, então
   a organização que recebe o perfil perde a porta da tela de orçamento — ela
   desaparece do menu, do hub e do ⌘K, e só se chega digitando a URL (ver
   seção 5).

## 5. Proteção financeira da IA (P0-2) — 2026-10-17 e 2026-10-18

Trabalho de configuração e medição, **sem uma linha de código**: o que mudou
foram duas linhas de banco e um knob de `.env.local`. Nada entra na tabela de
entregas da seção 2, e nada foi para o upstream.

### O que estava errado

| achado                                                                                                                                     | como foi medido                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Nenhuma das 14 organizações tinha teto aplicado — todas em `enforcement_mode` `off` ou `avisar`                                             | `select enforcement_mode, count(*) from ai_budgets group by 1`                          |
| A tela de orçamento existia e era inalcançável por clique: a lista `destinos` de `organizations.interface_settings` não inclui `/app/ai/usage` | projeção real de `destinosDaInterface`/`sidebarGroups`/`hubSections`/`searchable`      |
| `settings.llm.default_model` era `deepseek-flash`, o único modelo em uso **sem tarifa** no mapa do motor                                    | `precoDoModelo('deepseek-flash')` → `undefined`                                        |
| O flywheel era o único consumidor desse padrão e gravava `cost_cents` nulo                                                                  | `llm_calls` com `origem_da_escolha = 'padrao_da_organizacao'`                            |
| O classificador de clima **também** cai no padrão da organização                                                                            | `resolverModeloDoPonto('sentiment_classify', …, { naFaltaUsarOPadraoDaOrganizacao: true })` |

### O que foi aplicado

| alteração                                                                                 | onde                                     | reversão                                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| `enforcement_mode` `off → avisar → bloquear` pela escada oficial da tela, carência de 72 h | `ai_budgets` da org de referência        | marcar "Só acompanhar" e salvar             |
| `default_model` e `enabled_models` fixados em `deepseek-v4-pro`                           | `organizations.settings.llm`, uma org só | restaurar o jsonb anterior                  |
| `FLYWHEEL_INTERVAL_MS=0`                                                                  | `.env.local`, worker recriado sem rebuild | remover a linha e recriar o worker          |

A escada é validada no servidor: `off → bloquear` num único salvamento é 422
`invalid_state_transition`. Armar grava `enforcement_effective_at = now() + 72 h`
salvo `confirmar_imediato`. Quem arma deixa `ai.budget_enforcement_armed` em
`api_audit_log`, com ator e antes/depois.

### O que ficou provado

| propriedade                                                             | prova                                                                                     |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| O teto é avaliado **antes** de sair byte ao provedor                     | gate em `run-model-call.ts:858`, `generateText` em `:871`                                 |
| BYOK (chave da própria organização) respeita o teto **da organização**   | caso novo escrito nesta sessão: chave própria com teto estourado é bloqueada, zero token  |
| Organizações têm orçamentos independentes                                | caso novo: A estourada bloqueia, B no mesmo processo segue; todo statement filtra por `$1` |
| Bloqueio não vira silêncio para o cliente                               | 31 casos existentes: aviso ao lead + fila humana + item na Central                        |
| A carência é respeitada e o bloqueio é alcançável                        | `decidirOrcamento` executada com o estado real em 7 cenários                              |
| `enabled_models` não alcança o clima nem o embedding                     | o clima não usa o seam; o embedding é isento por contrato (`embed.ts`)                    |
| `FLYWHEEL_INTERVAL_MS` desliga **só** o flywheel                         | a variável é lida em 2 pontos, ambos do mesmo laço; os outros 7 laços não a referenciam    |

Suíte relacionada: 231 casos, exit 0.

### Limitações que esta frente mediu e NÃO resolveu

Nenhuma bloqueia a operação com um único modelo permitido, flywheel desligado,
nenhum token MCP ativo e nenhum campo personalizado — que é o estado atual.

1. **O mapa de preços do motor cobre uma fração do catálogo.** Dos modelos que
   `ai_models` oferece na tela, a maioria não resolve tarifa em
   `lib/agent-engine/edge/llm/pricing.ts`, e o gasto deles sai `cost_cents` nulo
   — o teto não os vê. Para remedir:
   `python3` comparando as chaves de `USD_PER_MTOK` com `select model from ai_pricing`.
2. **`cost_budget_cents` e `token_budget` não são lidos pelo motor vivo.**
   `lib/agent-engine/agent/agent-config.ts` mapeia só `max_steps`; os dois tetos
   por execução só são impostos em `lib/ai/runtime/agent.ts` (runtime legado), e
   lá o teste é **posterior** à chamada. O único limite que a prévia respeita é
   `max_steps`, que não é limite de dinheiro.
3. **Não há limite de concorrência comprovado nas rotas HTTP de IA.**
   `QUEUE_MAX_CONCURRENCY` (default 8) é cap **global** da fila; rota HTTP que
   chama modelo não passa por ele.
4. **O gate lê o gasto, não o reserva.** Chamadas simultâneas leem o mesmo
   snapshot; medido: 10 chamadas logo abaixo do teto passam todas.
5. **Mapa do motor e `ai_pricing` discordam** em `deepseek-v4-pro` (132/396
   contra 44/87 cents por Mtok). O motor cobra mais alto — o teto dispara antes
   do gasto real, mas a tela de Uso mostra acima da fatura do provedor.
6. **O caminho de voz (`workers/voice-agent/`) não tem gate de orçamento.** Não
   está implantado nesta instalação, então a exposição hoje é zero.

### Trabalho vizinho em curso, não commitado

O ajuste de Sentry (P0-3) está no diretório de trabalho e **não** foi commitado:
`instrumentation-client.ts`, `sentry.edge.config.ts`, `sentry.server.config.ts`
e `workers/agent-worker/main.ts`. A imagem `deskcomm-worker:local` em execução
já o contém. **Não rode `docker compose up --build`** enquanto isso estiver
assim: assaria alterações não commitadas na imagem.

## 6. O que NÃO foi medido

- `inbound_debounce_ms` e `settings.llm.params` da organização em produção.
- Benchmark com amostra maior, outros modelos, outros prompts ou concorrência;
  os intervalos acima são só os turnos efetivamente comparados.
- O recorte equivalente de `checkpoint`, `promise_semantic`,
  `jailbreak_detect` e `operator_turn`; a comparação registrada acima é apenas
  de `agent_turn`.
- A suíte completa (`pnpm test:unit`) nesta árvore. O que o `CLAUDE.md` exige
  antes de abrir PR continua valendo: a suíte inteira, sem caminho, e o rodapé
  comparado com o `grep FAIL` e com o exit code.
- **`cost_cents` preenchido numa chamada posterior à correção de 2026-10-18.**
  A correção está provada no resolvedor de modelo e no mapa de preços; a coluna
  em si não foi observada porque nenhuma chamada de modelo ocorreu depois dela.
  Fecha-se com o primeiro turno real, ou com uma prévia do agente — que custa
  4 chamadas pagas, não uma (medido: `jailbreak_detect`, `stage_classifier`,
  `promise_semantic` e `agent_preview`).
- **O comportamento do bloqueio com o teto de fato estourado nesta instalação.**
  O gasto do mês está em ~2% do teto; o veredito de bloqueio foi exercitado pela
  função pura e pelos testes, nunca por gasto real.
- **O efeito do novo `default_model` no custo do classificador de clima.** Ele
  deixou de usar `deepseek-flash` e passou a usar `deepseek-v4-pro`, que é mais
  caro por token; o impacto real depende de tráfego que ainda não houve.
