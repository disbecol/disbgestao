# Versão 1.7.107 — raio e relatórios Google

Validação em 23/11/2026. Android: versionCode 264.

## Devoluções e apontamentos

- Nova aba **Análise por raio** em Acompanhamentos: distribuição dentro/fora, justificativas, motoristas, cidades, detalhes por ocorrência e exportação CSV. Todos obedecem aos filtros aplicados.
- Ocorrência = unidade + cliente + data da rota (`operation_date`) + mapa. Várias notas somam valor/HL e contam uma vez.
- O FDR usa `report_date` como data da rota. Mapa exato vincula diretamente. Sem mapa, só vincula quando existe uma única ocorrência daquele cliente/data na base completa da unidade, antes dos filtros locais. Havendo mais de uma rota, mostra vínculo pendente. Correspondência exata prevalece sobre apontamento ambíguo.
- Sem apontamento correspondente, a ocorrência fica dentro do raio. Fonte indisponível/inativa ou falha de consulta não produz percentuais saudáveis; ausência de anotação durante uma atualização concorrente fica pendente.
- Quando há vários FDR vinculados, a ocorrência só é justificada se todos estiverem justificados. A regra aparece na interface.
- Novo Dashboard do FDR: registros fora do raio, clientes distintos, justificativas, mapas ausentes, motoristas/cidades e evolução diária. Esse painel conta apontamentos; o denominador de devoluções fica em Acompanhamentos.
- FDR: atualização a cada 30 segundos, preservando formulário aberto e filtros ainda não aplicados. Troca de unidade/sessão descarta respostas antigas.

## Banco

Migração aplicada: `20261123115457_returns_radius_analytics.sql`. Cria índice e RPC derivada `returns_radius_snapshot`, sem alterar registros existentes.

- Exige perfil ativo, `RETURNS_VIEW`, unidade autorizada e módulo Devoluções ativo.
- Não concede acesso direto ao FDR para quem tem apenas `RETURNS_VIEW`; devolve somente identificação da ocorrência, situação, justificativa booleana e quantidade de vínculos.
- `anon` sem execução; `authenticated` com execução condicionada ao guarda da função. `search_path` fixo e referências qualificadas.
- Limites: diferença entre datas até 366 dias; 15 mil linhas de relatório/20 mil apontamentos por consulta. Respeita indisponibilidade do módulo FDR.
- Após instalação: 3.530 clientes, 446 mapas, 4.744 registros de bases e 2 auditorias; FDR sem registros. Não foram criados dados de teste em produção.
- Advisors: permanece o aviso agregado de funções SECURITY DEFINER autenticadas, agora incluindo a nova RPC protegida. Sem novo acesso anônimo ou tabela exposta.

## Google Planilhas

Planilha existente `1hYle_7TyEitARZOYgYPoO5hUcxHsj0xxhTP7YCccGTM`. A aba MAPAS não recebeu alterações.

**PEDIDOS - MATRIZ / FILIAL:** layout original das 93 colunas do CSV, em A:CO, preservando a coluna vazia final do arquivo em CP para permitir colar o relatório completo. Cidade e Vendedor são fórmulas em CQ:CR. Cole somente em A:CP.

- As 3.109 linhas com pedidos foram preservadas. Há ainda uma linha antiga sem identificação de pedido, conservada no backup. O parser mantém os mesmos 3.101 pedidos válidos, valores, datas e vendedores, excluindo notas canceladas como antes.
- Cidade: referências do cadastro de clientes por unidade/código, com nomes reais. Vendedor: nota exata, depois cliente/mapa/data e por último o vendedor mais recente conhecido por cliente. Ausência de referência fica em branco.
- Referências existentes preservadas em `REF PEDIDOS`, oculta, com origem e data de atualização. São referências de 23/11/2026; as fórmulas não constituem conexão autenticada permanente entre Google e Supabase. Novos cadastros/novas atribuições de vendedor exigem atualizar essas referências. O sistema continua enriquecendo cidades pelo cadastro atual do banco.
- Backup nativo oculto da versão anterior dos Pedidos e do 17.03 da Matriz.
- Parser seleciona cabeçalhos canônicos quando Mapa/Cliente aparecem repetidos, normaliza zeros à esquerda e separadores em identificadores, utiliza Emissao e separa filiais 1/6.

**17.03 - MATRIZ:** relatório já colado pelo usuário preservado a partir de D. A:C calculadas por fórmulas a partir dos indicadores 697 (PDVs com entrega) e 563 (HL de saída), filial 1, totais sem subdivisão por GV/supervisor/vendedor. Mês em AZ2; datas conforme o número de dias do mês. A aba Filial mantém seus totais diários existentes, pois o arquivo fornecido contém apenas filial 1.

Verificação nativa + leitura GViz pelo parser real: 30 dias, 2.659 PDVs, 6.232,28 HL, iguais aos indicadores do relatório bruto. Dia 03/11: 129 PDVs e 338,54 HL. O formato diário A:C tem prioridade sobre os dados brutos em D em diante.

## Verificações

- 135 testes de Devoluções/FDR, incluindo banco isolado PGlite, permissões, múltiplas notas, mapa ausente/ambíguo, filtros, justificativas, falhas, unidade e revisão concorrente.
- 17 testes de aparência e Pedidos, em claro/escuro e 390/1280 px. Total: **152 passaram, 0 falharam**.
- CSV real de pedidos: 3.958 pedidos ativos reconhecidos sem erros; apenas leitura, sem substituir a base pela amostra.
- Google Planilhas inspecionado visualmente a 100%; corrigida herança de formato de data nas novas colunas de códigos. Fórmulas sem erros nos intervalos verificados.
- Prévia local com dados demonstrativos: navegação FDR, temas claro/escuro, barras de 7 px; sem corte interno nos cards nem overflow da página. Em largura CSS efetiva de 470 px, cards em duas colunas e abas com rolagem. Captura de imagem da prévia local indisponível no navegador; verificação feita por árvore acessível, geometria e estilos computados, além dos testes de CSS.
- APK compilado e assinado com o mesmo certificado anterior. 24 arquivos internos conferidos byte a byte; `br.com.disbecol.gestaooperacional`, versão 1.7.107/264. Não foi instalado em aparelho físico nesta validação. Push remoto Android continua desativado sem configuração Firebase, como antes.
