# Checklist de implantação de cliente novo

> Documento deste fork. Os estados abaixo registram somente o que foi medido
> na instalação de referência em 2026-10-14. `Não medido` não significa
> quebrado; significa que ainda não há evidência para marcar como concluído.

Este checklist tem exatamente 10 itens e segue a ordem em que as dependências
do produto aparecem. Não registre aqui telefone, e-mail, identificador de
organização, endereço de servidor, segredo nem condição comercial do cliente.

|   # | item                   | critério para concluir                                                                                                       | estado medido                                                                                                                                                   |
| --: | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   1 | Negócio e onboarding   | nome de exibição, controlador legal, fuso, horário, regras e responsáveis conferidos pela tela                               | **Não medido**                                                                                                                                                  |
|   2 | Canal de atendimento   | canal conectado, estado operacional e envio/recebimento provados sem expor o identificador público do canal                  | **Não medido**                                                                                                                                                  |
|   3 | Equipe e distribuição  | jornada, responsáveis, modo de distribuição e política de passagem para humano conferidos em Equipe › Atendimento            | **Parcial:** jornada aplicada; os demais pontos não foram medidos                                                                                               |
|   4 | IA, modelo e orçamento | credencial validada, modelo selecionado, teto configurado e knobs de processo registrados fora do Git                        | **Parcial:** `DEEPSEEK_THINKING=disabled` aplicado no `.env.local`; `cost_cents` e contador do teto conferidos                                                  |
|   5 | Funil                  | etapas, uma saída de ganho, uma de perda, vocabulário e motivos de perda conferidos                                          | **Não medido**                                                                                                                                                  |
|   6 | Agenda                 | tipo de agendamento, duração, disponibilidade, responsáveis e local testados                                                 | **Parcial:** tipo com **Link de vídeo** aplicado; os demais pontos não foram medidos                                                                            |
|   7 | Base de conhecimento   | materiais vinculados e status de indexação `pronto` comprovado                                                               | **Pendente:** embedding da base de conhecimento                                                                                                                 |
|   8 | Agente e automações    | versão testada e publicada; follow-ups publicados e vinculados; roteador e memória conferidos quando aplicáveis              | **Não medido**                                                                                                                                                  |
|   9 | Aceite ponta a ponta   | texto, handoff, agendamento, push HTTP, imagem e áudio exercitados; latência, tokens e custo conferidos em `llm_calls`       | **Parcial:** `agent_turn` caiu de 29–157 s para 6–8 s e a saída de cerca de 4,4 mil para algumas centenas de tokens; push HTTP, imagem e áudio seguem pendentes |
|  10 | Entrega ao cliente     | perfil final aplicado, caminhos de operação ensinados, rollback registrado e funcionamento após atualização da VPS conferido | **Pendente:** adaptar `scripts/perfil-enxuto.sh` para VPS                                                                                                       |

## Regra de fechamento

Um item só muda para concluído quando o critério inteiro foi observado. Medir
uma parte mantém o estado **Parcial**; intenção, configuração presumida ou
verde de uma camada diferente não substituem a prova descrita na coluna.

As medições de desempenho e custo estão resumidas em
[`ESTADO-DO-FORK.md`](../../ESTADO-DO-FORK.md). A limitação atual do perfil de
menu está detalhada em [`perfil-enxuto.md`](perfil-enxuto.md).
