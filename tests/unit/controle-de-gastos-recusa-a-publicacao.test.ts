/**
 * A LEITURA E A FIAÇÃO do controle de gastos — o par de
 * `controle-de-gastos-exige-teto-para-publicar.test.ts`.
 *
 * Lá mora a REGRA (pura, sem banco). Aqui moram as duas coisas que a regra certa
 * não garante sozinha:
 *
 *  1. **A leitura entrega à regra o estado da organização CERTA.** Toda consulta
 *     de `conferirControleDeGastos` filtra `organization_id` explicitamente,
 *     porque ela usa o cliente ADMIN — que contorna a RLS por desenho. Sem o
 *     filtro, o teto declarado pela organização A autorizaria a publicação da B,
 *     que é o anti-pattern nº 10 do `CLAUDE.md` na forma mais silenciosa: o
 *     agente entra no ar protegido pelo dinheiro de outra empresa.
 *  2. **Os dois caminhos de publicação humana passam pela régua**, e passam
 *     ANTES do flip atômico. Régua chamada depois de publicar não é régua.
 *
 * ## ⚠️ A FALHA É ABERTA, e isso É o comportamento — não um descuido
 *
 * Erro de leitura devolve `ok: true` com a causa nomeada. É a mesma assimetria
 * de `aplicarOrcamento`: errar frouxo deixa publicar sem teto declarado (visível,
 * corrigível, e o aviso da Central o alcança); errar duro impede alguém de
 * publicar porque uma query falhou, numa VPS onde não há para quem ligar. O caso
 * abaixo existe para que ninguém "conserte" isso achando que é bug.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { conferirControleDeGastos } from "@/lib/ai/agents/controle-de-gastos";

const ORG = "aaaaaaaa-0000-4000-8000-00000000000a";
const OUTRA_ORG = "bbbbbbbb-0000-4000-8000-00000000000b";
const AGENTE = "aaaaaaaa-0000-4000-8000-00000000000c";
const VERSAO = "aaaaaaaa-0000-4000-8000-00000000000d";

interface Consulta {
  tabela: string;
  filtros: Array<[string, unknown]>;
}

/**
 * Dublê do cliente admin que REGISTRA cada filtro aplicado.
 *
 * Registrar é o ponto: "devolveu a recusa certa" e "perguntou pela organização
 * certa" são perguntas diferentes, e a segunda é a que pega vazamento entre
 * empresas. Um dublê que só devolve linhas responde a primeira e deixa a
 * segunda sem medição.
 */
function fazerAdmin(linhas: {
  ai_agents?: Record<string, unknown> | null;
  ai_agent_versions?: Record<string, unknown> | null;
  ai_budgets?: Record<string, unknown> | null;
  erroEm?: string;
}) {
  const consultas: Consulta[] = [];
  const from = (tabela: string) => {
    const registro: Consulta = { tabela, filtros: [] };
    consultas.push(registro);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (coluna: string, valor: unknown) => {
        registro.filtros.push([coluna, valor]);
        return chain;
      },
      maybeSingle: async () =>
        linhas.erroEm === tabela
          ? { data: null, error: { message: `falha simulada em ${tabela}` } }
          : { data: (linhas as Record<string, unknown>)[tabela] ?? null, error: null },
    };
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { from } as any, consultas };
}

const COM_PRECO = "claude-sonnet-5";

describe("a leitura entrega o estado da organização certa", () => {
  it("⭐ TODA consulta filtra organization_id com o valor recebido", async () => {
    const { admin, consultas } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      ai_budgets: { enforcement_mode: "bloquear", monthly_limit_cents: 5000 },
    });

    await conferirControleDeGastos(admin, { orgId: ORG, agentId: AGENTE, versionId: VERSAO });

    expect(consultas.map((c) => c.tabela)).toEqual([
      "ai_agents",
      "ai_agent_versions",
      "ai_budgets",
    ]);
    for (const c of consultas) {
      expect(
        c.filtros,
        `${c.tabela} foi consultada sem filtro de organização — o cliente admin contorna a RLS`,
      ).toContainEqual(["organization_id", ORG]);
    }
  });

  it("⭐ o teto de OUTRA organização não autoriza esta publicação", async () => {
    // O dublê devolve `null` para `ai_budgets` porque o filtro é pela ORG desta
    // publicação, e a linha com teto é da vizinha. Ausência de linha é "não
    // declarou" — e é essa leitura que a régua precisa receber.
    const { admin } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      ai_budgets: null,
    });

    const v = await conferirControleDeGastos(admin, {
      orgId: OUTRA_ORG,
      agentId: AGENTE,
      versionId: VERSAO,
    });
    expect(v.ok).toBe(false);
    expect(!v.ok && v.codigo).toBe("budget_nao_declarado");
  });

  it("o agente e a versão são consultados pelo PAR organização+id, nunca só pelo id", async () => {
    const { admin, consultas } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      ai_budgets: { enforcement_mode: "avisar", monthly_limit_cents: 100 },
    });
    await conferirControleDeGastos(admin, { orgId: ORG, agentId: AGENTE, versionId: VERSAO });

    const versao = consultas.find((c) => c.tabela === "ai_agent_versions")!;
    expect(versao.filtros).toContainEqual(["agent_id", AGENTE]);
    expect(versao.filtros).toContainEqual(["id", VERSAO]);
  });
});

describe("os desfechos da leitura", () => {
  it("linha de orçamento ausente recusa — é o estado de toda organização que nunca abriu a tela", async () => {
    // Nenhum gatilho de `organizations` semeia `ai_budgets`: ausente é o caso
    // NORMAL numa instalação nova, não uma anomalia.
    const { admin } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      ai_budgets: null,
    });
    const v = await conferirControleDeGastos(admin, {
      orgId: ORG,
      agentId: AGENTE,
      versionId: VERSAO,
    });
    expect(!v.ok && v.codigo).toBe("budget_nao_declarado");
  });

  it("enforcement_mode com valor que este build não conhece vale como 'off'", async () => {
    // Vocabulário aberto: clone que voltou de versão pode ter valor estranho na
    // coluna. `normalizarModoDeOrcamento` o rebaixa para `off`, e rebaixar para
    // "não declarou" é a direção segura — tratá-lo como declarado liberaria a
    // publicação com uma proteção que o motor não sabe aplicar.
    const { admin } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      ai_budgets: { enforcement_mode: "modo_do_futuro", monthly_limit_cents: 5000 },
    });
    const v = await conferirControleDeGastos(admin, {
      orgId: ORG,
      agentId: AGENTE,
      versionId: VERSAO,
    });
    expect(!v.ok && v.codigo).toBe("budget_nao_declarado");
  });

  it("⭐ falha de leitura NÃO recusa, e diz a causa", async () => {
    // As duas leituras anteriores precisam SUCEDER: sem elas o fluxo devolve
    // `ok: true` antes de chegar em `ai_budgets`, e o caso mediria o retorno
    // certo pelo caminho errado — foi o que a primeira versão deste teste fez.
    const { admin } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: { model: COM_PRECO },
      erroEm: "ai_budgets",
    });
    const v = await conferirControleDeGastos(admin, {
      orgId: ORG,
      agentId: AGENTE,
      versionId: VERSAO,
    });
    expect(v.ok, "query que falhou não pode impedir alguém de publicar").toBe(true);
    expect(v.naoFoiPossivelConferir).toContain("ai_budgets");
  });

  it("versão sem modelo não é assunto desta régua — quem recusa é version_not_found, antes", async () => {
    const { admin } = fazerAdmin({
      ai_agents: { operation_mode: "automatic" },
      ai_agent_versions: null,
      ai_budgets: null,
    });
    const v = await conferirControleDeGastos(admin, {
      orgId: ORG,
      agentId: AGENTE,
      versionId: VERSAO,
    });
    expect(v.ok).toBe(true);
  });
});

/**
 * FIAÇÃO — a POSIÇÃO é o defeito, e posição não se prova chamando a função.
 *
 * Mesmo argumento de `assistido-roda-as-deteccoes.test.ts`: uma régua chamada
 * DEPOIS de `publishAgentVersion` deixaria os casos de comportamento acima
 * verdes e o agente no ar. O que se vigia aqui é a ordem, nos dois caminhos.
 */
describe("fiação — a régua roda ANTES do flip, nos dois caminhos de publicação", () => {
  const CAMINHOS = [
    "app/api/v1/ai/agents/[id]/publish/route.ts",
    "app/app/ai/agents/[id]/_actions.ts",
  ];

  for (const caminho of CAMINHOS) {
    it(`${caminho} confere o controle de gastos antes de publicar`, () => {
      const fonte = readFileSync(join(process.cwd(), caminho), "utf8");
      const regua = fonte.indexOf("conferirControleDeGastos(");
      const publica = fonte.indexOf("await publishAgentVersion(");
      expect(regua, `${caminho} não chama a régua de controle de gastos`).toBeGreaterThan(-1);
      expect(publica, `${caminho} não chama publishAgentVersion`).toBeGreaterThan(-1);
      expect(
        regua,
        "a régua é chamada DEPOIS do flip atômico — o agente entra no ar antes de ser conferido",
      ).toBeLessThan(publica);
    });
  }

  it("⭐ a régua NÃO entrou em publishAgentVersion — senão o onboarding para de terminar", () => {
    // `publishAgentVersion` é chamado também pelo onboarding
    // (`first-publication.ts`), pelo preparo de prospecção e pela aplicação de
    // proposta, que são caminhos de SISTEMA. Recusar lá faria uma instalação
    // nova não conseguir terminar o wizard — exatamente o bloqueio inesperado
    // que esta mudança existe para não causar.
    const fonte = readFileSync(join(process.cwd(), "lib/ai/agents/publish.ts"), "utf8");
    expect(fonte).not.toContain("conferirControleDeGastos");
  });
});
