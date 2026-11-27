# Escala de Armazém

Disponível em **Escala → Armazém**, com calendário, funcionários, configurações, relatórios e histórico. Usa os colaboradores e vínculos de unidade do Cadastro de Equipes, sem criar perfis de acesso. A escala da Entrega permanece independente.

## Modelo da referência

- Conferentes: Roberto, Iago e Severino, ciclo editável de quatro semanas, incluindo as coberturas divididas e mudanças de turno anotadas na imagem.
- Empilhadores: ciclo de três semanas, sábado com Dantas, depois Samuel e Genilson; Alysson permanece de folga nos sábados.
- Ajudantes de armazém: turno noturno inicial de 19h às 4h, editável. Domingo mais uma folga de segunda a sábado, com distribuição semanal e equilíbrio de segundas e sábados usando o histórico salvo.
- A data inicial fica **a definir**. A indicação de uma possível segunda semana de dezembro não gera uma data confirmada. Antes da segunda-feira escolhida, o calendário mostra “Sem programação”.

## Operação

Escolha o início e revise os turnos em Configurações; salve e gere o mês no Calendário. Os sete dias da semana são exibidos juntos, inclusive na virada de mês, com opção mensal. Cada função abre e fecha separadamente e seu contador mostra as pessoas disponíveis. Disponíveis são verdes, folgas comuns vermelhas, domingos e feriados azuis.

Arrastar ou editar um nome altera somente a situação daquela pessoa no dia de destino, sem trocar com um colega. Registros fora do mês, dias bloqueados, realizados, domingos e feriados sem operação são protegidos. Rascunhos com pendências podem ser salvos; a aprovação exige resolver os erros verificados no servidor. As configurações permitem QLP mínimo por função e dia da semana, com exceções por data.

Os horários são vinculados à data de entrada; saídas de madrugada recebem “+1 dia”. A validação usa os horários registrados, seus intervalos e os limites configurados para identificar jornadas longas, descanso curto entre turnos, menos de duas folgas semanais e falta de QLP. O modelo da imagem contém coberturas com intervalo curto e jornadas de nove horas; essas situações são sinalizadas para revisão. As horas mostradas são duração efetiva dos turnos, sem cálculo de folha, adicional ou conversão de hora noturna.

Alterações de configuração não reescrevem horários históricos: cada calendário guarda a configuração usada. Novas gravações usam revisão otimista e identificador idempotente; ajustes mantêm responsável, justificativa e conteúdo anterior no histórico.

## Verificação

- Testes do motor: ciclos, folgas dos ajudantes, equilíbrio entre meses, madrugada, feriados, disponibilidade, remanejamento e proteção de registros.
- Testes React: leitura sem gravações, início indefinido, edição de horários, semana/mês, virada de mês, arrastar, permissões e recuperação de rascunho após conflito.
- Banco local com PostgreSQL/PGlite: permissões, unidade, RLS, validação dos dados, aprovação, bloqueio, histórico e reenvio idempotente.
- Revisão visual com navegador em tema claro/escuro e celular, usando dados fictícios.

Migração: `20261127182813_escala_warehouse_schedules.sql`. Cria somente as tabelas e funções do Armazém; não cadastra jornadas nem escolhe uma data inicial.
