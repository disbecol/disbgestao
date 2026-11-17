# Devoluções

## Atualização 1.7.91 — cadastro, monitoramento e clientes

- Cadastro/edição identifica campos manuais em âmbar e campos preenchidos pela busca em azul, com etiquetas e legenda. As cores têm contraste nos temas claro e escuro. Campos automáticos continuam permitindo correções.
- O status pode ser alterado na própria lista por usuários com RETURNS_EDIT. A mesma função de gravação registra autor, horário e histórico; a revisão atual impede sobrescrita concorrente. Falhas recarregam a decisão do servidor. Editar e Histórico ficam alinhados na coluna Ações. Não há nova migração de banco.
- Análise por clientes é a sexta aba de Acompanhamentos. Agrupa pelo código do PDV, mesmo quando clientes distintos têm o mesmo nome, com valor, HL, devoluções, dias e participação, além dos rankings e exportação CSV. Notas do mesmo cliente/mapa/dia não multiplicam a contagem de devoluções.
- Análise de motivos não repete a tabela Devoluções do período.
- Recorrência obedece ao período e demais filtros selecionados, sem limite fixo de 30 dias. O botão Ver abre apenas as ocorrências do cliente escolhido; a lista completa de ocorrências não ocupa mais a página principal.
- Validação funcional por DOM e testes de contraste CSS nos temas claro e escuro; não houve conferência visual no navegador neste ambiente. Nenhum registro real foi alterado para testes.
- Validação final: 373 testes passaram, zero falhas, incluindo contraste dos campos, permissões e concorrência na troca de status, somas por cliente e filtros/detalhamento individual da Recorrência.


## Atualização 1.7.90 — cidades, motivos e Metas

- A cidade ignora códigos de localização do pedido quando há um nome válido no cadastro. Para PDVs ainda sem cadastro, um código só é convertido quando há uma única cidade correspondente entre os clientes da mesma unidade. Nenhum código é traduzido por suposição e nenhuma base é alterada.
- Filtros e rankings agrupam variações de caixa, acentos e pontuação. Motivos conhecidos usam um nome único, incluindo a correção Cliente Canelou → Cliente cancelou. Textos originais das auditorias permanecem armazenados. Motivos com significado diferente não são aproximados automaticamente.
- Evolução diária e gráficos omitem dias com PDVs/HL em rota zerados e sem devoluções. Devoluções sem rota continuam visíveis para não ocultar inconsistências.
- Análise por cidade não repete a lista Devoluções do período. QLP contém Motoristas e Ajudantes, sem DROP ou a lista de notas repetida.
- Entrega > Devoluções > Metas possui seleção de mês e configuração dos percentuais por unidade. O Resumo não contém mais a configuração. Consulta e edição mantêm as permissões existentes (RETURNS_VIEW e RETURNS_EDIT); salvar usa a mesma função de metas, com registro de autoria e horário.
- Migração de nomes gerada pelo CLI oficial e alinhada à versão registrada pelo MCP em supabase/migrations/20261117170852_returns_city_names.sql, aplicada no projeto de produção em 17/11/2026. Apenas funções de leitura foram alteradas. MAPAS e as bases de negócio permanecem preservadas.
- Verificação de produção: todas as cidades das devoluções retornaram nomes, sem códigos nem nomes pendentes. Helper interno bloqueado para acesso anônimo e clientes; avisos do verificador de segurança permaneceram iguais aos anteriores. Suíte completa: 367 testes passaram, zero falhas. A interface foi validada por DOM/CSS; a conferência visual em navegador não estava disponível neste ambiente.


## Atualização 1.7.89 — Google Planilhas e Acompanhamentos

- Acompanhamentos reúne Resumo, Painel de devoluções, Análise por cidade, Análise por QLP e Análise de motivos em cinco abas horizontais. Recorrência e Devolução auditada continuam acessíveis separadamente. Os filtros de período são compartilhados entre as cinco visões.
- As quatro bases têm abas próprias para MATRIZ e FILIAL na mesma planilha do Google. A antiga 17.03 vazia foi identificada como 17.03 - MATRIZ; MAPAS e SYNC_MAPAS_LOG não receberam alterações de conteúdo ou formatação.
- Bases do Google substitui a importação por arquivo na interface. A leitura usa valores brutos do Google (inclusive datas), evitando interpretar o formato visual como dado. PEDIDOS permite informar cidade e vendedor junto da nota.
- Perfis com RETURNS_IMPORT e RETURNS_VIEW verificam as bases ao abrir o módulo, ao voltar à tela e a cada dois minutos enquanto a área estiver aberta. Não há agendamento quando o aplicativo está fechado. Outros perfis consultam os dados já sincronizados e continuam recebendo a auditoria em tempo real.
- Migração 88: uma única atualização por unidade, com prazo renovável; as bases validadas são publicadas juntas. Uma falha preserva todas as versões anteriores. Abas vazias não apagam dados. Uma edição válida substitui as linhas da mesma origem nos meses presentes na planilha; períodos anteriores e importações antigas de outras origens são preservados.
- Para o 17.03 diário, preencher DATA, PDVS EM ROTA e HL EM ROTA. Para o relatório original, manter seu cabeçalho na primeira linha e informar MES_REFERENCIA em AZ1 e 01/mm/aaaa em AZ2 quando o próprio relatório não contiver datas do mês.
- As auditorias, suas tratativas, os status e o histórico de alterações permanecem no banco. A sincronização das bases não modifica essas decisões.
- Migração 88 aplicada no projeto de produção em 17/11/2026, versão 20261117134509. RLS habilitado, escrita direta bloqueada e funções sem execução anônima. Nenhuma nota ou auditoria de teste foi criada. As oito abas foram conferidas pela API e pela mesma leitura JSON usada pelo aplicativo; estavam vazias, prontas para preenchimento.
- Validação da interface por DOM e CSS em temas claro/escuro e largura de celular. A atualização periódica preserva o formulário e os filtros em digitação. A conferência visual em navegador nesta atualização ficou indisponível por falha de inicialização do ambiente de automação.
- Suíte completa final: 358 testes passaram, zero falhas. Cobertura inclui a atualização atômica das bases, isolamento por unidade, preservação de períodos anteriores, alteração de origem, concorrência, interrupção da leitura e navegação pelas cinco abas.

| Base | Matriz | Filial |
| --- | --- | --- |
| Devoluções | 03.02.24 - MATRIZ (17030001) | 03.02.24 - FILIAL (17030005) |
| Pedidos | PEDIDOS - MATRIZ (17030002) | PEDIDOS - FILIAL (17030006) |
| Equipe | BASE JORNADA LIQ - MATRIZ (17030003) | BASE JORNADA LIQ - FILIAL (17030007) |
| Rota | 17.03 - MATRIZ (1816877762) | 17.03 - FILIAL (17030008) |

As seções seguintes registram a implantação inicial 1.7.88. A rotina de atualização por Google Planilhas descrita acima é a interface vigente a partir de 1.7.89.

Entrega > Devoluções reúne importação, seis visões da planilha e o acompanhamento de devoluções auditadas. A edição continua disponível depois do cadastro. A base MAPAS da conferência não deve ser alterada.

## Fontes e recortes

- Relatório 03.02.24: somente F:Y. A:E são cálculos auxiliares e não entram na importação. Campos: mapa, data de operação, UNB da nota, nota, série, UNB do cliente, código, nome, telefone, área, setor, placa, valor devolvido, volume em HL, data da devolução, código e descrição do motivo, origem do pedido, usuário e hora.
- BASE JORNADA LIQ ou a base MAPAS existente: data, mapa, motorista e dois ajudantes. Serve de associação por unidade + mapa + data, sem editar a origem.
- Planilha de monitoramento: base 030237-MAP CLI MOT, separada por Matriz/Filial, para identificar pedidos por cliente e data, nota e valor total do pedido. Serve de consulta; não substitui o relatório de devoluções. Mais de um mapa para o mesmo cliente/data exige escolha explícita.
- Aba 17.03: criada pelo usuário em 17/11/2026 na planilha indicada, gid 1816877762. Leitura somente dessa aba; MAPAS permanece intacta. Aceita a tabela DATA / PDVS EM ROTA / HL EM ROTA / UNIDADE ou o relatório original, com os indicadores 697 (PDVs com entrega) e 563 (HL de saída), por filial e colunas Dia 01…31. Nesse segundo formato o operador informa o mês. A aba 17.03 não substitui o relatório principal de devoluções.
- Cadastros existentes: cidade, nome e vendedor do cliente, respeitando a unidade.

Conferência somente de leitura no banco de produção em 17/11/2026: clientes e MAPAS não possuem coluna `unit`. Clientes são associados por código + revenda (Caicó / Pau dos Ferros). MAPAS só fornece equipe quando existe uma nota/pedido importado da unidade para aquele mapa/data, a referência é única e não há colisão com registros de outra unidade. Caso contrário, a equipe deve ser informada ou importada em BASE JORNADA LIQ, sem preencher um colaborador por suposição.

Os arquivos de referência e suas extrações ficam somente em `tmp/returns-sources/`, ignorado pelo Git. Nenhum dado real de clientes ou colaboradores é publicado no código.

## Visões de referência

| Aba azul | Conteúdo |
| --- | --- |
| RESUMO | Totais, devolução diária, percentuais PDV/HL sobre rota, metas, vendedores, dias da semana e maiores devoluções. |
| PAINEL DEVOLUÇÕES | Lista por período com data, mapa, PDV, cliente, cidade, valor, HL, motivo, vendedor e tratativa. |
| ANÁLISE POR CIDADE | Quantidade, valor, HL, participação, top cidades e detalhe da cidade selecionada. |
| ANÁLISE POR QLP | Motoristas, ajudantes e DROP, com quantidade, HL e valor. |
| RECORRÊNCIA | Clientes com ocorrências em mais de um dia no período e filtros selecionados; detalhe individual pelo botão Ver. |
| ANÁLISE MOTIVOS | Quantidade, valor, HL e participação por motivo, maiores devoluções por motivo. |

Acrescentar os indicadores do acompanhamento: aguardando repasse, devolvido, revertido, reversão sobre casos encerrados e sobre o total, comparação de motivos do motorista e do cliente. Não inferir reversão pela ausência no relatório importado.

## Regras de consistência

- Unidades e permissões são validadas no servidor, além da interface.
- Importação tem prévia e validação; nova importação não duplica notas nem altera justificativas e decisões manuais.
- Valores são acumulados em centavos; porcentagens usam totais do período, não a média de percentuais diários. Denominador ausente não vira zero.
- PDVs são contados por cliente + data + mapa, sem multiplicar por número de notas.
- Registro auditado mantém motivo do motorista, tratativa, motivo/justificativa do cliente e status. Dados desconhecidos ficam pendentes, sem preencher valores inventados.
- Edição usa revisão otimista. Uma alteração concorrente preserva o formulário local e exige recarregar o registro antes de salvar.
- Cada alteração registra autor, data e valores anteriores/novos. Não há exclusão física na interface.
- Realtime por unidade, atualização ao voltar à tela e consulta periódica de recuperação. A tela informa conexão e atualização pendente.

## Implementação e publicação

1. Análise estrutural das duas planilhas concluída; seis abas azuis identificadas.
2. Correções visuais de permissões e disponibilidade de módulos incluídas na camada de aparência.
3. Domínio/importadores em `returns.js`, leitor seletivo XLSX em `returns-file.js`, interface em `returns-ui.js` e estilos em `returns.css`. Todos são empacotados para web e Android.
4. Migração 87 preparada e testada em PostgreSQL local (PGlite): acessos por unidade, bloqueio de escrita direta, importação em lotes com publicação atômica, revisão otimista, idempotência e histórico de alterações. Nenhum dado de exemplo foi inserido em produção.
5. Interface conferida no navegador com dados fictícios, incluindo formulário preservado durante atualização, temas e largura de celular. Capturas ficam em `tmp/`.
6. A migração 87 foi aplicada no projeto Disb Gestão em 17/11/2026. Conferência em produção: RLS habilitado nas tabelas; acesso anônimo e escrita direta bloqueados; helper interno não exposto; módulo ativo, três permissões iniciais somente para ADMIN. Zero notas ou auditorias de teste criadas. Ela cria as permissões RETURNS_VIEW / RETURNS_EDIT / RETURNS_IMPORT, inicialmente para ADMIN; outros colaboradores devem recebê-las pelo cadastro de usuários, junto das unidades autorizadas. Consultar devoluções é necessário para abrir o módulo.

## Uso

1. Em Entrega > Devoluções > Bases do Google, conferir a unidade e abrir a aba correspondente. Em 03.02.24, colar os dados de F:Y em A:T, abaixo do cabeçalho. As quatro abas de cada unidade têm cabeçalhos e instruções próprios.
2. Preencher PEDIDOS para a busca por cliente/data, incluindo cidade e vendedor quando disponíveis. BASE JORNADA LIQ associa motorista e ajudantes por mapa/data. O fallback para MAPAS continua somente de leitura e exige referência inequívoca da unidade.
3. Preencher 17.03 com totais diários ou o relatório original e o mês de referência. Com a área Devoluções aberta por um perfil autorizado a atualizar bases, aguardar a verificação automática ou clicar em “Atualizar bases agora”. Erros são exibidos por aba e preservam a última base válida. Não há importação por arquivo na interface vigente.
4. Devolução auditada > Cadastrar devolução: buscar cliente/data; escolher o mapa quando houver mais de um; preencher tratativas e status. Editar e Histórico permanecem disponíveis após salvar.

As bases do Google substituem suas próprias linhas nos meses recebidos, preservando períodos anteriores e dados de outras origens. Abas totalmente vazias não excluem dados. As importações antigas por arquivo permanecem preservadas. Percentuais por rota usam a base diária da unidade e são suspensos ao filtrar cidade, motorista, motivo ou pesquisa. Metas são configuradas por mês, sem assumir as metas de novembro para outros meses.
