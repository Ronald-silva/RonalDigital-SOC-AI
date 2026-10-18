# RonalDigital SOC-AI — base de conhecimento

**Documento de referência sobre o projeto, sua implantação e seus limites.**
Escrito para ser carregado numa base de conhecimento e consultado por um
assistente que **não tem acesso ao código**.

- **Retrato datado:** 2026-10-18. Afirmações de estado envelhecem. Onde este
  documento disser "medido", houve medição na data indicada; onde disser
  "não medido", não houve.
- **Autoridade:** sobre o *produto*, a fonte é o repositório upstream
  (`CLAUDE.md`, `VISION.md`, `docs/`). Sobre a *implantação de referência*, a
  fonte é este documento e `ESTADO-DO-FORK.md`.
- **Não contém** identificadores de organização, chaves, telefones ou qualquer
  valor sensível da instalação.

---

## 1. O que é o projeto

**RonalDigital SOC-AI** é um fork de **DeskcommCRM**, um sistema operacional de
vendas open source com agentes de IA nativos, tendo o **WhatsApp como canal
primário**.

O nome DeskcommCRM vem de *Desk* (mesa) + *comm* (comércio): o comercial de
mesa. "CRM" é a categoria de entrada, não o teto — a proposta é ser o sistema
onde a venda acontece, operado por pessoas **e** por agentes de IA trabalhando
juntos.

**Multi-nicho.** Nasceu para e-commerce brasileiro e a comunidade o levou para
clínicas, infoprodutos, imobiliárias, agências, escritórios de advocacia e
prestadores de serviço — qualquer negócio que vende conversando. E-commerce
segue sendo caso de uso de primeira classe (há integração Nuvemshop), mas é um
vertical, não o produto.

**Modelo de distribuição:** self-host em VPS, não assinatura de SaaS. A
experiência de quem instala numa VPS *é* o produto. Suporta marca própria
(white-label): uma única imagem Docker serve todas as marcas, e a marca vem do
banco, não de variáveis de ambiente.

### As quatro crenças que orientam o produto

1. **Agente que opera, não chatbot que enfeita.** O agente lê contexto real
   (histórico, perfil, pedido), consulta a base de conhecimento da organização
   via RAG, responde, qualifica e move o lead no funil. Ele é *assignee* de
   primeira classe, sujeito às mesmas regras de governança de um atendente
   humano.
2. **Agentes que se auto-aprimoram.** Conversas resolvidas viram conhecimento
   novo; passagens para humano marcam onde o agente não alcança; métricas e
   orçamento por organização fecham o laço — com **gate humano** nas decisões
   que importam.
3. **MCP como sistema nervoso.** O CRM é exposto como ferramentas MCP, primeiro
   para os agentes internos e depois como contrato público.
4. **Humano no comando.** Passagem auditada, escopo por papel, fila com
   posição, orçamento de IA por organização. A autonomia do agente cresce na
   medida em que a governança prova que ele acerta.

---

## 2. Stack técnica

| camada | tecnologia |
| --- | --- |
| Frontend | Next.js 16 App Router (Turbopack), React 19, TypeScript estrito, Tailwind 4 (CSS-first), shadcn/ui |
| Backend | Route Handlers do próprio Next; workers via tabela `event_log` + cron |
| Banco | Supabase (Postgres) com RLS em toda tabela multi-tenant; extensões `uuid-ossp`, `pgcrypto`, `vector` |
| Auth | Supabase Auth via `@supabase/ssr`; cookie `SameSite=Strict`, `HttpOnly`, `Secure` |
| Tempo real | Supabase Realtime |
| Armazenamento | Supabase Storage, bucket privado com URLs assinadas |
| WhatsApp | WAHA Plus, engine NOWEB, imagem pinada por arquitetura |
| Filas | tabela `event_log` + workers (sem Inngest/Trigger) |
| Rate limit | Upstash Redis, janela deslizante |
| IA | Vercel AI Gateway; embeddings por OpenAI ou Google, por escolha da organização |
| Validação | Zod em todo input externo |
| Observabilidade | Sentry com `beforeSend` sanitizado |

Empacotamento: todo serviço de produção declara imagem publicada; publicação é
ato do CI, para linux/amd64 e linux/arm64. Instalação de cliente aponta para
número de versão, nunca para tag móvel.

---

## 3. O que o produto oferece

### Atendimento e canal

- **Inbox em tempo real** de WhatsApp, multi-número, com mídia.
- **Anti-banimento:** throttle de ~1 msg/1,2 s com jitter, campanha a 1 msg/5 s,
  warm-up de 7 a 14 dias, variação de texto, janela de disparo configurável por
  canal (padrão 7h–22h) e janela de resposta própria por canal.
- **Detecção de pedido de parada (opt-out)** em português e espanhol, com regra
  única compartilhada entre a ingestão e o runtime do agente. Só bloqueia
  palavra isolada ou verbo de cessação com objeto de comunicação — "tem como
  parar a dor?" não bloqueia ninguém.
- **Grupos de WhatsApp** entram na inbox somente quando ligados explicitamente;
  grupo nunca entra em funil, lista, campanha ou IA.
- **Multi-device**, com tratamento de mensagens enviadas pelo próprio operador
  sem duplicar.
- **Pausa automática da IA quando um humano responde pelo celular**, com prazo
  configurável por empresa (5 a 1440 minutos, padrão 60). Não há como desligar
  a pausa; o mínimo é 5 minutos.

### Agentes de IA

- **RAG por organização** sobre base de conhecimento própria.
- **Classificação de clima/sentimento** a cada mensagem recebida.
- **Guardrail anti-jailbreak** e camada semântica de promessa.
- **Classificador de estágio** do funil.
- **Passagem IA → humano auditada**, com fila, posição e motivo registrado.
- **IA como assignee** de primeira classe.
- **Prévia do agente (sandbox)** que executa o mesmo pipeline de produção sem
  efeito externo: ferramentas viram propostas, envio é embargado, nada é escrito
  em conversa.
- **Flywheel** (judge → distiller) que avalia turnos reais e propõe melhorias,
  com gate humano.
- **Orçamento de IA por organização** (seção 5).

### CRM e funil

- 5 tabelas núcleo: pipelines, etapas, leads, timeline polimórfica de atividades
  e vínculos polimórficos.
- **Kanban com fractional indexing** (`position_in_stage` numérico), não inteiro.
- **Campos personalizados** declarativos por pipeline, com Zod construído
  dinamicamente.
- **Vocabulário renomeável** por pipeline: lead/deal/won/lost podem virar
  Cliente/Pedido/Pago/Cancelado.
- **Tags** com índice GIN.
- **Automações QUANDO/SE/ENTÃO**, roteamento automático, follow-ups.
- **Customer 360** e métricas por atendente.

### Integrações e extensibilidade

- **MCP:** o CRM exposto como ferramentas para agentes.
- **API REST `/api/v1/`** versionada por caminho, JSON snake_case, UUID v4,
  ISO-8601 UTC, dinheiro em `_cents` + moeda ISO-4217, paginação por cursor
  opaco, `X-Request-Id` em toda resposta, cabeçalhos `X-RateLimit-*`.
- **Autenticação dual:** cookie de sessão para o frontend, bearer `dsk_...` para
  chamada de servidor. É habilitada **rota por rota**, não por chave geral.
- **Integração Nuvemshop.**
- **Extensões declarativas:** pacote que pede capacidade nomeada, sem importar
  código interno nem ler o banco. A instância decide o pacote; a organização
  decide o uso.
- **Agenda** com sincronização Google.

### Governança, segurança e conformidade

- **Multi-tenancy com RLS desde o dia 1.** Toda tabela multi-tenant tem
  `organization_id` e política de isolamento. Handler que usa service role
  precisa filtrar a organização manualmente, resolvida de fonte confiável —
  nunca do corpo da requisição.
- **4 papéis dentro da organização:** viewer < agent < ai_operator < manager <
  admin. Super-admin de plataforma é papel transversal.
- **MFA TOTP opcional**, ligado por quem administra, com duas políticas
  independentes (instalação e organização), papel mínimo configurável e
  carência. O padrão é não exigir — segurança que expulsa o usuário na primeira
  tela não protege ninguém.
- **Audit log append-only** para os papéis do PostgREST: toda mutação bem
  sucedida gera uma entrada. Retenção padrão de 5 anos, configurável, com
  expurgo executado por cron e piso de 90 dias.
- **LGPD nativa:** anonimização preferida a exclusão, cascata de redação
  (contato, conversas, mensagens, mídia no storage, atividades preservando
  timestamps), reversão proibida, SLA de D+7 para pedido de dados e D+15 para
  redação, auditoria obrigatória de cada ação. O PDF de LGPD nomeia o
  controlador e o DPO, nunca a marca do revendedor.
- **Idempotência:** mensagens e eventos externos com chave única por
  organização; POSTs de criação aceitam `Idempotency-Key` com recibo no Postgres.
- **Segredos:** chave de API nunca em query string; bearer mostrado uma única
  vez na criação e guardado como hash SHA-256.

---

## 4. Como o orçamento de IA funciona

Esta é a seção mais recentemente verificada (2026-10-17 e 2026-10-18) e a mais
útil para responder perguntas sobre controle de custo.

### A escada de três degraus

| modo | comportamento |
| --- | --- |
| `off` ("Só acompanhar") | mede o gasto, não avisa, não para |
| `avisar` ("Me avisar") | abre aviso na Central ao cruzar o limiar; nunca para |
| `bloquear` ("Parar a IA") | ao atingir o teto, recusa a chamada e devolve a conversa a um humano |

A escada é validada **no servidor**: o salto `off → bloquear` num único
salvamento é recusado com HTTP 422. A fase de aviso existe para que ninguém
descubra a parada pelo cliente reclamando no WhatsApp.

Armar `bloquear` grava uma **carência de 72 horas** antes de a parada valer.
Quem arma pode renunciar a ela por escolha explícita. Afrouxar (voltar a
`avisar` ou `off`) é sempre livre e imediato, e zera a carência.

### As condições que precisam se juntar para bloquear

Todas elas, simultaneamente:

1. modo `bloquear` na organização;
2. interruptor de emergência da instalação não desligado nem rebaixado;
3. finalidade da chamada fora da lista de isentas (diagnóstico e guardrail nunca
   são recusados por gasto);
4. teto com valor útil — teto zero significa "sem limite" e **segue**;
5. teto acima do piso de US$ 1,00;
6. carência vencida;
7. **já houve aviso neste mês.**

A condição 7 é o que impede "calou sem nunca ter avisado": mesmo num salto de
79% para 101% entre duas chamadas, a primeira que cruza o teto avisa e segue.
Custo máximo dessa garantia: uma chamada além do teto.

### Propriedades verificadas

- **O teto é avaliado antes de sair byte ao provedor.** Bloqueio custa zero
  token.
- **Chave própria da organização (BYOK) respeita o orçamento da organização.**
  Só o teto *do plano* — outro mecanismo — é restrito à chave da instalação.
- **Orçamentos são independentes por organização.**
- **Bloqueio não vira silêncio para o cliente.** A conversa vai para a fila
  humana, o bot é silenciado, os follow-ups são cancelados, o lead é avisado e
  um item crítico abre na Central — tudo sem gastar um token.
- **Toda condição ambígua resolve para "seguir".** Leitura de orçamento que
  falha, organização sem linha, coluna inexistente num clone desatualizado:
  todos seguem. A assimetria é deliberada — errar frouxo custa dinheiro de
  provedor e é visível na tela de Uso; errar duro mata o WhatsApp de um negócio
  numa VPS onde não há para quem ligar.
- **Laço de retorno:** quando o gasto cai abaixo do limiar (virou o mês, ou o
  teto subiu), os avisos se retratam sozinhos.

### Onde fica na interface

**Uso de IA › Orçamento.** O card mostra o gasto do mês em dólar (é a moeda em
que o provedor cobra), e o botão "Editar limite" aparece para quem é admin.

⚠️ **A unidade é dólar, não real.** A coluna de teto é em centavos de dólar. Um
teto cadastrado como 5000 significa **US$ 50,00**, não R$ 50,00.

### Contabilização — e por onde ela falha

O gasto é somado a partir de uma coluna de custo preenchida por chamada. O custo
só é calculado quando o produto conhece a tarifa do modelo, e existem **duas
réguas de preço distintas**:

| régua | onde vive | quem a usa |
| --- | --- | --- |
| mapa em código | `lib/agent-engine/edge/llm/pricing.ts` | o seam do motor (turno do agente e auxiliares) |
| tabela `ai_pricing` | banco, gerada do catálogo | caminho legado (classificador de clima) |

Consequências medidas, e são importantes para não prometer demais:

- **Modelo sem tarifa no mapa do motor grava custo nulo**, e o teto não vê esse
  gasto. A maioria dos modelos que a tela oferece está nessa situação.
- **As duas réguas podem discordar** sobre o mesmo modelo. No modelo em uso na
  implantação de referência, o mapa do motor cobra ~3× o que a tabela cobra. O
  motor cobra mais alto, então o teto dispara antes do gasto real — mas a tela
  de Uso mostra **acima** da fatura do provedor.
- **A mitigação prática** é restringir os modelos habilitados da organização
  (`settings.llm.enabled_models`) aos que o motor sabe custear. A comparação é
  por string exata do identificador do modelo.

### Limites que o orçamento NÃO impõe

- **Não há reserva de gasto, só leitura.** Chamadas simultâneas leem o mesmo
  retrato do gasto; medido: 10 chamadas logo abaixo do teto passam todas. A
  ultrapassagem máxima é (concorrência) × (custo da chamada mais cara).
- **O cap de concorrência da fila é global**, não por organização, e rota HTTP
  que chama modelo não passa por ele.
- **Tetos por execução existem na tabela e não são lidos pelo motor vivo.** As
  colunas de orçamento e de tokens por execução são impostas apenas pelo runtime
  legado, e lá o teste é posterior à chamada. O único teto que o caminho vivo
  respeita é o número máximo de passos do loop de ferramentas — que não é limite
  de dinheiro.
- **O gate roda uma vez por chamada**, antes do envio ao provedor, e não
  reavalia entre passos do loop de ferramentas.
- **O caminho de voz ao vivo não tem gate de orçamento** (registra o gasto, não
  o limita).

---

## 5. Estado da implantação de referência

Medido em 2026-10-18. Ambiente local de homologação com Supabase local, app,
worker, scheduler, WAHA e Redis em contêineres.

| área | estado |
| --- | --- |
| Orçamento de IA | teto **US$ 50,00/mês**, aviso em **80%**, modo **`bloquear`** armado, carência vencendo **2026-10-21 00:39** (horário local) |
| Gasto do mês | ~2% do teto |
| Modelo do agente | `deepseek-v4-pro`, vindo da versão **publicada** do agente |
| Modelos habilitados | restrito a `deepseek-v4-pro` |
| Flywheel | **desligado** (`FLYWHEEL_INTERVAL_MS=0`) |
| Tokens MCP de integração | **nenhum ativo** |
| Campos personalizados | nenhum definido |
| Canal WhatsApp | conectado e operante |
| Raciocínio da DeepSeek | **desligado** por knob de processo do worker |
| Silêncio da IA após resposta pelo celular | 15 minutos |
| Agendamento | local configurado como link de vídeo |

### Resultado medido de desligar o raciocínio da DeepSeek

| medida | antes | depois |
| --- | ---: | ---: |
| latência por turno do agente | 29–157 s | 6–8 s |
| tokens de saída por turno | ~4,4 mil | algumas centenas |

Medição da instalação de referência. **Não** é benchmark geral nem promessa de
SLA para outro modelo, carga ou prompt. O knob é por **processo do worker** — não
por agente nem por organização — e não consta no arquivo de exemplo de variáveis
de ambiente, então um operador de VPS não tem como descobri-lo pela
documentação do instalador.

---

## 6. Histórico de alterações deste fork

### Entregas de código (commitadas)

| data | entrega |
| --- | --- |
| 2026-10-08 | prévia do agente funciona fora da janela de envio |
| 2026-10-11 | passagem a humano não transfere de novo quem já falou com o atendente |
| 2026-10-13 | preço do modelo `deepseek-v4-pro` incluído no mapa do motor |
| 2026-10-14 | perfil enxuto de menu por organização (script de operação) |

Nenhuma dessas foi levada ao upstream. Duas não trazem fragmento de release, o
que é dívida declarada para quem for propô-las.

### Configuração e verificação (2026-10-17 e 2026-10-18)

Trabalho **sem código**: duas linhas de banco e um knob de ambiente.

1. **Orçamento armado** na organização de referência, pela escada oficial da
   interface, com carência de 72 horas e trilha de auditoria (ator, antes e
   depois registrados).
2. **Modelo padrão da organização corrigido.** Era um modelo sem tarifa no mapa
   do motor; todo gasto que caísse nele saía com custo nulo e invisível ao teto.
   Passou a ser o mesmo modelo da versão publicada do agente, que tem tarifa.
3. **Modelos habilitados restritos** a um único modelo, o que fecha a porta para
   seleção de modelo sem tarifa.
4. **Flywheel desligado**, por ser o único consumidor vivo do padrão da
   organização e, portanto, o único produtor ativo de gasto sem preço.
5. **Ajuste de Sentry** em quatro arquivos: está aplicado na imagem em execução
   e **não foi commitado**.

### Defeito de navegação encontrado no caminho

A tela de orçamento existia, funcionava e era **inalcançável por clique**. O
perfil enxuto de menu grava uma lista explícita de destinos por organização, e
essa lista não incluía a tela de orçamento — que então desaparece do menu
lateral, do hub do grupo e da busca por atalho de teclado. Só se chegava
digitando a URL.

Duas lições que generalizam:

- **Ter tela e ser alcançável são coisas diferentes.** A ocultação era de
  apresentação, nunca de autorização — os papéis seguiam decidindo normalmente.
- **A lista de destinos por organização não tem escritor no produto.** Só foi
  gravada por script, em SQL direto, e a interseção com a escolha por pessoa faz
  da escolha da empresa um teto: ajustar a preferência de um usuário não
  recupera uma porta que a empresa removeu.

---

## 7. Limitações conhecidas — o que NÃO prometer

Lista fechada em 2026-10-18. Nenhuma delas impede operar com um único modelo
habilitado, flywheel desligado, sem token MCP ativo e sem campos
personalizados — que é a configuração atual.

1. **Cobertura de preço por modelo.** A maioria dos modelos oferecidos na tela
   não tem tarifa no mapa do motor; escolhê-los torna o teto inoperante para
   aquele gasto.
2. **Tetos por execução não são lidos pelo motor vivo** (só pelo runtime
   legado, e lá só depois do fato).
3. **As duas réguas de preço divergem** para o modelo em uso, fazendo a tela de
   Uso mostrar acima da fatura do provedor.
4. **Caminho de voz sem gate de orçamento** (não implantado nesta instalação).
5. **Sem limite de concorrência comprovado nas rotas HTTP de IA.**
6. **Script de perfil enxuto** aponta para o contêiner do ambiente local por
   padrão e omite a tela de orçamento da lista de destinos.
7. **Corte por teto de tokens não é detectado:** o motor não lê o motivo de
   término da geração, e o sintoma aparece como recusa de JSON no fechamento do
   turno, custando uma re-execução do turno inteiro.
8. **Mensagem de volta ao automático imprecisa:** com silêncio finito a tela diz
   "Automático volta em instantes" mesmo numa pausa de até 24 h, e não nomeia o
   celular como causa.
9. **Não existe preset por nicho** que aplique menu e configurações juntos. O
   que existe são pacotes de etapas de funil e modelos de follow-up.

### Pendências de prova da implantação

1. Push HTTP de ponta a ponta.
2. Entrada e tratamento de imagem e áudio.
3. Embedding da base de conhecimento configurado e provado.
4. Custo por chamada observado na coluna depois da correção de 2026-10-18 — está
   provado no resolvedor de modelo e no mapa de preços, não na coluna, porque
   nenhuma chamada ocorreu depois dela.

---

## 8. Glossário

| termo | significado |
| --- | --- |
| **organização** | o tenant; a empresa cliente dentro da instalação |
| **instalação** | o deploy numa VPS, que pode hospedar várias organizações |
| **WAHA** | gateway de WhatsApp usado como canal; licenciado, referenciado por tag fixa |
| **seam do motor** | a única camada por onde o agente fala com provedor de IA, e onde o teto é aplicado |
| **caminho legado** | o respondedor e o classificador de clima antigos, que não passam pelo seam |
| **passagem / handoff** | devolver a conversa da IA a um atendente humano, com motivo e auditoria |
| **Central** | a caixa de avisos operacionais onde alertas abrem para a equipe |
| **finalidade / purpose** | o rótulo da chamada de IA (turno do agente, guardrail, classificador, fechamento…) |
| **flywheel** | laço periódico que avalia turnos reais e propõe melhorias ao agente |
| **BYOK** | a organização usa chave de provedor de IA própria, em vez da chave da instalação |
| **carência** | janela entre armar a parada por gasto e ela passar a valer (72 h por padrão) |
| **perfil enxuto** | lista reduzida de telas no menu, gravada por organização |
| **marca própria** | white-label; a marca vem do banco, não de variável de ambiente |

---

## 9. Como confirmar qualquer coisa deste documento

O repositório é a fonte da verdade, e o projeto tem uma convenção explícita
sobre isso: **onde a afirmação puder virar comando, vale o comando** — um número
corrigido envelhece de novo, um "rode isto para saber" não envelhece nunca.

Para o produto: `CLAUDE.md` (doutrina), `VISION.md` (posicionamento),
`docs/index.md` (índice), `docs/current-state.md` (retrato datado do que está
pronto, incompleto e quebrado).

Para este fork: `ESTADO-DO-FORK.md` e `docs/fork/`.

Quem for agir sobre qualquer linha deste documento sem um comando ao lado deve
remedir antes.
