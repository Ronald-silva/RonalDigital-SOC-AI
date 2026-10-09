/**
 * O CONTROLE DE GASTOS COMO CONDIÇÃO DE PUBLICAÇÃO — a régua do "Publicar".
 *
 * ─── Os dois buracos que este arquivo fecha ─────────────────────────────────
 *
 * **1. `ai_budgets.enforcement_mode` nasce `'off'`.** É o default certo para a
 * MIGRATION (armar o parque inteiro em silêncio calaria WhatsApp de gente que
 * nunca pediu — ver o resgate B→A da 0159), e é o default errado para um
 * produto que se vende: a instalação nova atende cliente de verdade sem teto
 * nenhum, e `decidirOrcamento` devolve `modo_desligado` no primeiro `if`.
 *
 * **2. `costCents` devolve `null` para modelo fora da tabela de preços.** A
 * honestidade está certa — inventar 0 seria pior —, mas a consequência não é só
 * "custo desconhecido": `fn_gasto_de_ia_do_mes` soma `cost_cents`, e **SUM
 * ignora NULL**. Uma organização rodando modelo sem preço tem gasto
 * perpetuamente zero, nunca cruza o limiar, nunca é avisada e nunca é
 * bloqueada. O teto não fica impreciso: ele para de existir. Já foi medido numa
 * VPS real — 28 chamadas, todas com `cost_cents` nulo, tela mostrando gasto zero
 * (ver o cabeçalho de `lib/agent-engine/edge/llm/pricing.ts`).
 *
 * ─── Onde a exigência VINCULA, e por que não no runtime ─────────────────────
 *
 * Decisão do dono do produto (08/10/2026): **publicar exige, runtime só avisa.**
 *
 * Publicar é ato de uma pessoa, com uma tela na frente e um botão que ela
 * acabou de clicar — é onde uma recusa ENSINA. O runtime é o meio de um
 * atendimento: recusar ali troca "a organização não declarou teto" por "o
 * cliente dela não foi respondido", e o segundo é um estrago maior que o
 * primeiro. Por isso nada aqui é consultado por `run-model-call.ts`: o que ele
 * faz com este mesmo estado é abrir aviso na Central e seguir.
 *
 * Consequência declarada, não disfarçada: **agente já publicado continua
 * atendendo sem teto declarado.** Esta régua só alcança a PRÓXIMA publicação. É
 * o preço de não bloquear ninguém de surpresa, e é o que o aviso da Central
 * existe para cobrir.
 *
 * ─── A ORDEM das recusas, e ela não é arbitrária ────────────────────────────
 *
 * `modelo_sem_preco` vem ANTES de `budget_nao_declarado` porque declarar teto
 * para um modelo sem preço é teatro: o teto existiria na tela e não mediria
 * nada. Pedir o teto primeiro faria a pessoa configurá-lo, publicar, e seguir
 * sem proteção nenhuma achando que estava protegida — que é exatamente o
 * defeito 2 com uma camada de confiança por cima.
 *
 * ─── Por que função pura, separada do I/O ───────────────────────────────────
 *
 * Mesma razão de `bloqueio-de-publicacao.ts`, ao lado: é a regra que decide se
 * o agente entra no ar, e regra dentro de handler não tem teste que não precise
 * de banco. `decidirControleDeGastos` não lê nada; `conferirControleDeGastos`
 * só lê. Os dois caminhos de publicação (a rota e a server action) chamam o
 * segundo — uma régua, nunca duas cópias: o par `tool_ids` logo acima deles já
 * é uma cópia dupla, e é o defeito que não se repete aqui.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  normalizarModoDeOrcamento,
  PISO_DE_TETO_CENTS,
  type ModoDeOrcamento,
} from "@/lib/agent-engine/edge/llm/orcamento";
import { precoDoModelo } from "@/lib/agent-engine/edge/llm/pricing";

/** `ai_agents.operation_mode` — o CHECK do banco aceita só estes dois. */
export type ModoDeOperacao = "automatic" | "assisted";

/**
 * Os códigos de recusa. Entram em `PUBLISH_ERROR_CODES` (`./validation.ts`)
 * para que a rota os devolva como 422 estável em vez de 500 — o mesmo contrato
 * de `credential_missing` e dos irmãos.
 */
export type RecusaDeControleDeGastos =
  "modelo_sem_preco" | "budget_nao_declarado" | "budget_abaixo_do_piso";

export interface EstadoDoControleDeGastos {
  /**
   * O modo do AGENTE, não da versão. `assisted` dispensa o teto: cada mensagem
   * passa por uma pessoa antes de sair, então o gasto é limitado pela vazão de
   * quem aprova, não pelo apetite do modelo.
   */
  modoDeOperacao: ModoDeOperacao;
  /** `ai_budgets.enforcement_mode`. Linha ausente ⇒ `'off'`. */
  modo: ModoDeOrcamento;
  /** `ai_budgets.monthly_limit_cents`, em centavos de DÓLAR (ver `pricing.ts`). */
  tetoCents: number;
  /** `ai_agent_versions.model` — o id exato que vai para o provedor. */
  modelo: string;
}

export type VereditoDoControleDeGastos =
  { ok: true } | { ok: false; codigo: RecusaDeControleDeGastos; detalhes: Record<string, unknown> };

/**
 * ⚠️ O MODELO É CONFERIDO NOS DOIS MODOS DE OPERAÇÃO, e o teto só no automático.
 *
 * Não é inconsistência. O teto responde "quanto esta organização aceita gastar",
 * e no assistido a resposta já é "o que uma pessoa aprovar". O preço responde
 * "este gasto é mensurável", e a resposta não muda com o modo: um modelo sem
 * linha de preço some do gasto do mês nos dois casos, e some da tela de Uso nos
 * dois. Dispensar a conferência no assistido deixaria o modo que o produto
 * recomenda para o primeiro mês ser justamente o que não se consegue medir.
 */
export function decidirControleDeGastos(
  estado: EstadoDoControleDeGastos,
): VereditoDoControleDeGastos {
  if (precoDoModelo(estado.modelo) === undefined) {
    return {
      ok: false,
      codigo: "modelo_sem_preco",
      detalhes: { modelo: estado.modelo },
    };
  }

  // O teto é exigência da OPERAÇÃO AUTOMÁTICA. Ver a nota acima.
  if (estado.modoDeOperacao !== "automatic") {
    return { ok: true };
  }

  if (estado.modo === "off") {
    return {
      ok: false,
      codigo: "budget_nao_declarado",
      detalhes: { piso_cents: PISO_DE_TETO_CENTS },
    };
  }

  // Backstop, não a régua da vez: o `PATCH /api/v1/ai/budget` já recusa com 422
  // quem tenta sair de `off` sem o piso, e há CHECK no banco para `bloquear`
  // (`ai_budgets_bloquear_precisa_de_teto`). Esta linha alcança a linha escrita
  // por fora da tela — e `avisar` com teto 0, que o CHECK não cobre.
  if (estado.tetoCents < PISO_DE_TETO_CENTS) {
    return {
      ok: false,
      codigo: "budget_abaixo_do_piso",
      detalhes: { piso_cents: PISO_DE_TETO_CENTS, teto_cents: estado.tetoCents },
    };
  }

  return { ok: true };
}

/** O que a tela mostra para cada recusa. Texto de UI; o CÓDIGO é o contrato. */
export const MENSAGEM_DA_RECUSA: Record<RecusaDeControleDeGastos, string> = {
  modelo_sem_preco:
    "Este modelo não tem preço cadastrado nesta versão do produto, então o gasto " +
    "dele não entra no total do mês nem no limite de gastos — a tela de Uso de IA " +
    "mostraria zero com dinheiro saindo. Escolha um modelo com preço conhecido " +
    "antes de publicar.",
  budget_nao_declarado:
    "Antes de deixar a IA atender sozinha, defina quanto esta empresa aceita gastar " +
    "por mês em Uso de IA › Orçamento. Enquanto o limite não for declarado, não há " +
    "nada que impeça o gasto de crescer sem ninguém perceber.",
  budget_abaixo_do_piso:
    "O limite de gastos desta empresa está abaixo do mínimo que o produto consegue " +
    "honrar. Ajuste-o em Uso de IA › Orçamento antes de publicar.",
};

/**
 * A LEITURA. Três perguntas ao banco, nenhuma decisão — a decisão é da função
 * pura acima.
 *
 * `admin` e não a sessão: `ai_budgets` é lida com filtro EXPLÍCITO de
 * `organization_id` vindo de fonte confiável (o cookie já validado por quem
 * chama), como manda a doutrina do repo para cliente de serviço.
 *
 * **Falha de leitura NÃO recusa a publicação.** É a mesma assimetria de
 * `aplicarOrcamento`: errar frouxo aqui deixa publicar um agente sem teto
 * declarado — visível, corrigível, e o aviso da Central o alcança; errar duro
 * impediria alguém de publicar porque uma query falhou, numa VPS onde não há
 * para quem ligar. O `porque` volta para quem chama poder registrar.
 */
export async function conferirControleDeGastos(
  admin: SupabaseClient,
  params: { orgId: string; agentId: string; versionId: string },
): Promise<VereditoDoControleDeGastos & { naoFoiPossivelConferir?: string }> {
  const { data: agente, error: erroAgente } = await admin
    .from("ai_agents")
    .select("operation_mode")
    .eq("organization_id", params.orgId)
    .eq("id", params.agentId)
    .maybeSingle();
  if (erroAgente) {
    return { ok: true, naoFoiPossivelConferir: `ai_agents: ${erroAgente.message}` };
  }

  const { data: versao, error: erroVersao } = await admin
    .from("ai_agent_versions")
    .select("model")
    .eq("organization_id", params.orgId)
    .eq("agent_id", params.agentId)
    .eq("id", params.versionId)
    .maybeSingle();
  if (erroVersao) {
    return { ok: true, naoFoiPossivelConferir: `ai_agent_versions: ${erroVersao.message}` };
  }
  // Versão inexistente não é assunto desta régua: quem a recusa é
  // `version_not_found`, antes daqui, nos dois chamadores.
  if (!versao?.model) {
    return { ok: true };
  }

  const { data: orcamento, error: erroOrcamento } = await admin
    .from("ai_budgets")
    .select("enforcement_mode, monthly_limit_cents")
    .eq("organization_id", params.orgId)
    .maybeSingle();
  if (erroOrcamento) {
    return { ok: true, naoFoiPossivelConferir: `ai_budgets: ${erroOrcamento.message}` };
  }

  return decidirControleDeGastos({
    // Coluna `not null default 'automatic'`: ausência de linha só acontece com
    // agente que não existe, e esse caso já foi recusado antes daqui.
    modoDeOperacao: agente?.operation_mode === "assisted" ? "assisted" : "automatic",
    // Linha ausente em `ai_budgets` é o estado de TODA organização que nunca
    // abriu a tela — nenhum gatilho de `organizations` semeia a tabela. Ausente
    // é "não declarou", que é exatamente o que esta régua cobra.
    modo: normalizarModoDeOrcamento(orcamento?.enforcement_mode ?? null),
    tetoCents: Number(orcamento?.monthly_limit_cents ?? 0),
    modelo: versao.model,
  });
}
