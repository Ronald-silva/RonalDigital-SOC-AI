---
impacto: nada_mudou
secao: alterado
titulo: O Sentry passa a amostrar 5% dos traces e deixa de gravar replay de tela
---

Quem aponta o Sentry para um projeto próprio recebia 100% dos traces e a gravação de tela dos erros. Duas coisas mudaram, e nenhuma pede ação de quem opera a VPS. **Trace caiu para 5%:** num CRM com cron de minuto, trace integral é o maior multiplicador de cota do Sentry, e 5% já dimensiona latência com folga — quem precisar de mais ajusta o projeto no Sentry, não o sistema. **O replay de tela está desligado**, tanto o de sessão quanto o de erro. O replay grava a tela do CRM, e a tela do CRM mostra conversa, nome e telefone de cliente; a integração mantinha `maskAllText` e `blockAllMedia` e já evitava página com credencial na URL, mas máscara não é ausência de gravação, e num produto que processa dado de terceiro a gravação de tela entra só com decisão explícita de quem responde pelo dado. Era também o único envio que acontecia inclusive no DSN da comunidade, porque a taxa de erro não tinha condição; agora não acontece em lugar nenhum. A integração segue carregada — desligar a captura foi o que se pediu, e remover a integração mudaria o pacote entregue ao navegador sem necessidade. O zero do DSN da comunidade não muda: a política de lá é dela.
