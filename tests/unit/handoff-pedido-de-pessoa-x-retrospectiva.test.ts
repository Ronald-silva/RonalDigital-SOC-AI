// @vitest-environment node
//
// `node`, e não o `jsdom` do projeto `produto`: o módulo sob teste é server-only
// (importa `pg`) e é lógica de string pura — não há DOM aqui. É a mesma razão que o
// `vitest.config.ts` dá para o projeto `cercas` existir ("o jsdom é o custo dominante,
// e as cercas pagavam jsdom à toa"), e o teste roda nos dois ambientes sem diferença
// de resultado: regex não muda de veredito por causa de `window`.
/**
 * O detector determinístico de pedido de pessoa: o que ele TEM de ouvir e o que ele
 * NÃO pode ouvir.
 *
 * ## O defeito que este arquivo guarda
 *
 * Medido na conversa `cb141462` em 11/10/2026, duas mensagens reais do mesmo cliente:
 *
 *   - 18:34 — "preciso falar DIRETAMENTE com um atendente humano…" era um pedido real,
 *     e `detectHumanHandoffRequest` devolvia `false`: o advérbio entre `falar` e `com`
 *     quebrava o `\s+com` do padrão, e "com O atendente" (artigo definido) também não
 *     era previsto.
 *   - 18:56 — "Já conversei com o atendente humano. Podemos continuar?" NÃO era pedido
 *     nenhum, e o turno abriu passagem nova: o cliente recebeu o aviso fixo de
 *     transferência, idêntico ao de 22 minutos antes, em vez da resposta.
 *
 * As duas têm a MESMA raiz. Porque o detector conservador não ouvia o pedido real, a
 * organização pôs a palavra SOLTA `atendente` em `ai_agent_versions.handoff_keywords`,
 * que o motor testa por substring crua (`matchesHandoffKeyword`, sem fronteira de
 * palavra e sem tempo verbal). O remendo segurou o caso real e trouxe o falso positivo.
 *
 * ## Por que o caso 4 é o mais importante daqui
 *
 * Ele é a CERCA DA ORDEM do conserto. Tirar a palavra solta da configuração sem fechar
 * a lacuna do padrão faz o pedido legítimo das 18:34 deixar de ser ouvido — e handoff
 * que para de funcionar é pior que o falso positivo. O caso 4 reprova exatamente essa
 * inversão: ele mede o pedido real contra a lista JÁ SEM a palavra solta.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { matchesHandoffKeyword } from "@/lib/agent-engine/agent/agent-config";
import { detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";

/** Verbatim de `messages.body`, inbound `a11eeb78`, 2026-10-11 18:34:24+00. */
const PEDIDO_REAL =
  "Sara, preciso falar diretamente com um atendente humano para negociar as condições " +
  "comerciais e os valores de implantação. Você pode me transferir para alguém da equipe?";

/** Verbatim de `messages.body`, inbound `9894c3a1`, 2026-10-11 18:56:51+00. */
const RETROSPECTIVA_REAL =
  "Olá, Sara! Já conversei com o atendente humano. Podemos continuar? Você lembra quais " +
  "serviços eu quero contratar e o que ficou pendente na nossa negociação?";

/** O que a Sara tinha configurado quando o falso positivo aconteceu. */
const KEYWORDS_ANTES = ["falar com humano", "atendente", "pessoa real"];
/** O que fica depois do item 4 do conserto: as expressões, sem a palavra solta. */
const KEYWORDS_DEPOIS = ["falar com humano", "pessoa real"];

describe("detectHumanHandoffRequest: pedido de pessoa", () => {
  it("1. o pedido REAL de 18:34 é ouvido — advérbio entre o verbo e o `com`", () => {
    expect(detectHumanHandoffRequest(PEDIDO_REAL)).toBe(true);
  });

  it("2. a mensagem RETROSPECTIVA de 18:56 não é pedido — nada de passagem nova", () => {
    expect(detectHumanHandoffRequest(RETROSPECTIVA_REAL)).toBe(false);
  });

  it("3. a palavra SOLTA era o que disparava — e disparava nas duas", () => {
    // Este caso não mede o conserto: mede a CAUSA, para ela não voltar como
    // "otimização" da configuração. Com a palavra solta, a frase retrospectiva
    // dispara igual à do pedido — é substring crua, não leitura de intenção.
    expect(matchesHandoffKeyword(RETROSPECTIVA_REAL, KEYWORDS_ANTES)).toBe(true);
    expect(matchesHandoffKeyword(PEDIDO_REAL, KEYWORDS_ANTES)).toBe(true);
  });

  it("4. CERCA DA ORDEM: sem a palavra solta, o padrão sozinho ainda ouve o pedido real", () => {
    // A condição do turno é um OR: `detectHumanHandoffRequest(t) || matchesHandoffKeyword(t, kw)`.
    // Com a lista já enxugada, quem tem de responder pelo pedido real é o PADRÃO.
    expect(matchesHandoffKeyword(PEDIDO_REAL, KEYWORDS_DEPOIS)).toBe(false);
    expect(detectHumanHandoffRequest(PEDIDO_REAL) || matchesHandoffKeyword(PEDIDO_REAL, KEYWORDS_DEPOIS)).toBe(true);

    // E o falso positivo morre nos DOIS lados do OR.
    expect(
      detectHumanHandoffRequest(RETROSPECTIVA_REAL) ||
        matchesHandoffKeyword(RETROSPECTIVA_REAL, KEYWORDS_DEPOIS),
    ).toBe(false);
  });
});

describe("cerca: a palavra SOLTA não volta aos defaults de agente novo", () => {
  // Ela era default do produto em TRÊS sítios, não escolha de um operador: todo agente
  // criado em qualquer instalação nascia com ela, e portanto com o falso positivo pronto.
  // A cerca mede o ELEMENTO do array, nunca a palavra no arquivo — os comentários dos três
  // sítios citam "atendente" de propósito, para explicar por que ela saiu.
  const SITIOS = [
    "lib/ai/agents/validation.ts",
    "app/app/ai/agents/[id]/_components/AgentForm.tsx",
    "app/app/ai/agents/[id]/_components/HandoffKeywordsInput.tsx",
  ];

  for (const rel of SITIOS) {
    it(`sem a palavra solta em ${rel}`, () => {
      const fonte = readFileSync(join(process.cwd(), rel), "utf8");
      // Os arrays de default são os que trazem "falar com humano".
      const arrays = [...fonte.matchAll(/\[([^[\]]*"falar com humano"[^[\]]*)\]/g)];
      expect(arrays.length).toBeGreaterThan(0);

      for (const [, dentro] of arrays) {
        const elementos = [...(dentro ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
        expect(elementos).not.toContain("atendente");
        // E o que sobrou continua sendo o que o detector NÃO cobre sozinho.
        expect(elementos).toContain("pessoa real");
      }
    });
  }
});

describe("detectHumanHandoffRequest: positivos", () => {
  const PEDE_PESSOA = [
    // a forma que já funcionava antes — não pode regredir
    "quero falar com um atendente",
    "quero falar com uma pessoa",
    "Quero falar com uma pessoa, por favor",
    "me passa para um atendente",
    "preciso de atendimento humano",
    "quero um atendente de verdade",
    // artigo DEFINIDO — não era reconhecido
    "quero falar com o atendente",
    "quero falar com a pessoa responsável por isso",
    "me transfere para o atendente",
    // advérbio entre o verbo e o `com` — não era reconhecido
    "preciso falar diretamente com um atendente",
    "quero falar urgentemente com uma pessoa",
    "preciso falar pessoalmente com o responsável",
    "me passa imediatamente pro comercial",
    // plural e indefinido
    "posso conversar com os atendentes?",
    "quero falar com algum consultor",
  ];

  for (const frase of PEDE_PESSOA) {
    it(`ouve: ${JSON.stringify(frase)}`, () => {
      expect(detectHumanHandoffRequest(frase)).toBe(true);
    });
  }
});

describe("detectHumanHandoffRequest: negativos", () => {
  const NAO_PEDE = [
    "",
    "   ",
    "oi",
    "bom dia, tudo bem?",
    "quanto custa a implantação?",
    // passado simples: imune por construção (o padrão exige o infinitivo colado ao `com`)
    "já conversei com o atendente, podemos continuar?",
    "falei com o atendente ontem e ficou tudo certo",
    "o atendente já me respondeu, obrigado",
    "conversamos com a pessoa do comercial na semana passada",
    // auxiliar + infinitivo: o buraco que o artigo definido abriria
    "acabei de falar com o atendente, valeu",
    "acabo de conversar com a pessoa do suporte",
    "terminei de falar com o atendente agora",
    "consegui falar com o atendente, obrigado",
    "depois de falar com o atendente ficou claro",
    "após conversar com o consultor eu decidi",
  ];

  for (const frase of NAO_PEDE) {
    it(`não ouve: ${JSON.stringify(frase)}`, () => {
      expect(detectHumanHandoffRequest(frase)).toBe(false);
    });
  }
});

describe("detectHumanHandoffRequest: retrospectiva NÃO cala o pedido da mesma mensagem", () => {
  // A razão de a guarda APAGAR O TRECHO em vez de vetar a mensagem. Um veto por
  // mensagem calaria justamente o cliente mais insatisfeito: o que já falou com
  // alguém, não resolveu, e está pedindo de novo.
  const AS_DUAS_COISAS = [
    "já falei com o atendente e não resolveu, quero falar com uma pessoa",
    "acabei de falar com o atendente mas preciso falar com o responsável",
    "consegui falar com o atendente, agora me passa pro comercial",
  ];

  for (const frase of AS_DUAS_COISAS) {
    it(`ouve o pedido ao lado do relato: ${JSON.stringify(frase)}`, () => {
      expect(detectHumanHandoffRequest(frase)).toBe(true);
    });
  }
});
