/**
 * A VOLTA: o que a pessoa fez, num formato que o agente consegue ler.
 *
 * `buildHandoffSummary` (lib/agent-engine/agent/human-handoff.ts) já resolve a ida
 * — quando a IA para, o humano recebe um resumo em vez da conversa crua. A volta
 * não existia: o agente abria o chamado e ficava cego. Reassumir sem saber o que
 * foi decidido não é continuidade, é o cliente repetindo tudo para a máquina
 * depois de já ter combinado com uma pessoa.
 *
 * Este módulo LÊ (nunca escreve) as três superfícies onde o humano deixa rastro:
 *   - `agent_case_events` — a decisão explícita (resolveu / pediu algo ao cliente
 *     / escalou), com o texto que a pessoa escreveu;
 *   - `conversation_notes` — a nota interna, que nunca vai ao cliente;
 *   - `agent_cases` — o estado de cada chamado.
 *
 * E devolve DUAS coisas de propósito diferentes: os campos estruturados (para
 * quem for programar em cima) e `resumo`, um texto em português corrido — é o
 * `resumo` que entra no ritual de abertura do turno, porque é lá que o modelo lê.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { textoLegivelDeMencao } from "@/lib/notifications/mentions";

/** O que a pessoa decidiu num chamado, na linguagem de quem vai ler. */
export interface DecisaoHumana {
  chamadoId: string;
  chamadoTitulo: string;
  /** `resolved` | `need_lead_info` | `escalate` — a ação registrada pela pessoa. */
  acao: string;
  /** O texto que a pessoa escreveu ao decidir. */
  texto: string;
  quando: string;
}

export interface NotaInterna {
  autor: string | null;
  texto: string;
  quando: string;
}

/**
 * O que a pessoa disse AO CLIENTE pelo canal, durante esta passagem.
 *
 * É a quarta superfície, e a que faltava. As três primeiras (`agent_case_events`,
 * `conversation_notes`, `agent_cases`) só existem quando quem atende abre chamado ou
 * escreve nota interna — e a operação comum não faz nenhum dos dois: a pessoa assume a
 * conversa no Inbox e simplesmente responde. Medido na conversa `cb141462` em
 * 11/10/2026: 0 chamados, 0 notas, 1 mensagem humana ENTREGUE — e a devolução ao
 * automático auditou `houve_atendimento_humano: false`, pulou o checkpoint de retomada
 * e deixou o agente cego para o que a pessoa já tinha combinado. O cliente então
 * perguntou "você lembra o que ficou pendente?" e a IA não tinha como lembrar.
 *
 * Não resolve nome de autor de propósito: `messages` guarda `sent_by_user_id`, e trocar
 * id por nome pediria uma junção a mais para enfeitar uma frase. O que importa para a
 * continuidade é O QUE foi dito ao cliente, não quem digitou — o id fica aqui para quem
 * for programar em cima.
 */
export interface FalaAoCliente {
  /** `messages.sent_by_user_id` — quem enviou, sem resolver o nome. */
  autorUserId: string | null;
  texto: string;
  quando: string;
}

export interface ChamadoResumido {
  id: string;
  titulo: string;
  estado: string;
  abertoEm: string;
  fechadoEm: string | null;
}

export interface ContinuidadeHumana {
  /** false = nenhuma pessoa mexeu nesta conversa; não há o que retomar. */
  houveAtendimentoHumano: boolean;
  decisoes: DecisaoHumana[];
  notas: NotaInterna[];
  /** O que a pessoa disse ao cliente DENTRO desta passagem — ver `FalaAoCliente`. */
  falasAoCliente: FalaAoCliente[];
  chamados: ChamadoResumido[];
  /**
   * O que ficou PENDENTE com o cliente — só existe quando a pessoa pediu algo a
   * ele (`need_lead_info`). Vira a próxima ação do agente ao retomar; nos outros
   * casos fica null em vez de adivinhar, porque próxima ação inventada faz o
   * agente cobrar o cliente por algo que ninguém combinou.
   */
  pendenciaComOCliente: string | null;
  /** O texto que o agente lê. Vazio quando não houve atendimento humano. */
  resumo: string;
}

/** Teto por superfície: o resumo entra num prompt, e prompt tem orçamento. */
const LIMITE_POR_SUPERFICIE = 10;

const ACAO_LEGIVEL: Record<string, string> = {
  resolved: "resolveu",
  need_lead_info: "pediu uma informação ao cliente",
  escalate: "escalou para outra pessoa",
};

export const CONTINUIDADE_VAZIA: ContinuidadeHumana = {
  houveAtendimentoHumano: false,
  decisoes: [],
  notas: [],
  falasAoCliente: [],
  chamados: [],
  pendenciaComOCliente: null,
  resumo: "",
};

interface CaseRow {
  id: string;
  title: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
}

interface CaseEventRow {
  case_id: string;
  human_action: string | null;
  body: string | null;
  created_at: string;
}

interface NoteRow {
  body: string;
  created_by_name: string | null;
  created_at: string;
}

interface MensagemHumanaRow {
  body: string | null;
  sent_by_user_id: string | null;
  created_at: string;
}

/**
 * Os `messages.status` que provam que a mensagem SAIU para o cliente.
 *
 * `failed` fica FORA, e esta é a linha mais importante desta leitura. Na mesma conversa
 * `cb141462` havia uma mensagem humana `failed` com `error_message = 'fetch failed'`,
 * que nunca chegou ao WhatsApp (nenhum `POST /api/sendText` no provedor naquele minuto,
 * e `external_id` vazio). Contá-la faria a IA retomar afirmando ao cliente que a equipe
 * já lhe respondeu algo que ele nunca viu — pior que o silêncio que este módulo conserta.
 *
 * `queued` e `sending` também ficam fora: são estados em trânsito, e o dono deles é a
 * cadeia de envio. Quando virarem `sent`, a próxima leitura os vê.
 */
const STATUS_QUE_SAIU = ["sent", "delivered", "read"] as const;

/**
 * Teto de caracteres por fala do cliente. As outras superfícies não truncam porque nota
 * interna e decisão de chamado são curtas por natureza; mensagem de WhatsApp vai a 4096
 * caracteres, e dez delas estourariam o orçamento de prompt que `LIMITE_POR_SUPERFICIE`
 * existe para proteger. O corte preserva o começo, que é onde a pessoa diz o que
 * combinou, e marca o corte para o modelo não tratar o trecho como frase inteira.
 */
const TETO_DA_FALA = 400;

/**
 * Lê o rastro humano de UMA conversa.
 *
 * Service role bypassa RLS, então `organization_id` entra explícito em toda
 * query — nunca vem do input do modelo.
 */
export async function lerContinuidadeHumana(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<ContinuidadeHumana> {
  const { data: casesData } = await supabase
    .from("agent_cases")
    .select("id, title, status, opened_at, closed_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("opened_at", { ascending: false })
    .limit(LIMITE_POR_SUPERFICIE);
  const cases = (casesData ?? []) as CaseRow[];
  const tituloPorChamado = new Map(cases.map((c) => [c.id, c.title] as const));

  let eventos: CaseEventRow[] = [];
  if (cases.length > 0) {
    const { data: eventsData } = await supabase
      .from("agent_case_events")
      .select("case_id, human_action, body, created_at")
      .eq("organization_id", organizationId)
      .in(
        "case_id",
        cases.map((c) => c.id),
      )
      .eq("kind", "human_replied")
      .order("created_at", { ascending: true });
    eventos = ((eventsData ?? []) as CaseEventRow[]).slice(-LIMITE_POR_SUPERFICIE);
  }

  const { data: notesData } = await supabase
    .from("conversation_notes")
    .select("body, created_by_name, created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(LIMITE_POR_SUPERFICIE);
  const notas = ((notesData ?? []) as NoteRow[])
    .map((n) => ({ autor: n.created_by_name, texto: textoLegivelDeMencao(n.body), quando: n.created_at }))
    .reverse();

  const falasAoCliente = await lerFalasDaPassagem(supabase, organizationId, conversationId);

  const decisoes: DecisaoHumana[] = eventos.map((e) => ({
    chamadoId: e.case_id,
    chamadoTitulo: tituloPorChamado.get(e.case_id) ?? "chamado",
    acao: e.human_action ?? "respondeu",
    texto: (e.body ?? "").trim(),
    quando: e.created_at,
  }));

  const chamados: ChamadoResumido[] = cases.map((c) => ({
    id: c.id,
    titulo: c.title,
    estado: c.status,
    abertoEm: c.opened_at,
    fechadoEm: c.closed_at,
  }));

  // A pendência é a ÚLTIMA vez que alguém pediu algo ao cliente — pedidos
  // anteriores já foram superados pelo mais recente.
  const ultimoPedido = [...decisoes].reverse().find((d) => d.acao === "need_lead_info");
  const pendenciaComOCliente =
    ultimoPedido && ultimoPedido.texto !== "" ? ultimoPedido.texto : null;

  const houveAtendimentoHumano =
    decisoes.length > 0 || notas.length > 0 || falasAoCliente.length > 0;

  return {
    houveAtendimentoHumano,
    decisoes,
    notas,
    falasAoCliente,
    chamados,
    pendenciaComOCliente,
    resumo: houveAtendimentoHumano
      ? montarResumo({ decisoes, notas, falasAoCliente, pendenciaComOCliente })
      : "",
  };
}

/**
 * As mensagens que a PESSOA mandou ao cliente DENTRO desta passagem.
 *
 * ## A janela, e por que ela é a idempotência
 *
 * O recorte é `created_at >= conversations.last_handoff_at`, e ele não está aqui por
 * economia de linhas lidas — está aqui porque é o que impede duplicação:
 *
 *  - SEM janela, qualquer mensagem humana da história inteira da conversa marcaria
 *    `houveAtendimentoHumano = true` para sempre. Como `gravarCheckpointDeRetomada`
 *    ACRESCENTA ao `rolling_summary` em vez de substituir (e isso é deliberado lá),
 *    toda devolução futura empilharia de novo o mesmo relato.
 *  - COM janela, a idempotência vem do código que já existe: `lerContinuidadeHumana` é
 *    chamada no passo (0) da devolução, ANTES de qualquer escrita, e o passo (2) zera
 *    `last_handoff_at`. Uma segunda devolução — duplo clique, ou a automática correndo
 *    com a manual — lê janela FECHADA, devolve lista vazia e não grava checkpoint
 *    nenhum. Isso importa porque `jaEstavaComOAgente` (`retomada.ts`) é calculado e
 *    NUNCA curto-circuita: não existe guarda de reentrada hoje.
 *
 * `last_handoff_at` nulo ⇒ não há passagem aberta ⇒ lista vazia. Nunca o contrário:
 * cair para "a conversa toda" na ausência da marca é exatamente o caso sem janela.
 */
async function lerFalasDaPassagem(
  supabase: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<FalaAoCliente[]> {
  const { data: convData } = await supabase
    .from("conversations")
    .select("last_handoff_at")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  const desde = (convData as { last_handoff_at: string | null } | null)?.last_handoff_at ?? null;
  if (desde === null) return [];

  const { data } = await supabase
    .from("messages")
    .select("body, sent_by_user_id, created_at")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    // `sent_via` distingue a pessoa da IA na MESMA coluna de saída: a resposta do agente
    // grava `ai` (e `metadata.ai_actor_id`), a da pessoa grava `user` + `sent_by_user_id`.
    .eq("sent_via", "user")
    .in("status", STATUS_QUE_SAIU as unknown as string[])
    .gte("created_at", desde)
    .order("created_at", { ascending: true })
    .limit(LIMITE_POR_SUPERFICIE);

  return ((data ?? []) as MensagemHumanaRow[])
    .map((m) => ({
      autorUserId: m.sent_by_user_id,
      texto: (m.body ?? "").trim(),
      quando: m.created_at,
    }))
    // Mensagem sem corpo é mídia: ela SAIU, mas não há texto a repassar ao modelo, e uma
    // linha vazia no resumo só gastaria prompt. A mídia em si continua na conversa, que é
    // onde o modelo já a lê.
    .filter((f) => f.texto !== "")
    .map((f) => ({
      ...f,
      texto: f.texto.length > TETO_DA_FALA ? `${f.texto.slice(0, TETO_DA_FALA)}…` : f.texto,
    }));
}

/**
 * O texto que entra no prompt. Separado da leitura porque é o que os testes
 * conseguem prender: comparar frase montada é barato, comparar linha de banco é
 * caro — e é a FRASE que decide se o agente cita ou não o que a pessoa fez.
 */
export function montarResumo(input: {
  decisoes: DecisaoHumana[];
  notas: NotaInterna[];
  /** Opcional para não quebrar quem monta o resumo sem as falas (o campo nasceu depois). */
  falasAoCliente?: FalaAoCliente[];
  pendenciaComOCliente: string | null;
}): string {
  const linhas: string[] = [
    "Uma pessoa da equipe assumiu esta conversa e devolveu o atendimento para você.",
    "O que ela fez, e que o cliente já considera combinado:",
  ];

  for (const d of input.decisoes) {
    const acao = ACAO_LEGIVEL[d.acao] ?? d.acao;
    const texto = d.texto === "" ? "sem texto registrado" : d.texto;
    linhas.push(`- No chamado "${d.chamadoTitulo}", ${acao}: ${texto}`);
  }

  for (const n of input.notas) {
    const autor = n.autor ?? "a equipe";
    linhas.push(`- ${autor} anotou internamente: ${n.texto}`);
  }

  // As falas vêm DEPOIS das decisões e notas, e com rótulo próprio: o cliente LEU estas,
  // e não leu as outras duas. Confundir as duas coisas num prompt é o que faz o agente
  // citar nota interna para o cliente.
  for (const f of input.falasAoCliente ?? []) {
    linhas.push(`- a equipe JÁ DISSE ao cliente, por mensagem: ${f.texto}`);
  }

  if (input.pendenciaComOCliente !== null) {
    linhas.push(`Ficou pendente com o cliente: ${input.pendenciaComOCliente}`);
  }

  linhas.push(
    "Retome daqui: não peça de novo o que já foi combinado nem contradiga a decisão da pessoa.",
  );
  return linhas.join("\n");
}
