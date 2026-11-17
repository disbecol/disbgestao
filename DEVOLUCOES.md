# Devoluções

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
| RECORRÊNCIA | Clientes com mais de uma ocorrência em dias distintos na janela de 30 dias; detalhe de cada ocorrência. |
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

1. Em Entrega > Devoluções > Importar relatório, escolher a unidade e importar a aba 03.02.24 do arquivo de devoluções. Conferir prévia, erros e totais antes de confirmar.
2. Importar a base de pedidos 030237-MAP CLI MOT da unidade para o preenchimento por cliente/data. O diretório auxiliar RESUMO é lido apenas para os clientes desses pedidos. BASE JORNADA LIQ é opcional quando a equipe já consta de MAPAS na data exata.
3. Preencher a nova aba 17.03 do Google e usar “Ler aba 17.03 do Google”; conferir e confirmar a prévia. Nenhuma escrita é feita no Google. Também é possível importar XLSX/CSV.
4. Devolução auditada > Cadastrar devolução: buscar cliente/data; escolher o mapa quando houver mais de um; preencher tratativas e status. Editar e Histórico permanecem disponíveis após salvar.

Uma reimportação atualiza as chaves presentes no arquivo; não exclui notas ausentes. Correções que alterem a identidade da nota (data/mapa/nota/série/cliente/data e hora do retorno) exigem conciliação antes de importar para não manter a identidade anterior indevidamente. Percentuais por rota usam a base diária da unidade e são suspensos ao filtrar cidade, motorista, motivo ou pesquisa. Metas são configuradas por mês, sem assumir as metas de novembro para outros meses.
