# Pedidos → Pedidos fora de rota

Implementação própria baseada nos fluxos observados em https://foraderota.com/gestao/dashboard em 19/11/2026. A conta fornecida autenticou como Gestão. O navegador integrado falhou na inicialização; o levantamento usou os arquivos públicos entregues pelo site e o acesso direto às funções de autenticação e indicadores. Nenhum pedido, cliente ou usuário foi alterado no sistema de referência. Não foi possível fazer uma inspeção visual interativa nesse navegador.

## Correspondência das funções

| Referência | Disb Gestão |
| --- | --- |
| Nova solicitação comercial | Nova solicitação: Fora de rota, Bipasse e Cliente novo |
| Busca NB / nome do PDV | Código do cliente na mesma unidade, nome e cidade automáticos |
| Cliente novo | Código, nome manual e data desejada; não cria um cadastro de cliente na base |
| Data no BEES e dias de bipasse | Data desejada ou seleção de segunda a sexta |
| Motivos / observações | Lista de motivos e observações obrigatórias |
| Horários de envio | 08:30–11:30 e 14:00–16:00, Brasília; vale para todos os perfis |
| SLA | 30 minutos para Fora de rota / Cliente novo e 48 horas para Bipasse |
| Minhas solicitações | Status, filtros, detalhes, resposta e histórico do solicitante |
| Fila de pendentes | Ordem pela proporção de SLA consumido; contador de pendências |
| Assumir análise | Transição atômica de Pendente para Em análise |
| Devolver à fila | Remove o responsável e preserva o início original do SLA |
| Confirmar aprovação | Registra confirmação manual da inclusão no BEES |
| Reprovar | Motivo em lista; Outro exige texto |
| Gestão de solicitações | Consulta, filtros, paginação, exportação CSV e intervenção autorizada |
| Dashboard gerencial / painel Admin | Indicadores, status, SLA, solicitantes, analistas, motivos e tipos |
| Volume de solicitações | Visualização diária por tipo ou status, dias da semana, média diária e volume mensal |
| Análise individual de PDV | Ranking clicável e solicitações do cliente no período filtrado |
| Minha produtividade | Indicadores e resoluções do analista; datas filtram a resolução |
| Auditoria das ações | Criação, atribuição, retorno, decisão e alteração das regras; responsável e horário do servidor |
| Usuários, perfis e ativação | Usa Configurações → Usuários e perfis do Disb Gestão |
| Importação de clientes | Usa Configurações → Bases e importações; mantém unidade, GPS e contatos existentes |
| Login / sair / aparência | Usa a autenticação, saída e modos claro/escuro do Disb Gestão |

As rotas administrativas da referência não estavam no menu do perfil Gestão. Suas opções públicas foram identificadas no pacote cliente, sem acessar dados administrativos nem importar senhas. A auditoria de Pedidos cobre ações do módulo; não replica os logs de autenticação de outro aplicativo.

## Regras e operação

- O menu é Pedidos → Pedidos fora de rota → oito telas. A ativação do módulo fica em Configurações → Módulos.
- Vendedor recebe Nova solicitação e Minhas solicitações. Gerente de Vendas recebe também Consulta e Dashboard. Admin recebe todas. A permissão de Analista é concedida em Usuários e perfis; não é atribuída a conferentes ou motoristas por padrão.
- `ORDERS_REVIEW` permite assumir e decidir as próprias análises. `ORDERS_MANAGE` permite intervir nas análises de outros responsáveis. `ORDERS_AUDIT` e `ORDERS_CONFIG` são independentes.
- Cada unidade tem horários e SLAs próprios. Configurações só afetam solicitações futuras. O SLA de cada solicitação fica congelado na criação e nunca reinicia ao trocar de responsável.
- A aprovação registra o trabalho realizado pela equipe no BEES. Não existe integração automática nem envio de mensagens ao BEES/WhatsApp.
- A fila recebe eventos Realtime e atualização periódica. O restante das telas de consulta atualiza a cada 15 segundos enquanto visível. Formulários e textos em edição são preservados durante atualizações.
- Um envio precisa de conexão. Falhas preservam o preenchimento na tela atual e reutilizam a mesma chave de operação na tentativa seguinte. Não há promessa de cadastro offline ou preservação após fechar/recarregar a página neste módulo.
- CSV segue os filtros e inclui todas as linhas consultadas, não apenas a página visível. O limite de consulta é 5.000 registros; o sistema pede para reduzir o período em vez de truncar silenciosamente. Consultas de até 367 dias.

## Dados e segurança

Migração registrada: `20261119143241_orders_requests.sql`. Tabelas `order_requests`, `order_request_settings`, `order_request_audit`, `order_request_operations`. As oito funções `orders_*` exigem autenticação, perfil ativo, módulo ativo, permissão e acesso à unidade. Não aceitam solicitante ou analista forjados pelo cliente.

RLS habilitada nas quatro tabelas; sem acesso anônimo e sem escrita direta de usuários autenticados. Ações passam por RPCs guardadas, com revisão otimista, lock de linha e chave idempotente. Histórico imutável para o cliente. Não usa senha do site de referência nem copia seu código para o produto.

No banco de produção, a instalação criou zero solicitações e zero eventos de teste. As 3.530 linhas de clientes e o hash de MAPAS permaneceram idênticos ao levantamento anterior à migração. As novas permissões são específicas de Pedidos.

## Verificação

Os testes em PGlite cobrem usuários separados, unidade negada, RLS, escrita direta, anonimato, perfil/módulo inativos, SLA, horário, aprovação, reprovação, retorno à fila, versão conflitante e retry. Testes DOM cobrem oito telas, cadastro, fila, filtros, cliente, exportação e texto malicioso. Testes de cascata CSS conferem contraste de pelo menos 4,5:1 nos temas claro/escuro e larguras 390/1280 px. São verificações automatizadas; não substituem a validação visual no aparelho.

Atualização 1.7.100: o relógio da tela é sincronizado com o servidor e avança por relógio monotônico. As janelas bloqueiam todos os perfis. O formulário abre e fecha sem recarregar, preservando o preenchimento. O ranking RN/GV usa o papel do solicitante gravado na criação e respeita os filtros. Migração complementar `20261119162929_orders_strict_request_hours.sql`.
