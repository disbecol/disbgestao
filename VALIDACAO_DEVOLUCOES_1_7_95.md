# Devoluções 1.7.95

## Comportamento

- Em **Bloqueios por reincidência**, a contagem usa as devoluções importadas de até 60 dias atrás, incluindo o dia do limite, como na planilha de referência. Unidade, PDV, mapa e data identificam uma ocorrência. Dez notas desse mesmo conjunto contam uma vez; seus valores, volumes e motivos continuam reunidos no botão Ver.
- Os padrões são 2 ocorrências/7 dias, 3/10, 4/20, 5/30, 6/35 e 7 ou mais/40. Os dias são configuráveis em **Metas**, por unidade, independentemente do mês das metas percentuais.
- Clientes elegíveis começam em **Bloquear**. A confirmação manual **Bloqueado** inicia o prazo no horário do servidor e congela a contagem, as notas e a penalidade usados. Alterar uma regra posteriormente não muda esse prazo.
- O servidor muda para **Liberar** ao término do prazo. O agendador executa a cada cinco minutos, mesmo com o aplicativo fechado; a consulta também atualiza os vencimentos. A confirmação **Liberado pós bloqueio** continua manual. O controle não executa bloqueios ou liberações no sistema comercial.
- O histórico conserva autoria, datas, status e penalidades. Edições concorrentes exigem recarregar; repetição da mesma operação não duplica o histórico. Uma nova ocorrência em data posterior à confirmação de liberação pode iniciar novo ciclo; registros antigos, sozinhos, não reiniciam o bloqueio.
- A recorrência por período existente é preservada. Os filtros de cidade, pesquisa e status dos bloqueios não alteram a elegibilidade calculada no servidor.
- A identificação de equipe consulta o mesmo mapa e a mesma data. Jornadas incompletas podem ser completadas por uma referência única de MAPAS vinculada à unidade. Quando o motorista estiver em uma coluna de ajudantes, ele só é movido se houver um único motorista conhecido entre os nomes. Equipes ambíguas continuam sem motorista atribuído. MAPAS permanece intacta.
- Em Acompanhamentos, Análise por Vendedor reúne valor, HL, ocorrências e participação. As tabelas com participação são ordenadas pelo maior percentual. Rankings de valor e volume preservam seus próprios critérios.
- As taxas diárias de PDV e HL usam as metas do mês da linha. Os cartões usam metas ponderadas pelos respectivos denominadores quando o período abrange meses diferentes. Igualdade é verde; excesso é vermelho. Meta ausente ou taxa sem base fica neutra. Os totais da base 17.03 são identificados como entregues no período; os valores e as fórmulas dos denominadores são preservados.
- Aguardando repasse foi retirado apenas do resumo. Os cartões são menores, com ícones em SVG, mantendo cores e contraste nos temas claro e escuro.

## Verificação

Testes de banco isolado cobrem limites de ocorrências, notas repetidas, janela temporal, confirmação manual, vencimento, regras editáveis, preservação de prazos, histórico, retries, concorrência, permissões e isolamento entre unidades. Testes de interface cobrem a navegação, preservação de formulários, confirmação de status, agrupamento no Ver, ordem de participação, metas e contraste.

As verificações de interface usam DOM e cascata CSS. O acesso ao navegador pela ferramenta de uso do computador falhou por erro de inicialização do ambiente; não foi possível fazer inspeção visual interativa nesta sessão. A assinatura, versão e arquivos web do APK são verificados separadamente.
