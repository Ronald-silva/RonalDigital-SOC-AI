# Perfil enxuto de menu, por organização

> Documento deste fork (`Ronald-silva/RonalDigital-SOC-AI`). Descreve
> `scripts/perfil-enxuto.sh`, que não existe no upstream.

Entregar o CRM para um cliente de nicho significava entregar o menu inteiro. O
script grava, de uma vez, a escolha de áreas visíveis de **uma** organização —
a mesma escolha que a tela Configurações › Organização › **Menu lateral** faz
marcando item por item.

```bash
scripts/perfil-enxuto.sh <id_da_organizacao> <montagem|cliente>
```

---

## O que ele grava, e o que isso NÃO é

Ele escreve `organizations.interface_settings` com
`{"preset":"completa","destinos":[…]}`. Isso é **apresentação**, nunca
autorização — está no cabeçalho do módulo que lê o valor
(`lib/navigation/interface.ts:1`: *"Apresentação por vínculo. Nunca é
autorização de página, API ou ação"*).

| o que muda | o que **não** muda |
|---|---|
| menu lateral, hubs ("Ver tudo em…") e busca ⌘K | papel, RLS, permissões |
| o que a pessoa **descobre** sozinha | o que a pessoa **alcança** |
| por organização | por instalação (nada global) |

Link de conversa, aviso da Central e URL digitada continuam abrindo o que o
papel autoriza, mesmo para um destino escondido. Desmarcar uma área **não**
desliga a funcionalidade.

## Como a escolha é resolvida

A leitura é interseção nos dois eixos, e o papel decide depois:

```
organizations.interface_settings  ∩  user_organizations.interface_settings  →  canSee(papel)
```

- `combinarInterfaces` — `lib/navigation/interface.ts:206` (migration 0367)
- aplicado na sessão em `lib/auth/server.ts:258`
- projeções que respeitam o resultado: `sidebarGroups`, `hubSections`,
  `searchable` — `lib/navigation/registry.ts:116`, `:144`, `:174`

A empresa define o universo; cada vínculo escolhe **menos** dentro dele, nunca
mais. Rodar o script depois de alguém ter personalizado o próprio menu não
reabre nada para essa pessoa.

## Portas que o script não consegue esconder

| porta | por quê |
|---|---|
| Perfil, Segurança | pessoais, de todo vínculo |
| Equipe, Organização | é por elas que se desfaz a escolha |

`PORTAS_ESSENCIAIS` — `lib/navigation/interface.ts:39-44`. Sem isso, uma
organização que escondesse Configurações se trancaria do lado de fora, e o
caminho de volta seria só por banco.

## Os dois perfis

| perfil | para quem | destinos no script |
|---|---|---|
| `montagem` | quem está implantando | `cliente` + 6 telas de configuração |
| `cliente` | o cliente final | o uso diário |

O `montagem` acrescenta Tipos de agendamento, Etapas do funil, Credenciais de
IA, Alertas, Aviso no WhatsApp e Notificações. A ordem de uso é
`montagem` → configurar → `cliente`.

Para ver as duas listas sem acreditar nesta página:

```bash
sed -n '/^BASE=/,/^SETUP=/p' scripts/perfil-enxuto.sh
```

### O que cada perfil produz na tela

Medido com o código real (`sidebarGroups` / `searchable`, módulos e capacidades
vazios), em 2026-10-14:

| perfil | papel | itens no menu | hubs | destinos no ⌘K |
|---|---|---|---|---|
| `cliente` | admin | 9 | 4 | 15 |
| `cliente` | manager | 8 | 4 | 11 |
| `cliente` | agent | 6 | 4 | 8 |
| `cliente` | viewer | 5 | 3 | 7 |
| `montagem` | admin | 9 | 4 | 21 |
| `montagem` | manager | 8 | 4 | 16 |
| `montagem` | agent | 6 | 4 | 11 |
| `montagem` | viewer | 5 | 4 | 10 |

Duas leituras que esses números pedem:

- **O ⌘K tem mais que a lista do script** porque as 4 portas essenciais entram
  sempre (para `admin`; 2 para quem não administra).
- **`montagem` acrescenta 6 destinos e o menu não cresce.** As seis telas que
  ele abre são todas de grupo com hub e sem `sidebar: true` — elas aparecem em
  "Ver tudo em IA" e em **Configurações** (rodapé), não na lista lateral. O
  grupo Organização nunca desenha itens no menu: `GRUPO_NO_RODAPE` o reduz ao
  link do hub (`lib/navigation/catalogo.ts:108`).

Para remedir em vez de confiar na tabela:

```bash
npx tsx -e '
import { sidebarGroups, searchable } from "@/lib/navigation/registry";
import { combinarInterfaces } from "@/lib/navigation/interface";
const d = process.argv.slice(1);
const s = combinarInterfaces({ preset: "completa", destinos: d }, null);
for (const r of ["admin","manager","agent","viewer"] as const)
  console.log(r, sidebarGroups(false, r, s, [], []).reduce((a,b)=>a+b.items.length,0),
              searchable(false, r, s, [], []).length);
' /app/inbox /app/agenda   # … os hrefs do perfil
```

## Sobrevive ao `update.sh`?

**Sim.** O valor é dado de linha; o apêndice do `baseline.sql` só **cria** a
coluna e a constraint, nunca escreve nelas — bloco
`-- ---- menu lateral por EMPRESA (migration 0367, issue #1341) ----`, com
`add column if not exists` e `add constraint … if not exists`.

Para conferir que nada no baseline escreve a coluna (o esperado é **vazio**):

```bash
grep -nE "update public\.organizations[^;]*interface_settings" supabase/baseline.sql
```

## ⚠️ O padrão de `DB_CONTAINER` é a pilha LOCAL

```bash
DB="${DB_CONTAINER:-supabase_db_deskcomm-crm}"   # scripts/perfil-enxuto.sh:6
```

`supabase_db_deskcomm-crm` é o contêiner do Supabase **local** de
desenvolvimento (`project_id = "deskcomm-crm"`, `supabase/config.toml:5`).
**Numa VPS esse contêiner não existe**: a instalação normal usa um Supabase
remoto, e o single-server usa os contêineres de `.runtime/supabase/`. Rodar o
script lá, como está, falha no `docker exec` — não grava nada errado, mas
também não grava nada.

Na VPS, o caminho é o `psql` com a connection string (a mesma que o `install.sh`
usa), ou a tela:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -c "
update public.organizations
   set interface_settings = jsonb_build_object('preset','completa','destinos', '[…]'::jsonb)
 where id = '<id_da_organizacao>'
returning id, jsonb_array_length(interface_settings->'destinos');"
```

## Como desfazer

Pela tela (preferido): Configurações › Organização › **Menu lateral** →
"Personalizar áreas visíveis" → marcar o que faltar, ou trocar o perfil de
interface para **Completa**.

Por SQL, voltando ao padrão de quem nunca mexeu em nada:

```sql
update public.organizations
   set interface_settings = '{"preset":"completa"}'::jsonb
 where id = '<id_da_organizacao>';
```

## Dois comportamentos a saber antes de usar em cliente

| comportamento | onde | consequência |
|---|---|---|
| **Falha ABERTA na atualização.** Se uma versão futura renomear ou remover um destino, os ids desconhecidos são descartados; se **todos** caírem, o schema recusa a lista vazia e a leitura volta à interface **completa** | `lib/navigation/interface.ts:94-105` e `:200-204` | o menu pode voltar inteiro depois de um `update.sh`. Confira a tela do cliente depois de atualizar |
| **A tela de fim do onboarding não respeita a escolha.** `oQueMaisExiste()` não recebe papel nem settings e mostra 7 destinos curados (Inbox, Funis, Follow-ups, Radar, Alertas, Aviso no WhatsApp, Propostas da IA) | `lib/onboarding/o-que-mais-existe.ts:159`; consumidor em `app/onboarding/done/page.tsx:39` | vazamento de uma vez só, logo depois do wizard |

## O que o script **não** resolve

| pedido | estado | onde fica |
|---|---|---|
| esconder o link "Ver tudo em CRM/IA/Análise" | não dá por configuração | `NAV_GROUPS` em `lib/navigation/catalogo.ts:89-100`; só por código |
| esconder abas do editor do agente | não dá | as 6 abas são incondicionais, `app/app/ai/agents/[id]/_components/AgentTabs.tsx:59-68` |
| perfil por nicho que aplique funil + agente + menu juntos | não existe | o que existe por nicho: `lib/onboarding/pacotes-de-funil.ts` (só etapas do funil) e `lib/followup/modelos/` |
| renomear itens do menu pelo vocabulário do funil | não alcança o menu | `crm_pipelines.vocabulary` muda rótulos **dentro** do funil (4 chaves: `lead`, `deal`, `won`, `lost` — `lib/schemas/settings.ts:217-224`) |
