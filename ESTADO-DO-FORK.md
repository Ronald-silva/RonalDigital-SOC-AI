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

| remoto | aponta para | papel |
|---|---|---|
| `origin` | `Ronald-silva/RonalDigital-SOC-AI` | onde este trabalho vive |
| `upstream` | `melgarafael/DeskcommCRM` | de onde vem o produto |

## 2. O que este fork tem a mais

Quatro entregas, nenhuma delas no upstream:

| data | commit | entrega | fragmento em `.changes/` |
|---|---|---|---|
| 2026-10-08 | `2122106b` | prévia do agente fora da janela de envio (`lib/agent-engine/agent/preview.ts`) | **não** |
| 2026-10-11 | `d692152e` | handoff não transfere de novo quem já falou com o atendente (`lib/agent-engine/agent/human-handoff.ts`, `lib/escalacao/continuidade.ts`) | sim, 2 |
| 2026-10-13 | `d640d211` | preço do `deepseek-v4-pro` no mapa do agent-engine (`lib/agent-engine/edge/llm/pricing.ts`) | **não** |
| 2026-10-14 | `6f576c9d` | perfil enxuto de menu por organização (`scripts/perfil-enxuto.sh`) | sim — ver [`docs/fork/perfil-enxuto.md`](docs/fork/perfil-enxuto.md) |

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

| arquivo | assunto |
|---|---|
| [`docs/fork/perfil-enxuto.md`](docs/fork/perfil-enxuto.md) | o script de menu enxuto: o que grava, o que não esconde, limitação do `DB_CONTAINER`, como desfazer |
| [`RELATORIO-AUDITORIA-OPENCODE.md`](RELATORIO-AUDITORIA-OPENCODE.md) | auditoria de 2026-10-13 — o que bloqueia vender uma instalação de referência. **Retrato datado**; dois itens dela já foram corrigidos (ver a errata no topo do arquivo) |

## 4. Achados medidos em 2026-10-14 que vale guardar

Nenhum destes é defeito **deste** fork — são comportamentos do produto,
medidos no código, que mudam decisões de implantação. Cada linha tem a
evidência para reconferir.

### Menu e navegação

| achado | evidência |
|---|---|
| O menu É configurável por organização e por vínculo, sem código: `organizations.interface_settings ∩ user_organizations.interface_settings`, depois o papel | `lib/navigation/interface.ts:206`; aplicado em `lib/auth/server.ts:258`; migration 0367 |
| Hubs e ⌘K **respeitam** a escolha; o link do hub em si e a tela de fim do onboarding **não** | `lib/navigation/registry.ts:144`/`:174` vs. `lib/navigation/catalogo.ts:89-100` e `lib/onboarding/o-que-mais-existe.ts:159` |
| Não existe preset por nicho que aplique menu + configurações juntos | o que existe: `lib/onboarding/pacotes-de-funil.ts` (etapas do funil) e `lib/followup/modelos/` |

### Pausa da IA quando alguém responde pelo celular

| achado | evidência |
|---|---|
| Quem grava o silêncio é `pausarIaPorAtendimentoManual`; o motivo gravado distingue celular de painel | `lib/escalacao/atendimento-manual.ts:207`, motivo em `:169`; disparo em `lib/waha/ingest.ts:1554` |
| O prazo é **por empresa** (`settings.routing.manual_reply_silence_minutes`, 5 a 1440 min, padrão 60), editável em Configurações › Distribuição de atendimento | leitor em `lib/escalacao/atendimento-manual.ts:126-133`; tela em `app/app/settings/atendimento/_form.tsx:319-338` |
| **Não há como desligar** a pausa: o mínimo é 5 min | `lib/schemas/routing.ts:59-65` |
| O painel do CRM usa outro mecanismo: janela fixa de 5 min, sem motivo gravado | `app/api/v1/messages/_handler.ts:414`, `:420-425`, `:1356-1359` |
| ⚠️ Com silêncio finito, a tela diz **"Automático volta em instantes"** mesmo numa pausa de até 24 h, e não nomeia o celular como causa | ramo em `lib/inbox/comando-da-conversa.ts:283-289`; rótulos em `:316-323` |

### Latência e custo da IA (medido sobre `deepseek-v4-pro`)

| achado | evidência |
|---|---|
| O raciocínio da DeepSeek nasce **ligado** e o token de raciocínio é cobrado como saída. O knob é `DEEPSEEK_THINKING` (`provider` \| `disabled`), **por processo do worker** — não por agente nem por organização | `lib/agent-engine/env.ts:175`; injeção em `lib/agent-engine/edge/llm/providers.ts:167-193`, só na fábrica da DeepSeek (`:383-387`) |
| O knob **não** está em `.env.example` nem em `lib/env.ts` — um operador de VPS não tem como descobri-lo | `grep -c DEEPSEEK .env.example` → 0 |
| O teto de saída padrão é 4096, com override só por organização (`settings.llm.params.maxOutputTokens`); `checkpoint` e `operator_turn` não passam teto próprio | `lib/agent-engine/edge/llm/run-model-call.ts:212`, `:214-217`, `:958` |
| Corte por teto **não é detectado**: o motor nunca lê `finishReason` e `llm_calls` não tem coluna para ele. Ele aparece como "JSON do fechamento recusado" e custa uma re-execução do turno inteiro | `fecharOTurno` em `lib/agent-engine/agent/abertura/checkpoint.ts:239-260`, racional em `:224-238` |
| Binding por ponto (`ai_purpose_bindings`) vence para `checkpoint`, `jailbreak_detect`, `promise_semantic` e `stage_classifier`; **não** vence para `operator_turn` (manda a versão publicada do agente) | `lib/ai/pontos/resolver.ts:194-198` e `:460-475` |
| O tier econômico automático não ajuda em DeepSeek: ele só age em provedor de catálogo curado, e o da DeepSeek é sincronizável | `lib/ai/pontos/resolver.ts:269-272`, `:281-283`; `lib/ai/pontos/provedores.ts:127-132` |
| Turnos do mesmo **contato** são serializados: um job `running` do contato bloqueia o claim dos outros. O checkpoint roda dentro do mesmo job, e o `operator_turn` entra na mesma fila | `CLAIM_SQL` em `lib/agent-engine/queue/queue.ts` (`distinct on (coalesce(j.contact_id, j.id))` + `not exists … status = 'running'`) |

**Menor mudança para reduzir a latência que o cliente sente**, se um dia for
decidida (não aplicada):

```
DEEPSEEK_THINKING=disabled      # no .env da VPS
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d worker
```

Knob declarado (`lib/agent-engine/env.ts:175`), chega ao worker por
`env_file: .env` (`docker-compose.prod.yml:128`), não toca arquivo versionado e
é reversível apagando a linha.

## 5. O que NÃO foi medido

- `inbound_debounce_ms` e `settings.llm.params` da organização em produção.
- O recorte de `llm_calls` por `purpose` com `latency_ms`/`output_tokens`, que
  diria quanto de cada turno é `agent_turn`, `checkpoint`, `promise_semantic`,
  `jailbreak_detect` e `operator_turn`:

  ```sql
  select purpose, count(*), round(avg(latency_ms)) ms_medio, round(avg(output_tokens)) saida_media
    from llm_calls where created_at > now() - interval '7 days'
   group by 1 order by 3 desc;
  ```
- A suíte completa (`pnpm test:unit`) nesta árvore. O que o `CLAUDE.md` exige
  antes de abrir PR continua valendo: a suíte inteira, sem caminho, e o rodapé
  comparado com o `grep FAIL` e com o exit code.
