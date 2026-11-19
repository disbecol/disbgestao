# Dashboard de Avarias de Entrega

Menu: **Entrega → Avarias de Entrega → Dashboard**. Consulta apenas os registros já cadastrados no aplicativo. Não exige arquivo, importação, sincronização com Excel ou alteração do cadastro de avarias.

As oito abas compartilham período da ocorrência, motorista, cidade, tipo, motivo, status do produto e pesquisa por cliente, produto, lote ou mapa. Rankings permitem ordenar por ocorrências, itens, unidades ou caixas. O cliente abre suas ocorrências e o botão Ver usa a janela de detalhe existente.

Os gráficos de barras seguem o padrão de Devoluções: nome e valor acima de cada barra, ocupando a largura do card, com altura de 7px e azul adaptado ao tema. Nomes longos podem quebrar linha sem comprimir a barra ou o valor. O padrão é compartilhado entre produtos, cidades, motoristas, clientes e distribuições do resumo.

## Indicadores

- Resumo: ocorrências com produtos nos filtros, quantidade de itens, clientes, atendimento completo, prazo médio, itens entregues, itens em aberto e quantidades em caixas e unidades.
- Trocas e Reposições: mesmos indicadores e gráficos, restritos ao tipo. Reposição corresponde aos motivos de falta, Faltando na Grade e Não foi no caminhão. Motivos conhecidos de produto avariado são trocas. Motivos novos não são classificados por aproximação.
- Motoristas, Clientes, Produtos e Cidades: rankings, quantidades separadas por unidade, atendimento completo, prazo e ocorrências detalhadas.
- Ano a ano: mesmo intervalo de datas no ano anterior; não inventa histórico. Sem registros anteriores, mostra indisponível em vez de diferença contra zero.

Uma ocorrência é um registro de avaria, mesmo que tenha vários produtos. Atendimento completo é a proporção de ocorrências em que todos os itens válidos foram entregues. Cancelados e reprovados ficam fora do denominador; filtrar um item entregue não transforma uma ocorrência parcialmente atendida em completa. Os status são os atuais dos produtos.

O prazo usa o registro da avaria e `delivered_at`. Só entram itens entregues com ambas as datas válidas. Não equivale a prazo fiscal entre emissão de notas. Caixas e unidades não são somadas numa quantidade sem unidade. Custos em R$, HL, Ambev/Marketplace e pré-rota não estão registrados nessa base e não são estimados.

## Referência

A planilha fornecida foi lida apenas para identificar recortes e definições, sem copiar dados para o sistema nem modificar o arquivo:

`\\192.168.1.252\sdpo\DPO\Pilares\Atendimento\Fundamentos\1.0 - Qualidade\1.4\3 - DQI\2026\MATRIZ\Novo\11 - Novembro\TROCAS E REPOSIÇÕES DE PRODUTOS - 11.xlsx`

Referências observadas: VISUALIZAÇÃO E1:BF1 (Infull e lead time), TROCAS C5:W6 (entregues e ocorrências), REPOSIÇÕES E6:Q8, AxA B4:J19 e ANÁLISE POR MOTORISTA B13:BE15. Os gráficos de unidades/caixas, rankings por cliente e motorista, evolução diária e prazos orientaram a adaptação. Os valores, notas, custos e bases auxiliares do arquivo não são fonte do dashboard.

## Acesso e atualização

Reutiliza as permissões `DELIVERY_DAMAGE_VIEW_ALL`, `DELIVERY_DAMAGE_REVIEW` ou `DELIVERY_DAMAGE_POST` e as unidades autorizadas. Cadastro próprio de motorista, sozinho, não concede dashboard global. Módulo e perfil precisam estar ativos.

A função `delivery_damage_dashboard` é SECURITY INVOKER, respeita as políticas RLS existentes e retorna apenas as colunas necessárias à análise. Não retorna GPS, assinaturas ou fotos. Não escreve em avarias. Migração `20261119165503_delivery_damage_dashboard.sql`. Atualização por Realtime e consulta periódica a cada 30 segundos na tela. Falhas mostram erro, com o período da última consulta quando há dados anteriores.

Consultas de até 367 dias e 10.000 ocorrências por período. Excesso exige reduzir o intervalo, sem corte silencioso. O resultado em tela reflete os dados disponíveis na unidade; datas anteriores ao uso do aplicativo não são preenchidas pela planilha.
