---
impacto: nada_mudou
secao: corrigido
titulo: Quem diz que já falou com o atendente volta a ser atendido pela IA, em vez de ser transferido de novo
---

A detecção automática de "quero falar com uma pessoa" não reconhecia duas formas muito comuns: o advérbio entre o verbo e o complemento ("preciso falar **diretamente** com um atendente") e o artigo definido ("quero falar com **o** atendente"). Quem configurava o agente contornava isso pondo a palavra solta `atendente` no campo de palavras de passagem — e aí o cliente que escrevia "já conversei com o atendente, podemos continuar?" era transferido outra vez, recebendo o aviso de transferência no lugar da resposta. Agora o advérbio, o artigo (definido, indefinido e plural) e o plural do alvo são reconhecidos sozinhos, e um trecho em que o contato com a pessoa **já aconteceu** ("acabei de falar com o atendente") não conta como pedido — mas um pedido na mesma mensagem ("já falei com o atendente e não resolveu, quero falar com uma pessoa") continua contando. Agente **novo** também não recebe mais a palavra solta `atendente` entre as palavras sugeridas, porque ela não é mais necessária para o pedido ser ouvido. Nada precisa ser feito ao atualizar, e nenhuma configuração existente é reescrita: quem já tem a palavra solta gravada continua com ela, e pode removê-la em IA › Agentes quando quiser, deixando só as expressões.
