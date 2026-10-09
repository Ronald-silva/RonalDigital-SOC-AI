/**
 * A EXIGÊNCIA DE CONTROLE DE GASTOS NA PUBLICAÇÃO — os quatro casos da Fase 1.1.
 *
 * ## Os dois defeitos que esta régua fecha
 *
 *  1. `ai_budgets.enforcement_mode` nasce `'off'`, então instalação nova atende
 *     cliente de verdade sem teto nenhum — `decidirOrcamento` devolve
 *     `modo_desligado` no primeiro `if` e nunca mais olha para nada.
 *  2. `costCents` devolve `null` para modelo fora da tabela de preços, e
 *     `fn_gasto_de_ia_do_mes` soma `cost_cents` — **SUM IGNORA NULL**. O gasto
 *     fica perpetuamente zero: o teto não fica impreciso, ele para de existir.
 *
 * ## O que este arquivo prende, e o que ele NÃO prende
 *
 * Aqui mora a REGRA (`decidirControleDeGastos`), que é pura e não lê banco, mais
 * o CONTRATO dos códigos de recusa. A leitura (`conferirControleDeGastos`) e a
 * fiação nos dois caminhos de publicação têm arquivo próprio
 * (`controle-de-gastos-recusa-a-publicacao.test.ts`), porque falham por motivos
 * diferentes: a regra quebra quando alguém muda a decisão; a fiação quebra
 * quando alguém acrescenta um terceiro caminho de publicação e esquece a régua.
 *
 * ## ⚠️ OS CONTROLES POSITIVOS SÃO METADE DO ARQUIVO, e não enfeite
 *
 * Uma régua de bloqueio é trivial de deixar verde: basta recusar tudo. Os casos
 * `ok: true` abaixo — teto declarado, modo assistido, preço conhecido — são o
 * que reprova quem "fortalecer" esta regra até ela impedir publicação legítima.
 * É o modo de falha mais caro dos dois: quem não consegue publicar numa VPS não
 * tem para quem ligar.
 */
import { describe, expect, it } from "vitest";

import { PISO_DE_TETO_CENTS, type ModoDeOrcamento } from "@/lib/agent-engine/edge/llm/orcamento";
import { precoDoModelo } from "@/lib/agent-engine/edge/llm/pricing";
import {
  decidirControleDeGastos,
  MENSAGEM_DA_RECUSA,
  type EstadoDoControleDeGastos,
  type ModoDeOperacao,
  type RecusaDeControleDeGastos,
} from "@/lib/ai/agents/controle-de-gastos";
import { PUBLISH_ERROR_CODES } from "@/lib/ai/agents/validation";

/**
 * Um modelo que a tabela de preços CONHECE, confirmado em execução.
 *
 * Fixar o literal sem conferir deixaria o arquivo inteiro verde por acidente no
 * dia em que este id saísse da tabela: todos os casos positivos passariam a
 * medir `modelo_sem_preco` em vez do que dizem medir.
 */
const MODELO_COM_PRECO = "claude-sonnet-5";
const MODELO_SEM_PRECO = "modelo-que-ninguem-cadastrou-9000";

function estado(over: Partial<EstadoDoControleDeGastos> = {}): EstadoDoControleDeGastos {
  return {
    modoDeOperacao: "automatic",
    modo: "bloquear",
    tetoCents: 5000,
    modelo: MODELO_COM_PRECO,
    ...over,
  };
}

describe("a precondição dos casos deste arquivo", () => {
  it("o modelo dos casos positivos TEM preço na tabela", () => {
    expect(
      precoDoModelo(MODELO_COM_PRECO),
      `${MODELO_COM_PRECO} saiu da tabela de preços — os casos positivos deste arquivo passariam a medir outra coisa`,
    ).toBeDefined();
  });

  it("o modelo dos casos negativos NÃO tem preço", () => {
    expect(precoDoModelo(MODELO_SEM_PRECO)).toBeUndefined();
  });
});

describe("CASO 1 — orçamento declarado: a publicação passa", () => {
  it("modo bloquear com teto acima do piso é liberado", () => {
    expect(decidirControleDeGastos(estado({ modo: "bloquear", tetoCents: 5000 }))).toEqual({
      ok: true,
    });
  });

  it("modo avisar também basta — a régua cobra DECLARAÇÃO, não severidade", () => {
    // `avisar` é o degrau do meio: acompanha e avisa, nunca para. Exigir
    // `bloquear` para publicar forçaria toda organização comercial ao degrau
    // mais duro, e o produto oferece os dois de propósito.
    expect(decidirControleDeGastos(estado({ modo: "avisar", tetoCents: 100 }))).toEqual({
      ok: true,
    });
  });

  it("o teto EXATAMENTE no piso passa — o piso é mínimo aceito, não mínimo recusado", () => {
    expect(decidirControleDeGastos(estado({ tetoCents: PISO_DE_TETO_CENTS }))).toEqual({
      ok: true,
    });
  });
});

describe("CASO 2 — limite não declarado ou abaixo do piso: recusa", () => {
  it("⭐ enforcement_mode 'off' recusa com budget_nao_declarado", () => {
    const v = decidirControleDeGastos(estado({ modo: "off" }));
    expect(v.ok).toBe(false);
    expect(!v.ok && v.codigo).toBe("budget_nao_declarado");
    // O piso viaja nos detalhes para a tela poder dizer o número sem recalculá-lo.
    expect(!v.ok && v.detalhes).toEqual({ piso_cents: PISO_DE_TETO_CENTS });
  });

  it("teto abaixo do piso recusa com budget_abaixo_do_piso, e diz os dois números", () => {
    const v = decidirControleDeGastos(estado({ modo: "avisar", tetoCents: 99 }));
    expect(!v.ok && v.codigo).toBe("budget_abaixo_do_piso");
    expect(!v.ok && v.detalhes).toEqual({
      piso_cents: PISO_DE_TETO_CENTS,
      teto_cents: 99,
    });
  });

  it("teto ZERO com modo armado recusa — 0 é 'sem limite', e sem limite não publica automático", () => {
    // `decidirOrcamento` trata teto 0 como `sem_teto` e SEGUE (nunca bloqueia).
    // Então uma organização em `avisar` com teto 0 tem a proteção ligada na tela
    // e desarmada no motor — é o pior estado possível, e é o que esta linha
    // impede de entrar no ar.
    const v = decidirControleDeGastos(estado({ modo: "avisar", tetoCents: 0 }));
    expect(!v.ok && v.codigo).toBe("budget_abaixo_do_piso");
  });
});

describe("CASO 3 — modelo desconhecido: recusa antes de qualquer pergunta sobre teto", () => {
  it("⭐ modelo sem preço recusa com modelo_sem_preco", () => {
    const v = decidirControleDeGastos(estado({ modelo: MODELO_SEM_PRECO }));
    expect(!v.ok && v.codigo).toBe("modelo_sem_preco");
    expect(!v.ok && v.detalhes).toEqual({ modelo: MODELO_SEM_PRECO });
  });

  it("⭐ a ORDEM importa: com os dois errados, o modelo vem primeiro", () => {
    // Declarar teto para um modelo sem preço é teatro — o teto existiria na tela
    // e não mediria nada, porque SUM ignora NULL. Pedir o teto primeiro faria a
    // pessoa configurá-lo, publicar, e seguir sem proteção achando que estava
    // protegida. É o defeito 2 com uma camada de confiança por cima.
    const v = decidirControleDeGastos(estado({ modo: "off", modelo: MODELO_SEM_PRECO }));
    expect(!v.ok && v.codigo).toBe("modelo_sem_preco");
  });

  it("⭐ o preço é cobrado TAMBÉM no modo assistido", () => {
    // O teto é dispensado no assistido (uma pessoa aprova cada mensagem), mas o
    // preço não: um modelo sem linha de preço some do gasto do mês nos dois
    // modos. Dispensar aqui deixaria o modo que o produto recomenda para o
    // primeiro mês ser justamente o que não se consegue medir.
    const v = decidirControleDeGastos(
      estado({ modoDeOperacao: "assisted", modelo: MODELO_SEM_PRECO }),
    );
    expect(!v.ok && v.codigo).toBe("modelo_sem_preco");
  });

  it("o sufixo de data do fornecedor continua casando — não é modelo desconhecido", () => {
    // `pricing.ts` tolera o sufixo; se esta régua perdesse essa tolerância, todo
    // agente pinado numa data exata viraria "modelo sem preço".
    expect(decidirControleDeGastos(estado({ modelo: "claude-sonnet-5-20260101" }))).toEqual({
      ok: true,
    });
  });
});

describe("CASO 4 — o modo assistido não é alcançado pela exigência de teto", () => {
  it("⭐ assistido sem teto declarado PUBLICA", () => {
    // Controle positivo que impede o excesso de zelo: quem só gera rascunho para
    // uma pessoa aprovar não é "operação automática comercial", e bloqueá-lo
    // tiraria do ar justamente a configuração mais segura do produto.
    expect(
      decidirControleDeGastos(estado({ modoDeOperacao: "assisted", modo: "off", tetoCents: 0 })),
    ).toEqual({ ok: true });
  });

  it("todo valor de modoDeOperacao que o banco aceita tem desfecho declarado", () => {
    // O CHECK é `operation_mode in ('automatic','assisted')`. Um terceiro valor
    // no banco sem linha aqui cairia no ramo `!== 'automatic'` e passaria calado.
    const modos: ModoDeOperacao[] = ["automatic", "assisted"];
    const desfechos = modos.map(
      (m) => decidirControleDeGastos(estado({ modoDeOperacao: m, modo: "off" })).ok,
    );
    expect(desfechos).toEqual([false, true]);
  });
});

describe("o contrato dos códigos", () => {
  const codigos: RecusaDeControleDeGastos[] = [
    "modelo_sem_preco",
    "budget_nao_declarado",
    "budget_abaixo_do_piso",
  ];

  it("⭐ os três estão em PUBLISH_ERROR_CODES — senão a rota devolve 500, não 422", () => {
    // É a diferença entre "o produto te explicou o que falta" e "deu erro".
    for (const c of codigos) {
      expect(PUBLISH_ERROR_CODES.has(c), `${c} fora de PUBLISH_ERROR_CODES`).toBe(true);
    }
  });

  it("cada código tem mensagem, e a mensagem diz ONDE resolver", () => {
    for (const c of codigos) {
      const m = MENSAGEM_DA_RECUSA[c];
      expect(m, `${c} sem mensagem`).toBeTruthy();
      // Recusa que só nega faz a pessoa clicar de novo. A mensagem tem de
      // apontar a tela — é a mesma regra do `ENSINO_POR_CODIGO` da agenda.
      expect(
        /Orçamento|Agente de IA|modelo com preço/i.test(m),
        `a mensagem de ${c} não diz onde resolver: ${m}`,
      ).toBe(true);
    }
  });

  it("todo modo de orçamento que o banco aceita tem desfecho declarado nesta régua", () => {
    const modos: ModoDeOrcamento[] = ["off", "avisar", "bloquear"];
    const desfechos = modos.map((m) => decidirControleDeGastos(estado({ modo: m })).ok);
    expect(desfechos).toEqual([false, true, true]);
  });
});
