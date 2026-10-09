/**
 * NO RUNTIME, O CONTROLE DE GASTOS AVISA — E NUNCA RECUSA.
 *
 * ## A decisão que este arquivo prende
 *
 * Decisão do dono do produto (08/10/2026): a exigência de controle de gastos
 * vincula no ATO DE PUBLICAR (`lib/ai/agents/controle-de-gastos.ts`, com teste
 * próprio); no runtime ela só avisa. O runtime é o meio de um atendimento —
 * recusar ali trocaria "a organização não declarou teto" por "o cliente dela
 * não foi respondido", e o segundo estrago é maior.
 *
 * Os dois avisos alcançam exatamente o que a publicação não alcança: o agente
 * que JÁ estava no ar quando esta mudança entrou, e o que o onboarding publicou
 * sozinho sem ninguém ter sido perguntado nada.
 *
 * ## ⚠️ METADE DOS CASOS PROVA QUE NADA FOI BLOQUEADO
 *
 * Um aviso é fácil de "fortalecer" até virar recusa, e a sabotagem passaria
 * desapercebida: os casos de aviso continuariam verdes. Por isso cada caso
 * positivo afirma TAMBÉM que a chamada chegou ao provedor (`invocacoes`) e que
 * nada foi lançado (`lancou`).
 *
 * ## O estrangulamento é estado de MÓDULO, e os casos lidam com isso
 *
 * `avisarSobreControleDeGastos` guarda um `Map` de módulo para não escrever no
 * banco a cada chamada (o atalho de `enforcement_mode = 'off'` existe para
 * voltar ANTES de qualquer query). Dois casos com a mesma chave no mesmo arquivo
 * se estrangulariam mutuamente — então cada caso usa a sua ORGANIZAÇÃO, e o
 * caso do estrangulamento o exercita de propósito, com a mesma.
 */
import { describe, expect, it, vi } from "vitest";

import {
  MODELO_SEM_PRECO_TITULO,
  REF_MODELO_SEM_PRECO,
  REF_SEM_TETO,
  SEM_TETO_TITULO,
} from "@/lib/agent-engine/edge/llm/orcamento";
import { runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

/** Uma organização por caso — ver a nota sobre estrangulamento no cabeçalho. */
const ORG = {
  semTeto: "44444444-0001-4444-8444-444444444444",
  semTetoRepetido: "44444444-0002-4444-8444-444444444444",
  previa: "44444444-0003-4444-8444-444444444444",
  chaveDeEmergencia: "44444444-0004-4444-8444-444444444444",
  modeloSemPreco: "44444444-0005-4444-8444-444444444444",
  modeloComPreco: "44444444-0006-4444-8444-444444444444",
  declarado: "44444444-0007-4444-8444-444444444444",
};

const COM_PRECO = "claude-sonnet-5";
const SEM_PRECO = "modelo-que-ninguem-cadastrou-9000";

function poolFalso(opts: { modo?: string; teto?: number } = {}) {
  const sqls: string[] = [];
  const inbox: Array<{ sql: string; params: unknown[] }> = [];
  const llmCalls: unknown[][] = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    sqls.push(sql);
    // A ordem casa pelo pedaço mais específico primeiro — o statement do gate
    // TAMBÉM contém `insert into agent_inbox_items` (a CTE `avisa`).
    if (sql.includes("fn_gasto_de_ia_do_mes")) {
      return {
        rows: [
          {
            teto: opts.teto ?? 5000,
            modo: opts.modo ?? "off",
            efetivo_em: null,
            limiar_pct: 80,
            gasto: "0.0000",
            avisado_antes: false,
          },
        ],
      };
    }
    if (sql.includes("left join ai_budgets")) {
      return {
        rows: [
          {
            llm: {
              provider: "anthropic",
              default_model: COM_PRECO,
              params: {},
              enabled_models: [],
            },
            teto: opts.teto ?? 5000,
            modo: opts.modo ?? "off",
            efetivo_em: null,
            limiar_pct: 80,
          },
        ],
      };
    }
    if (sql.includes("settings->'llm'")) {
      return { rows: [{ llm: { provider: "anthropic", default_model: COM_PRECO } }] };
    }
    if (sql.includes("ai_purpose_bindings")) return { rows: [] };
    if (sql.includes("ai_provider_credentials")) return { rows: [] };
    if (sql.includes("insert into agent_inbox_items")) {
      inbox.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes("insert into llm_calls")) {
      llmCalls.push(params);
      return { rows: [{ id: "call-1" }] };
    }
    return { rows: [] };
  });

  return { pool: { query } as never, sqls, inbox, llmCalls };
}

/** Registry que SUCEDE — é o que permite chegar ao cálculo de custo. */
function registryQueResponde() {
  const invocacoes: string[] = [];
  const fabrica = (_chave: string, modelo: string) => {
    invocacoes.push(modelo);
    return {
      specificationVersion: "v3",
      provider: "anthropic",
      modelId: modelo,
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      }),
    } as never;
  };
  return {
    invocacoes,
    registry: { anthropic: fabrica, openai: fabrica, google: fabrica, openrouter: fabrica },
  };
}

async function chamar(
  orgId: string,
  estado: { modo?: string; teto?: number } = {},
  cfg: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
) {
  const p = poolFalso(estado);
  const r = registryQueResponde();
  const linhas: Array<{ nivel: string; msg: string }> = [];
  const push = (nivel: string) => (msg: string) => void linhas.push({ nivel, msg });
  let lancou: unknown = null;
  try {
    await runModelCall(
      p.pool,
      { anthropicApiKey: "sk-ant-x", cacheTtl: "1h", ...cfg },
      { tenantId: orgId, messages: [{ role: "user", content: "oi" }], ...input } as never,
      {
        registry: r.registry as never,
        log: { info: push("info"), warn: push("warn"), error: push("error") } as never,
      },
    );
  } catch (err) {
    lancou = err;
  }
  /** Só os avisos deste trabalho — o statement do gate também insere na Central. */
  const avisos = p.inbox.filter((i) =>
    i.params.some((x) => typeof x === "string" && x.startsWith("ai_")),
  );
  return { ...p, ...r, linhas, lancou, avisos };
}

describe("operação automática sem teto declarado: avisa e SEGUE", () => {
  it("⭐ abre UM aviso com o ref próprio, e a chamada chega ao provedor", async () => {
    const r = await chamar(ORG.semTeto, { modo: "off" });

    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]!.params).toContain(REF_SEM_TETO);
    expect(r.avisos[0]!.params).toContain(SEM_TETO_TITULO);
    // A prova de que NADA foi bloqueado: o provedor foi alcançado e nada subiu.
    expect(r.invocacoes).toEqual([COM_PRECO]);
    expect(r.lancou).toBeNull();
  });

  it("⭐ NÃO usa kind 'budget_warning' — aquele kind alimenta a condição 7 do bloqueio", async () => {
    // `avisadoNesteMes` lê `budget_warning` como "já foi avisada do limiar neste
    // mês". Um aviso por AUSÊNCIA de teto com aquele kind satisfaria a condição
    // sem ninguém ter cruzado limiar, e a organização passaria a poder ser
    // BLOQUEADA na primeira vez que o gasto atinge o teto — sem o aviso que a
    // condição existe para garantir. O erro apontaria para o lado duro.
    const r = await chamar(ORG.semTetoRepetido, { modo: "off" });
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0]!.sql).toContain("'other'");
    expect(r.avisos[0]!.sql).not.toContain("budget_warning");
  });

  it("⭐ o estrangulamento vale: a segunda chamada da mesma organização não escreve", async () => {
    // `ORG.semTetoRepetido` já avisou no caso acima — o Map de módulo guarda a
    // chave. É o que mantém o caminho quente sem escrita por chamada.
    const r = await chamar(ORG.semTetoRepetido, { modo: "off" });
    expect(r.avisos).toHaveLength(0);
    expect(r.invocacoes).toEqual([COM_PRECO]);
  });

  it("⭐ rascunho e sandbox NÃO são avisados — o produto não cobra teto do assistido", async () => {
    // `agent_preview` é o purpose do rascunho assistido e do Testar: modo em que
    // uma pessoa aprova cada mensagem, e que a régua de publicação dispensa de
    // propósito. Avisar ali seria cobrar teto de quem o produto não cobra.
    const r = await chamar(ORG.previa, { modo: "off" }, {}, { purpose: "agent_preview" });
    expect(r.avisos).toHaveLength(0);
  });

  it("a chave de emergência não avisa — alerta novo no meio do incidente é ruído", async () => {
    const r = await chamar(ORG.chaveDeEmergencia, { modo: "off" }, { budgetEnforcement: "off" });
    expect(r.avisos).toHaveLength(0);
    expect(r.invocacoes).toEqual([COM_PRECO]);
  });

  it("⭐ organização que DECLAROU o teto não recebe aviso nenhum deste tipo", async () => {
    // Controle positivo: sem ele, um aviso que disparasse sempre ficaria verde.
    const r = await chamar(ORG.declarado, { modo: "bloquear", teto: 5000 });
    expect(r.avisos.filter((a) => a.params.includes(REF_SEM_TETO))).toHaveLength(0);
  });
});

describe("modelo sem preço: avisa, grava custo NULO e SEGUE", () => {
  it("⭐ abre o aviso com o modelo como ref, e a chamada acontece", async () => {
    const r = await chamar(
      ORG.modeloSemPreco,
      { modo: "bloquear", teto: 5000 },
      {},
      {
        model: SEM_PRECO,
      },
    );

    const doModelo = r.avisos.filter((a) => a.params.includes(REF_MODELO_SEM_PRECO));
    expect(doModelo).toHaveLength(1);
    expect(doModelo[0]!.params).toContain(SEM_PRECO);
    expect(doModelo[0]!.params).toContain(MODELO_SEM_PRECO_TITULO);
    expect(r.lancou).toBeNull();
  });

  it("⭐ o corpo explica que o limite deixa de proteger — não só que falta um número", async () => {
    // `fn_gasto_de_ia_do_mes` soma `cost_cents`, e SUM IGNORA NULL: o gasto deste
    // modelo não entra no mês e não conta para o teto. Um corpo que dissesse só
    // "custo desconhecido" deixaria quem lê achar que é cosmético.
    const r = await chamar(
      ORG.modeloSemPreco,
      { modo: "bloquear", teto: 5000 },
      {},
      {
        model: "outro-modelo-sem-preco-9001",
      },
    );
    const corpo = r.avisos
      .find((a) => a.params.includes(REF_MODELO_SEM_PRECO))!
      .params.find((x) => typeof x === "string" && x.includes("limite")) as string;
    expect(corpo).toMatch(/não conta para o limite|limite\s+deixa de proteger/i);
  });

  it("o custo continua NULO na coluna — inventar um número seria pior que não ter", async () => {
    const r = await chamar(
      ORG.modeloSemPreco,
      { modo: "bloquear", teto: 5000 },
      {},
      {
        model: "mais-um-sem-preco-9002",
      },
    );
    // `insert into llm_calls`: o 12º parâmetro é `cost_cents` (ver a ordem do
    // insert em `run-model-call.ts`).
    expect(r.llmCalls).toHaveLength(1);
    expect(r.llmCalls[0]![11]).toBeNull();
  });

  it("⭐ modelo COM preço não gera aviso, e grava um custo", async () => {
    const r = await chamar(
      ORG.modeloComPreco,
      { modo: "bloquear", teto: 5000 },
      {},
      {
        model: COM_PRECO,
      },
    );
    expect(r.avisos.filter((a) => a.params.includes(REF_MODELO_SEM_PRECO))).toHaveLength(0);
    expect(r.llmCalls[0]![11]).not.toBeNull();
  });
});

/**
 * A OUTRA METADE DE "MENSAGEM CLARA": o total da tela deixa de mentir por omissão.
 *
 * O aviso da Central alcança quem olha a Central. O total de custo da tela de Uso
 * é visto por quem nunca abriu a Central — e ele soma só o que tem preço. Sem o
 * contador, a tela mostra um número honesto e INCOMPLETO sem nada dizer que falta
 * parte; foi assim que uma VPS real exibiu gasto zero com 28 chamadas saindo.
 */
describe("o total da tela de Uso declara quantas chamadas ficaram sem preço", () => {
  const JANELA = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-01T23:59:59Z") };
  const linha = (cost: number | null) => ({
    created_at: "2026-10-01T12:00:00Z",
    invocation_kind: "agent_turn",
    cost_cents: cost,
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    latency_ms: 100,
  });

  it("⭐ conta as nulas, e o total segue somando só as conhecidas", async () => {
    const { aggregateUsage } = await import("@/lib/ai/usage/aggregate");
    const p = aggregateUsage([linha(30), linha(null), linha(null)], new Map(), new Map(), JANELA);
    expect(p.totals.chamadas_sem_preco).toBe(2);
    // O total NÃO inventa valor para as nulas — honestidade preservada.
    expect(p.totals.cost_cents).toBe(30);
    expect(p.totals.invocations).toBe(3);
  });

  it("zero é o caso normal, e é a única leitura que autoriza confiar no total", async () => {
    const { aggregateUsage } = await import("@/lib/ai/usage/aggregate");
    const p = aggregateUsage([linha(30), linha(70)], new Map(), new Map(), JANELA);
    expect(p.totals.chamadas_sem_preco).toBe(0);
    expect(p.totals.cost_cents).toBe(100);
  });
});
