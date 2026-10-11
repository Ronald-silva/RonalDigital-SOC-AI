// @vitest-environment node
//
// `node` e não o `jsdom` do projeto `produto`: o módulo sob teste é server-only e não
// toca DOM. Mesma razão que o `vitest.config.ts` dá para o projeto `cercas` existir.
/**
 * A VOLTA do atendimento humano quando a pessoa só RESPONDEU — sem chamado, sem nota.
 *
 * ## O defeito
 *
 * `houveAtendimentoHumano` lia três superfícies (`agent_case_events`,
 * `conversation_notes`, `agent_cases`) e nenhuma delas é alimentada pela operação comum:
 * quem atende assume a conversa no Inbox e responde. Medido na conversa `cb141462` em
 * 11/10/2026 — 0 chamados, 0 notas, 1 mensagem humana ENTREGUE — a devolução ao
 * automático auditou `houve_atendimento_humano: false`, pulou `gravarCheckpointDeRetomada`
 * e o agente reassumiu cego. O cliente perguntou "você lembra o que ficou pendente?" e a
 * IA não tinha como lembrar.
 *
 * ## Os dois casos que são o conserto, e não enfeite
 *
 *  - `failed` FORA (caso "não saiu"): a mensagem humana das 18:39 daquela conversa tinha
 *    `error_message='fetch failed'` e nunca chegou ao WhatsApp. Contá-la faria a IA
 *    afirmar ao cliente que a equipe já respondeu algo que ele nunca viu.
 *  - JANELA `last_handoff_at` (casos "idempotência"): é ela que impede o
 *    `rolling_summary` de empilhar o mesmo relato a cada devolução, porque
 *    `gravarCheckpointDeRetomada` ACRESCENTA em vez de substituir e `retomada.ts` não
 *    tem guarda de reentrada.
 *
 * ## Por que o stub FILTRA de verdade
 *
 * Um stub que devolve linhas prontas e deixa o teste conferir `.eq(...)` chamado mede a
 * FORMA da consulta, não o comportamento: trocar `status in (...)` por outro predicado
 * passaria. Este stub aplica `eq`/`in`/`gte`/`order`/`limit` sobre as linhas, então quem
 * responde "esta mensagem conta?" é o código sob teste.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  lerContinuidadeHumana,
  montarResumo,
  type ContinuidadeHumana,
} from "@/lib/escalacao/continuidade";

const ORG = "aad4899b-5753-44c9-9fb5-81668b0db971";
const CONV = "cb141462-4f62-4e47-86b0-e6c43bdaec2e";
const DONO = "bca6195a-525d-4299-8a5e-a0f948023a23";

/** Carimbos reais da conversa medida. */
const PASSOU_A_HUMANO = "2026-10-11T18:34:47.728Z";
const ANTES_DA_PASSAGEM = "2026-10-11T18:10:00.000Z";
const FALA_ENTREGUE = "2026-10-11T18:53:55.635Z";
const FALA_QUE_FALHOU = "2026-10-11T18:39:12.848Z";

interface LinhaDeMensagem {
  organization_id: string;
  conversation_id: string;
  body: string | null;
  sent_by_user_id: string | null;
  created_at: string;
  direction: string;
  sent_via: string;
  status: string;
}

/**
 * Uma mensagem humana ENTREGUE, com TODOS os campos que a leitura filtra — inclusive
 * `organization_id` e `conversation_id`. Eles não são enfeite: o stub aplica os filtros,
 * então uma linha sem eles é descartada, como seria no Postgres. Foi assim que a primeira
 * versão deste arquivo ficou vermelha — o teste estava errado, não o código, e é esse o
 * sinal de que o stub mede comportamento.
 */
function falaHumana(over: Partial<LinhaDeMensagem> = {}): LinhaDeMensagem {
  return {
    organization_id: ORG,
    conversation_id: CONV,
    body: "Oi Ronald, sou do comercial. Fechamos a implantação em 12x e a demo fica quinta às 10h.",
    sent_by_user_id: DONO,
    created_at: FALA_ENTREGUE,
    direction: "outbound",
    sent_via: "user",
    status: "delivered",
    ...over,
  };
}

type Tabelas = {
  conversations?: Array<{ id: string; organization_id: string; last_handoff_at: string | null }>;
  agent_cases?: unknown[];
  agent_case_events?: unknown[];
  conversation_notes?: unknown[];
  messages?: LinhaDeMensagem[];
};

/**
 * Supabase de mentira que FILTRA. Suporta só o que a leitura usa: eq, in, gte, order,
 * limit, maybeSingle — e é thenable, porque o código faz `await` no builder.
 */
function supabaseDeMentira(tabelas: Tabelas) {
  return {
    from(tabela: keyof Tabelas) {
      let linhas: Record<string, unknown>[] = [
        ...((tabelas[tabela] ?? []) as Record<string, unknown>[]),
      ];
      const builder = {
        select: () => builder,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return builder;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return builder;
        },
        gte: (coluna: string, valor: string) => {
          linhas = linhas.filter((l) => String(l[coluna]) >= valor);
          return builder;
        },
        order: (coluna: string, opts?: { ascending?: boolean }) => {
          const asc = opts?.ascending !== false;
          linhas = [...linhas].sort((a, b) => {
            const x = String(a[coluna]);
            const y = String(b[coluna]);
            return asc ? x.localeCompare(y) : y.localeCompare(x);
          });
          return builder;
        },
        limit: (n: number) => {
          linhas = linhas.slice(0, n);
          return builder;
        },
        maybeSingle: async () => ({ data: linhas[0] ?? null }),
        then: (
          resolve: (v: { data: Record<string, unknown>[] }) => unknown,
          reject?: (e: unknown) => unknown,
        ) => Promise.resolve({ data: linhas }).then(resolve, reject),
      };
      return builder;
    },
  };
}

/** Lê a continuidade de uma conversa EM passagem aberta, com as mensagens dadas. */
function lerCom(
  messages: LinhaDeMensagem[],
  lastHandoffAt: string | null = PASSOU_A_HUMANO,
): Promise<ContinuidadeHumana> {
  const db = supabaseDeMentira({
    conversations: [{ id: CONV, organization_id: ORG, last_handoff_at: lastHandoffAt }],
    agent_cases: [],
    agent_case_events: [],
    conversation_notes: [],
    messages,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lerContinuidadeHumana(db as any, ORG, CONV);
}

describe("continuidade: a fala humana ENTREGUE conta", () => {
  it("sem chamado e sem nota, uma mensagem entregue já é atendimento humano", async () => {
    // É exatamente o estado medido na conversa real: 0 chamados, 0 notas, 1 entregue.
    const c = await lerCom([falaHumana()]);

    expect(c.houveAtendimentoHumano).toBe(true);
    expect(c.decisoes).toEqual([]);
    expect(c.notas).toEqual([]);
    expect(c.falasAoCliente).toHaveLength(1);
    expect(c.falasAoCliente[0]?.autorUserId).toBe(DONO);
    expect(c.falasAoCliente[0]?.texto).toContain("demo fica quinta");
  });

  it("o resumo que vai ao prompt cita a fala, e diz que o CLIENTE já leu", async () => {
    const c = await lerCom([falaHumana()]);

    expect(c.resumo).not.toBe("");
    expect(c.resumo).toContain("JÁ DISSE ao cliente");
    expect(c.resumo).toContain("demo fica quinta");
  });

  it("várias falas entram em ordem cronológica", async () => {
    const c = await lerCom([
      falaHumana({ body: "segunda", created_at: "2026-10-11T18:55:00.000Z" }),
      falaHumana({ body: "primeira", created_at: "2026-10-11T18:50:00.000Z" }),
    ]);

    expect(c.falasAoCliente.map((f) => f.texto)).toEqual(["primeira", "segunda"]);
  });
});

describe("continuidade: o que NÃO conta como fala ao cliente", () => {
  it("`failed` não conta — a mensagem não chegou ao WhatsApp", async () => {
    // A mensagem real das 18:39, com `error_message='fetch failed'` e `external_id` vazio.
    const c = await lerCom([
      falaHumana({ status: "failed", created_at: FALA_QUE_FALHOU, body: "Olá, Ronald! Sou da equipe comercial." }),
    ]);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
    expect(c.resumo).toBe("");
  });

  it("`queued` e `sending` não contam — estão em trânsito, o dono é a cadeia de envio", async () => {
    const c = await lerCom([
      falaHumana({ status: "queued" }),
      falaHumana({ status: "sending", created_at: "2026-10-11T18:54:00.000Z" }),
    ]);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
  });

  it("a resposta da IA não conta — `sent_via='ai'` não é atendimento humano", async () => {
    const c = await lerCom([falaHumana({ sent_via: "ai", sent_by_user_id: null })]);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
  });

  it("mensagem do cliente não conta — só `outbound`", async () => {
    const c = await lerCom([falaHumana({ direction: "inbound" })]);

    expect(c.falasAoCliente).toEqual([]);
  });

  it("mídia sem legenda não conta — saiu, mas não há texto a repassar ao modelo", async () => {
    const c = await lerCom([falaHumana({ body: null }), falaHumana({ body: "   " })]);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
  });

  it("fala muito longa é cortada, com marca de corte", async () => {
    const c = await lerCom([falaHumana({ body: "x".repeat(900) })]);

    expect(c.falasAoCliente[0]?.texto).toHaveLength(401); // 400 + a marca
    expect(c.falasAoCliente[0]?.texto.endsWith("…")).toBe(true);
  });

  it("o teto por superfície vale aqui também — no máximo 10 falas no prompt", async () => {
    const muitas = Array.from({ length: 14 }, (_, i) =>
      falaHumana({ body: `fala ${i}`, created_at: `2026-10-11T18:4${i % 10}:00.000Z` }),
    );
    const c = await lerCom(muitas);

    expect(c.falasAoCliente.length).toBeLessThanOrEqual(10);
  });
});

describe("continuidade: a JANELA é a idempotência", () => {
  it("fala de ANTES da passagem não entra — a janela começa em `last_handoff_at`", async () => {
    const c = await lerCom([falaHumana({ created_at: ANTES_DA_PASSAGEM, body: "conversa de semanas atrás" })]);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
  });

  it("SEM passagem aberta (`last_handoff_at` nulo) a leitura é vazia — nunca 'a conversa toda'", async () => {
    // Esta é a SEGUNDA devolução: o passo (2) de `retomada.ts` já zerou `last_handoff_at`.
    // A fala continua no banco, e mesmo assim não há o que gravar de novo.
    const c = await lerCom([falaHumana()], null);

    expect(c.falasAoCliente).toEqual([]);
    expect(c.houveAtendimentoHumano).toBe(false);
    expect(c.resumo).toBe("");
  });

  it("a MESMA fala: conta na 1ª devolução, não conta na 2ª — sem duplicar checkpoint", async () => {
    const fala = [falaHumana()];

    const primeira = await lerCom(fala, PASSOU_A_HUMANO);
    const segunda = await lerCom(fala, null); // estado após o passo (2) da primeira

    expect(primeira.houveAtendimentoHumano).toBe(true);
    expect(segunda.houveAtendimentoHumano).toBe(false);
  });

  it("ler duas vezes com a janela aberta devolve o MESMO conteúdo — leitura é pura", async () => {
    const fala = [falaHumana()];
    const a = await lerCom(fala);
    const b = await lerCom(fala);

    expect(a.falasAoCliente).toEqual(b.falasAoCliente);
    expect(a.resumo).toBe(b.resumo);
  });
});

describe("cerca: a janela só é idempotente se `retomada.ts` mantiver a ORDEM", () => {
  // A leitura pura acima prova que janela fechada devolve vazio. O que faz isso valer no
  // fluxo real é a ordem dos passos em `retomada.ts`, e ela não aparece em nenhum tipo:
  //
  //   passo (0)  lê a continuidade        ← `last_handoff_at` AINDA preenchido
  //   passo (2)  zera `last_handoff_at`   ← fecha a janela
  //   passo (5)  grava o checkpoint       ← só se `houveAtendimentoHumano`
  //
  // Inverter (0) e (2) faria a PRIMEIRA devolução já ler janela fechada e nunca gravar
  // checkpoint — o defeito original de volta, pela porta oposta. E tirar a guarda do
  // passo (5) faria toda devolução empilhar no `rolling_summary`, que é acrescentado.
  const FONTE = readFileSync(join(process.cwd(), "lib/escalacao/retomada.ts"), "utf8");

  it("a continuidade é lida ANTES de `last_handoff_at` ser zerado", () => {
    const leitura = FONTE.indexOf("await lerContinuidadeHumana(");
    const fechaJanela = FONTE.indexOf("last_handoff_at: null");

    expect(leitura).toBeGreaterThan(-1);
    expect(fechaJanela).toBeGreaterThan(-1);
    expect(leitura).toBeLessThan(fechaJanela);
  });

  it("o checkpoint de retomada só é gravado quando houve atendimento humano", () => {
    expect(FONTE).toMatch(
      /if \([^)]*continuidade\.houveAtendimentoHumano\)\s*\{\s*await gravarCheckpointDeRetomada\(/,
    );
  });

  it("o checkpoint ACRESCENTA ao resumo anterior — é por isso que a janela é obrigatória", () => {
    // Se algum dia isto virar substituição, a janela deixa de ser a única defesa contra
    // duplicação e este arquivo precisa ser relido inteiro.
    expect(FONTE).toContain("ACRESCENTADO ao anterior, nunca substituído");
  });
});

describe("montarResumo: a fala ao cliente não se confunde com a nota interna", () => {
  it("rótulos diferentes — o cliente leu uma e não leu a outra", () => {
    const resumo = montarResumo({
      decisoes: [],
      notas: [{ autor: "Dono", texto: "cliente pediu desconto; autorizei 10%", quando: FALA_ENTREGUE }],
      falasAoCliente: [{ autorUserId: DONO, texto: "consigo 10% de desconto", quando: FALA_ENTREGUE }],
      pendenciaComOCliente: null,
    });

    expect(resumo).toContain("anotou internamente: cliente pediu desconto");
    expect(resumo).toContain("JÁ DISSE ao cliente, por mensagem: consigo 10% de desconto");
    // A ordem importa: nota interna antes, fala ao cliente depois e com rótulo próprio —
    // emendar as duas é o que faz o agente recitar nota interna para o cliente.
    expect(resumo.indexOf("anotou internamente")).toBeLessThan(resumo.indexOf("JÁ DISSE ao cliente"));
  });

  it("sem o campo (quem monta sem as falas) o resumo segue montando", () => {
    const resumo = montarResumo({
      decisoes: [],
      notas: [{ autor: null, texto: "nota", quando: FALA_ENTREGUE }],
      pendenciaComOCliente: null,
    });

    expect(resumo).toContain("a equipe anotou internamente: nota");
    expect(resumo).not.toContain("JÁ DISSE ao cliente");
  });
});
