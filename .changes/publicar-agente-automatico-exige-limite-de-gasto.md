---
impacto: exige_acao
secao: adicionado
titulo: Publicar um agente que atende sozinho passa a exigir um limite de gasto declarado
---
Antes, uma empresa podia ter a IA atendendo clientes em modo automático sem nunca ter dito quanto aceita gastar por mês: a proteção de orçamento nasce desligada, e desligada ela nem consulta o gasto. Agora o botão "Publicar" recusa um agente em modo automático enquanto o limite não estiver declarado em Uso de IA › Orçamento, e explica o que falta. O modo assistido (aquele em que uma pessoa aprova cada resposta) não é alcançado: lá o gasto é limitado por quem aprova.

Publicar também passa a recusar um agente cujo modelo não tenha preço cadastrado nesta versão do produto. O motivo não é cosmético: o gasto do mês soma os custos conhecidos, então um modelo sem preço não aparece na tela de Uso de IA e não conta para o limite — o limite para de proteger enquanto ele estiver em uso. Houve instalação em que isso rendeu 28 chamadas reais com a tela mostrando zero.

**Nada foi interrompido em quem já estava no ar.** Agente já publicado continua atendendo exatamente como antes, com ou sem limite declarado — a exigência vale a partir da próxima publicação, com uma pessoa na tela. Para esses casos aparecem dois avisos novos na Central, uma vez por dia e sem interromper nada: um quando a IA atende sozinha sem limite declarado, outro quando um modelo em uso não tem preço. O card de Orçamento já avisava que parte do gasto podia não estar sendo contada; agora a tela de Uso de IA diz, ao lado do total de custo e para o período filtrado, QUANTAS chamadas foram essas — o total continua honesto, e passa a dizer o tamanho do que falta nele.

Se a sua instalação usa um modelo que o produto ainda não conhece e você precisa republicar o agente, troque por um modelo com preço conhecido ou atualize o produto antes.

## Requer atenção

Nada para fazer no servidor: não há migration, variável de ambiente nem passo de atualização. A ação é na tela, e só para quem for **republicar** um agente que atende sozinho.

1. Abra **Uso de IA › Orçamento** de cada empresa que tem agente automático e defina o limite mensal (mínimo US$ 1,00). "Só acompanhar" já basta para publicar — não é obrigatório escolher a parada no limite.
2. Se o agente usa um modelo que esta versão não conhece, a publicação vai recusar. Troque por um modelo com preço cadastrado, ou atualize o produto antes de republicar.
3. Quem não for republicar nada não precisa fazer nada: os agentes no ar seguem atendendo. Os avisos da Central indicam onde o limite ainda não foi declarado.
