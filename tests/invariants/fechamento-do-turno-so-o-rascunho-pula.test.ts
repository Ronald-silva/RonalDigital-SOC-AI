/**
 * QUEM PULA A 2ª CHAMADA DE MODELO É O RASCUNHO — E SÓ ELE.
 *
 * O turno do agente faz DUAS chamadas ao modelo: a do agente (que responde) e a
 * de FECHAMENTO (`CHECKPOINT_INSTRUCTION`), que gera o checkpoint e o valida
 * pelo `checkpointContentSchema`. O retorno antecipado de
 * `executarTurnoDoAgente` — `if (preview?.kind === 'assisted')` — tira a segunda
 * de UMA das duas prévias, e a decisão arquitetural de 08/10/2026 é que fique
 * assim. Três regimes, três linhas diferentes:
 *
 *   - RASCUNHO (`kind: 'assisted'`) — NÃO paga a 2ª chamada. Ninguém lê o
 *     checkpoint da prévia assistida (`reply-drafts.ts` consome
 *     candidates/proposals/impediments e nada mais), e a chamada segurava a
 *     entrega: 16 dos 28 s medidos em produção (gpt-6-luna, 2026-09-24);
 *   - TESTAR (`kind: 'sandbox'`) — PAGA a 2ª chamada e expõe o conteúdo em
 *     `result.checkpoint`, mas NÃO persiste (volta antes do `insertCheckpoint`).
 *     É deliberado: a mesma doutrina que `preview.ts` escreve para os gates de
 *     agenda — "um gate que arma diferente aqui faz quem afina o prompt testar
 *     contra outro sistema". O fechamento é onde um prompt ruim devolve JSON
 *     fora do contrato, e quem afina precisa descobrir isso na TELA, não num
 *     turno de cliente que a fila vai repetir inteiro (até 30¢ por mensagem,
 *     medido em 27/09/2026 — ver `fechamento-do-turno-corrige-antes-de-repetir`);
 *   - ATENDIMENTO NORMAL — paga a 2ª chamada E PERSISTE em `lead_checkpoints`.
 *
 * Uma tentativa de ampliar o retorno antecipado para `if (preview)` (poupando a
 * chamada também no sandbox) foi medida e recusada: ela reprovava
 * `autonomia-preview-core.test.ts:199` e tirava da tela de teste a única prova
 * de que o fechamento daquele prompt fecha.
 *
 * O que este arquivo prende é COMPORTAMENTO medido na chamada ao modelo, não
 * texto de fonte: o fake de provider registra TODA chamada e marca a que leva a
 * instrução de fechamento. As três linhas moram no mesmo arquivo de propósito —
 * sem o atendimento normal e o sandbox ao lado, apagar o fechamento INTEIRO
 * deixaria o caso do rascunho verde por AUSÊNCIA.
 *
 * As três sabotagens, com o que cada uma vermelha — MEDIDAS, não supostas:
 *
 *   - trocar a condição por `if (preview)` (a ampliação recusada) → B, B2 e D2
 *     vermelhos; A, C e D1 seguem verdes;
 *   - apagar o retorno antecipado → A e D1 vermelhos;
 *   - trocá-lo por `if (true)` → C vermelho (e, de arrasto, B, B2 e D2).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { loadAgentVersionConfig } from "@/lib/agent-engine/agent/agent-config";
import {
  CHECKPOINT_INSTRUCTION,
  createInboundTurnHandler,
  runAgentPreview,
} from "@/lib/agent-engine/agent/inbound-turn";
import {
  newPreviewResult,
  scenarioContext,
  type TurnPreview,
} from "@/lib/agent-engine/agent/preview";
import { generateReplyDraft } from "@/lib/agent-engine/agent/reply-drafts";
import { testAgentVersion } from "@/lib/agent-engine/agent/sandbox";
import { turnKnobsFromEnv } from "@/lib/agent-engine/agent/turn-knobs";
import { createFakeRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { loadEnv } from "@/lib/agent-engine/env";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import * as fila from "@/lib/agent-engine/queue/queue";

import { seedGov } from "./gov-helpers";
import { replyFixture } from "../support/autonomia-fixture";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 6,
});

/**
 * A MARCA do fechamento sai da própria constante do produto, nunca de uma
 * string copiada: renomear a instrução não pode deixar a sonda cega. O recorte
 * é o prefixo sem aspas nem barra — é o que sobrevive ao `JSON.stringify` do
 * prompt sem precisar de escape.
 */
const MARCA_DE_FECHAMENTO = CHECKPOINT_INSTRUCTION.slice(0, 40);

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const RESUMO = "RESUMO DO FECHAMENTO";
const PROXIMA = "aguardar a confirmação do cliente";

/**
 * O fechamento do modelo SEM `commitments`, `objections` e `declaracao`.
 *
 * A omissão é o instrumento: quem recebe este texto cru não tem as listas, e
 * quem recebe o conteúdo VALIDADO tem `[]` nas duas (default do
 * `checkpointContentSchema`) e `declaracao` ausente. É assim que os casos abaixo
 * provam que o checkpoint passou pelo Zod, e não que o texto foi repassado.
 */
const CHECKPOINT_PARCIAL = JSON.stringify({ next_action: PROXIMA, rolling_summary: RESUMO });

type Chamada = { fechamento: boolean; ferramentas: number };

function texto(t: string) {
  return {
    content: [{ type: "text" as const, text: t }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

function chamadaDeFerramenta(nome: string, args: unknown) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: randomUUID(),
        toolName: nome,
        input: JSON.stringify(args),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage: USO,
    warnings: [],
  };
}

/**
 * Modelo fake que REGISTRA toda chamada e distingue a de fechamento das outras.
 *
 * `manda: false` → nunca chama `send_message` (os casos D, prévia sem
 * candidato). `fechamentoInvalido: true` → devolve texto sem JSON na chamada de
 * fechamento, que é o que exercita a VALIDAÇÃO (o caso B2). `corpo` é único por
 * caso porque o gate `spinning` (mass_identical) veta corpo repetido e
 * vermelharia pelo motivo errado.
 */
function modelo(
  registro: Chamada[],
  corpo: string,
  opts: { manda?: boolean; fechamentoInvalido?: boolean } = {},
) {
  const manda = opts.manda ?? true;
  let enviou = false;
  return async (chamada: { prompt?: unknown; tools?: unknown[] }) => {
    const prompt = JSON.stringify(chamada.prompt ?? []);
    const ferramentas = chamada.tools?.length ?? 0;
    const fechamento = prompt.includes(MARCA_DE_FECHAMENTO);
    registro.push({ fechamento, ferramentas });
    if (fechamento)
      return texto(opts.fechamentoInvalido ? "não vou devolver JSON nenhum" : CHECKPOINT_PARCIAL);
    if (manda && !enviou && ferramentas > 0) {
      enviou = true;
      return chamadaDeFerramenta("send_message", { body: corpo });
    }
    return texto("Concluído.");
  };
}

const fechamentos = (registro: Chamada[]) => registro.filter((c) => c.fechamento);

/** Deps do caminho de prévia — o mesmo formato de `autonomia-preview-core.test.ts`. */
function depsDePrevia(
  registro: Chamada[],
  corpo: string,
  opts: { manda?: boolean; fechamentoInvalido?: boolean } = {},
) {
  const knobs = turnKnobsFromEnv(
    loadEnv({
      NODE_ENV: "test",
      SUPABASE_DB_URL: "postgresql://postgres:postgres@localhost/postgres",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
    }),
  );
  // Fora de medição: cada um destes é uma chamada ao modelo a mais, e o que
  // este arquivo conta é a de FECHAMENTO.
  delete knobs.stageClassifier;
  delete knobs.jailbreak;
  delete knobs.promiseSemantic;
  delete knobs.compaction;
  return {
    crmCfg: { supabase: createClient("http://127.0.0.1:1", "test-key") },
    llmCfg: { anthropicApiKey: "fake-local" },
    knobs,
    log: createLogger(),
    clock: () => new Date("2026-09-07T15:00:00Z"),
    embed: async () => ({
      embedding: Array(1536).fill(0.1),
      promptTokens: 0,
      model: "text-embedding-3-small",
    }),
    registry: createFakeRegistry(modelo(registro, corpo, opts) as never),
  };
}

/** Tudo que um turno de prévia NÃO pode ter escrito na organização. */
async function estadoDoCliente(org: string) {
  const { rows } = await pool.query(
    `select jsonb_build_object(
       'messages',(select count(*) from messages where organization_id=$1),
       'jobs',(select count(*) from job_queue where organization_id=$1),
       'notes',(select count(*) from lead_notes where organization_id=$1),
       'checkpoints',(select count(*) from lead_checkpoints where organization_id=$1),
       'ledger',(select count(*) from send_ledger where organization_id=$1),
       'contacts',(select jsonb_agg(to_jsonb(c)) from contacts c where organization_id=$1),
       'conversations',(select jsonb_agg(to_jsonb(c)) from conversations c where organization_id=$1)
     ) as state`,
    [org],
  );
  return rows[0].state;
}

const contaCheckpoints = async (org: string) =>
  Number(
    (await pool.query("select count(*) n from lead_checkpoints where organization_id=$1", [org]))
      .rows[0].n,
  );

const umaPrevia = (
  f: Awaited<ReturnType<typeof replyFixture>>,
  agent: NonNullable<Awaited<ReturnType<typeof loadAgentVersionConfig>>>,
  result: ReturnType<typeof newPreviewResult>,
): TurnPreview => ({
  kind: "sandbox",
  organizationId: f.org,
  runId: randomUUID(),
  agent,
  contactId: null,
  channelId: f.channel,
  context: scenarioContext([{ direction: "inbound", body: "Oi", sent_at: "2026-09-07T14:00:00Z" }]),
  result,
});

beforeAll(async () => {
  await seedGov();
  await pool.query(
    `with v as(insert into playbook_versions(organization_id,layer,content) select null,'platform','## Identidade: Assistente de teste.' where not exists(select 1 from playbook_pointers where organization_id is null and layer='platform') returning id) insert into playbook_pointers(organization_id,layer,version_id) select null,'platform',id from v`,
  );
});
afterAll(() => pool.end());

describe("a chamada de fechamento por regime de execução", () => {
  // ── A — RASCUNHO (assistido): NÃO paga, pelo caminho de produção ──────────
  it("A: o rascunho sai sem a chamada de fechamento, sem checkpoint gravado e com o contrato do rascunho intacto", async () => {
    const f = await replyFixture(pool);
    const registro: Chamada[] = [];

    const rascunho = await generateReplyDraft(
      pool,
      depsDePrevia(registro, "Posso confirmar o horário para você. [A]") as never,
      {
        organizationId: f.org,
        conversationId: f.conversation,
        contactId: f.contact,
        channelId: f.channel,
      },
    );

    // A resposta foi produzida: houve chamada do agente, e ela virou corpo.
    expect(registro.length).toBeGreaterThan(0);
    expect(rascunho.status).toBe("pending");
    expect(rascunho.original_body).toContain("confirmar o horário");

    // E a 2ª chamada NÃO aconteceu.
    expect(fechamentos(registro), "o rascunho não pode pagar a chamada de fechamento").toHaveLength(
      0,
    );

    // Nenhuma persistência indevida: nem checkpoint, nem mensagem no canal.
    expect(await contaCheckpoints(f.org)).toBe(0);
    expect(
      Number(
        (await pool.query("select count(*) n from messages where organization_id=$1", [f.org]))
          .rows[0].n,
      ),
      "prévia não escreve mensagem",
    ).toBe(0);
  });

  // ── B — TESTAR (sandbox): PAGA e EXPÕE, mas não persiste ──────────────────
  it("B: o Testar gera e VALIDA o checkpoint, expõe em result.checkpoint, e não persiste nada", async () => {
    const f = await replyFixture(pool);
    const registro: Chamada[] = [];
    const antes = await estadoDoCliente(f.org);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("preview_network_forbidden"));

    let resultado: Awaited<ReturnType<typeof testAgentVersion>>;
    try {
      resultado = await testAgentVersion(
        pool,
        depsDePrevia(registro, "O atendimento começa às nove horas. [B]") as never,
        {
          organizationId: f.org,
          agentId: f.agent,
          versionId: f.version,
          runId: randomUUID(),
          sampleMessage: "Qual o horário de atendimento?",
          channelId: f.channel,
        },
      );
      expect(fetchSpy, "o Testar não faz HTTP").not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    // A prévia gera candidato normalmente (é o que a tela mostra em `final_text`).
    expect(resultado.candidates).toHaveLength(1);
    expect(resultado.candidates[0]!.body).toContain("nove horas");

    // ⭐ O FECHAMENTO ACONTECE — exatamente uma vez, e sem ferramentas.
    expect(
      fechamentos(registro),
      "o Testar tem de exercitar o fechamento: é a tela onde se afina o prompt",
    ).toHaveLength(1);
    expect(fechamentos(registro)[0]!.ferramentas).toBe(0);

    // ⭐ E o que chega ao resultado é o conteúdo VALIDADO, não o texto cru: as
    // listas que o modelo OMITIU vêm `[]` pelo default do schema.
    expect(resultado.checkpoint).toMatchObject({
      rolling_summary: RESUMO,
      next_action: PROXIMA,
      commitments: [],
      objections: [],
    });
    expect(JSON.stringify(resultado.checkpoint)).not.toContain("declaracao");

    // Nada mudou no CRM — a mesma régua do invariante de prévia. O checkpoint
    // existe no resultado e NÃO em `lead_checkpoints`.
    expect(await estadoDoCliente(f.org)).toEqual(antes);
    expect(await contaCheckpoints(f.org)).toBe(0);
  });

  // ── B2 — a validação do sandbox é o produto, não enfeite ──────────────────
  //
  // Sem este caso, "o sandbox chama o fechamento" poderia ser verdade com o Zod
  // desligado — e a tela de teste voltaria a aprovar prompt que a fila repete.
  it("B2: fechamento fora do contrato reprova o Testar (uma correção, depois sobe) e não persiste nada", async () => {
    const f = await replyFixture(pool);
    const registro: Chamada[] = [];

    await expect(
      testAgentVersion(
        pool,
        depsDePrevia(registro, "resposta qualquer [B2]", { fechamentoInvalido: true }) as never,
        {
          organizationId: f.org,
          agentId: f.agent,
          versionId: f.version,
          runId: randomUUID(),
          sampleMessage: "Qual o horário de atendimento?",
          channelId: f.channel,
        },
      ),
      "JSON inválido no fechamento tem de aparecer para quem está testando",
    ).rejects.toThrow(/checkpoint/i);

    // DUAS chamadas de fechamento: a recusada e a correção (`fecharOTurno`).
    expect(fechamentos(registro)).toHaveLength(2);
    expect(await contaCheckpoints(f.org)).toBe(0);
  });

  // ── C — ATENDIMENTO NORMAL: paga E persiste ───────────────────────────────
  //
  // Roda o handler REAL de `inbound_turn` (o mesmo do daemon), com canal que
  // captura em vez de enviar — o harness de
  // `tests/invariants/limite-de-envios-por-turno.test.ts`.
  it("C: o atendimento normal fecha o turno — 2ª chamada feita e checkpoint PERSISTIDO", async () => {
    const org = randomUUID(),
      contact = randomUUID(),
      session = randomUUID(),
      conv = randomUUID(),
      msg = randomUUID();
    await pool.query(
      "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Fechamento','Fechamento')",
      [org],
    );
    await pool.query(
      "insert into contacts(id,organization_id,name,phone_number) values($1,$2,'Lead do fechamento','+5511900000777')",
      [contact, org],
    );
    await pool.query(
      "insert into channel_sessions(id,organization_id,waha_session_name,status,webhook_secret_encrypted) values($1,$2,'fechamento-session','WORKING','\\x00'::bytea)",
      [session, org],
    );
    await pool.query(
      "insert into conversations(id,organization_id,contact_id,channel_session_id,status,is_group) values($1,$2,$3,$4,'ai_handling',false)",
      [conv, org, contact, session],
    );
    await pool.query(
      `insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
       values($1,$2,$3,$4,$5,'text','inbound','delivered','Oi, qual o horário?','external_device',now())`,
      [msg, org, conv, session, contact],
    );

    const registro: Chamada[] = [];
    const enviados: Array<{ body: string }> = [];
    const handler = createInboundTurnHandler({
      crmCfg: { supabase: {} as never },
      llmCfg: { anthropicApiKey: "fake" },
      knobs: {
        historyLimit: 10,
        maxContextTokens: 1000,
        notesIndexMaxTokens: 500,
        maxSteps: 12,
        maxSendsPerTurn: 2,
        queuedRetryDelayMs: 1000,
        breaker: {
          exactFailureWarn: 2,
          exactFailureBlock: 5,
          sameToolFailureWarn: 3,
          sameToolFailureHalt: 8,
          noProgressWarn: 3,
          noProgressBlock: 5,
        },
      },
      log: createLogger(),
      registry: createFakeRegistry(
        modelo(registro, "O atendimento começa às nove horas. [C]") as never,
      ),
      channel: () =>
        ({
          channel: "captura",
          send: async (i: { body: string }) => {
            enviados.push(i);
            return {
              kind: "sent" as const,
              idempotencyKey: `k${enviados.length}`,
              messageId: `m${enviados.length}`,
            };
          },
          sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
          capabilities: () => ({ freeform: true, media: true, audio: true }),
          costPerMessage: () => ({ currency: "BRL", cents: 0 }),
        }) as never,
      // Terça, 15h BRT — dentro da janela anti-ban (7h-22h).
      clock: () => new Date("2026-07-28T18:00:00Z"),
      sleep: async () => {},
    } as never);

    const { job } = await fila.enqueueJob(pool, org, {
      kind: "inbound_turn",
      leadId: contact,
      payload: {
        conversation_id: conv,
        contact_id: contact,
        channel_session_id: session,
        inbound_message_id: msg,
        crm_event_id: randomUUID(),
      },
      maxAttempts: 1,
    });
    const [claimed] = await fila.claimJobs(pool, {
      workerId: "fechamento-normal",
      maxConcurrency: 1,
    });
    expect(claimed?.id).toBe(job.id);
    await handler(claimed!, pool, { workerId: "fechamento-normal" });
    await fila.completeJob(pool, claimed!.id, "fechamento-normal");

    // O lead recebeu a resposta…
    expect(enviados.map((e) => e.body)).toEqual(["O atendimento começa às nove horas. [C]"]);
    // …e o turno pagou a 2ª chamada, EXATAMENTE uma vez, sem ferramentas.
    expect(
      fechamentos(registro),
      "o atendimento normal perdeu o fechamento — o retorno antecipado vazou para fora da prévia",
    ).toHaveLength(1);
    expect(fechamentos(registro)[0]!.ferramentas).toBe(0);

    // E o checkpoint foi PERSISTIDO, com o conteúdo validado.
    const { rows } = await pool.query(
      "select rolling_summary, next_action, commitments, objections, declaracao, job_id from lead_checkpoints where organization_id=$1 and contact_id=$2",
      [org, contact],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rolling_summary).toBe(RESUMO);
    expect(rows[0].next_action).toBe(PROXIMA);
    expect(rows[0].commitments).toEqual([]);
    expect(rows[0].objections).toEqual([]);
    // O modelo não declarou: a coluna guarda NULL, não `{}` (ver `declaracao.ts`).
    expect(rows[0].declaracao).toBeNull();
    expect(rows[0].job_id).toBe(job.id);
  });

  // ── D1 — RASCUNHO sem candidato ───────────────────────────────────────────
  it("D1: rascunho sem candidato vira 'failed' com no_candidate, e ainda assim não paga o fechamento", async () => {
    const f = await replyFixture(pool);
    const registro: Chamada[] = [];

    const rascunho = await generateReplyDraft(
      pool,
      depsDePrevia(registro, "nunca enviado [D1]", { manda: false }) as never,
      {
        organizationId: f.org,
        conversationId: f.conversation,
        contactId: f.contact,
        channelId: f.channel,
      },
    );

    // O impedimento é o que chega a quem opera — e chega pelo contrato do rascunho.
    expect(rascunho.status).toBe("failed");
    expect(rascunho.error_code).toBe("no_candidate");
    expect(
      fechamentos(registro),
      "rascunho sem candidato tampouco justifica a 2ª chamada",
    ).toHaveLength(0);
    expect(await contaCheckpoints(f.org)).toBe(0);
  });

  // ── D2 — TESTAR sem candidato ─────────────────────────────────────────────
  it("D2: Testar sem candidato mantém o impedimento no_candidate — e o fechamento continua rodando", async () => {
    const f = await replyFixture(pool);
    const registro: Chamada[] = [];
    const agent = (await loadAgentVersionConfig(pool, f.org, f.agent, f.version))!;
    const result = newPreviewResult();

    await runAgentPreview(
      depsDePrevia(registro, "nunca enviado [D2]", { manda: false }) as never,
      pool,
      umaPrevia(f, agent, result),
    );

    expect(result.candidates, "o modelo não propôs resposta neste caso").toHaveLength(0);
    expect(result.impediments.map((i) => i.code)).toContain("no_candidate");
    // O aviso de "não propôs nada" NÃO custa o fechamento ao sandbox: ele é a
    // tela de afinar prompt, e o fechamento é parte do que se afina.
    expect(fechamentos(registro)).toHaveLength(1);
    expect(result.checkpoint).toMatchObject({ rolling_summary: RESUMO });
    expect(await contaCheckpoints(f.org)).toBe(0);
  });
});
