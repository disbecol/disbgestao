# Escala de Armazém

Disponível em **Escala → Armazém**, com calendário, funcionários, configurações, relatórios e histórico. Usa os colaboradores e vínculos de unidade do Cadastro de Equipes, sem criar perfis de acesso. A escala da Entrega permanece independente.

## Modelo da referência

- Conferentes: Roberto, Iago e Severino, ciclo editável de quatro semanas, incluindo as coberturas divididas e mudanças de turno anotadas na imagem.
- Empilhadores: ciclo de três semanas, sábado com Dantas, depois Samuel e Genilson; Alysson permanece de folga nos sábados.
- Ajudantes de armazém: turno noturno inicial de 19h às 4h, editável. Domingo mais uma folga de segunda a sábado, com distribuição semanal e equilíbrio de segundas e sábados usando o histórico salvo.
- A data inicial fica **a definir**. A indicação de uma possível segunda semana de dezembro não gera uma data confirmada. Antes da segunda-feira escolhida, o calendário mostra “Sem programação”.

## Operação

Escolha o início e revise os turnos em Configurações; salve e gere o mês no Calendário. Os sete dias da semana são exibidos juntos, inclusive na virada de mês, com opção mensal. Cada função abre e fecha separadamente e seu contador mostra as pessoas disponíveis. Disponíveis são verdes, folgas comuns vermelhas, domingos e feriados azuis.

Arrastar ou editar um nome altera somente a situação daquela pessoa no dia de destino, sem trocar com um colega. Registros fora do mês, dias bloqueados, realizados, domingos e feriados sem operação são protegidos. Rascunhos com pendências podem ser salvos; a aprovação exige resolver os erros verificados no servidor. O Armazém não configura QLP: considera todos os colaboradores conforme seus turnos, folgas, férias e afastamentos. O QLP da Entrega permanece independente.

Os horários são vinculados à data de entrada; saídas de madrugada recebem “+1 dia”. A validação usa os horários registrados, seus intervalos e os limites configurados para identificar jornadas longas, descanso curto entre turnos e menos de duas folgas semanais. O intervalo dos turnos diurnos de 06h–16h e 07h–17h foi confirmado como **12h–14h**, resultando em oito horas efetivas. Samuel inicia às 15h na sexta de cobertura após o noturno; na quarta semana, Severino folga sexta antes do sábado de manhã e Iago mantém o segundo turno na segunda. Quando a folga de ciclo coincide com feriado útil, a geração procura outro dia útil de folga, preservando a cobertura de sábado. As horas mostradas são duração efetiva dos turnos, sem cálculo de folha, adicional ou conversão de hora noturna.

Configurações mostra início, horários e ciclos; os turnos e as regras avançadas ficam recolhidos. Rascunhos do primeiro modelo são recalculados ao carregar, mantendo remanejamentos manuais, bloqueios e realizações. A nova versão abre a semana inicial cadastrada e exige salvar o rascunho revisado. A migração corretiva registra sua identificação nas observações do modelo, sem alterar a autoria obrigatória do histórico ou os calendários já salvos.

## PDFs para divulgação

Os relatórios de Entrega e Armazém oferecem **PDF para compartilhar**, com mês completo ou semana selecionada. O PDF usa A4 horizontal, nomes completos agrupados por função, sete dias lado a lado, legenda, revisão, situação de aprovação e páginas numeradas. No Armazém inclui horários e intervalos; domingos e feriados de descanso são azuis. Usa a escala exibida, inclusive quando ainda está em rascunho, sem gravar dados ao exportar. Dias de outro mês não recebem disponibilidade inventada; turnos noturnos indicam a saída no dia seguinte. Quadros maiores continuam em páginas adicionais com os mesmos cabeçalhos.

Alterações de configuração não reescrevem horários históricos: cada calendário guarda a configuração usada. Novas gravações usam revisão otimista e identificador idempotente; ajustes mantêm responsável, justificativa e conteúdo anterior no histórico.

## Verificação

- Testes do motor: ciclos, folgas dos ajudantes, equilíbrio entre meses, madrugada, feriados, disponibilidade, remanejamento e proteção de registros.
- Testes React: leitura sem gravações, início indefinido, edição de horários, semana/mês, virada de mês, arrastar, permissões e recuperação de rascunho após conflito.
- Banco local com PostgreSQL/PGlite: permissões, unidade, RLS, validação dos dados, aprovação, bloqueio, histórico e reenvio idempotente.
- Revisão visual com navegador em tema claro/escuro e celular, usando dados fictícios.

Migrações: `20261127182813_escala_warehouse_schedules.sql` cria as tabelas e funções do Armazém; `20261127194737_warehouse_rest_and_breaks_fix.sql` corrige valores reconhecidos do primeiro modelo e retira a validação de QLP do Armazém. Não escolhem uma data inicial nem alteram calendários existentes.
