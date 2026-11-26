# Escala individual

Destino proposto: banco do Disb Gestão no Supabase, projeto `jrsjbcdahqpcgcvzdtfb`.

## Comportamento

- Apenas duas equipes fixas por unidade, mantidas manualmente, com sábado e domingo de folga.
- Demais colaboradores da Entrega participam diretamente do sorteio individual; não precisam de vínculo com outra equipe.
- Domingo de folga para todos e uma segunda folga entre segunda e sábado.
- Em dias úteis normais, no máximo 1 motorista e 2 ajudantes de folga.
- Quem folga na semana fica disponível no sábado; quem folga no sábado fica disponível de segunda a sexta. Feriados aparecem em azul e são separados do descanso semanal. O sorteio define as folgas sem direcioná-las ao feriado. A coincidência natural fica registrada e não gera duplicação de descanso.
- Equilíbrio por função, usando o histórico de segundas e sábados, com prioridade para quem teve menos privilégios.
- Troca individual de folga na mesma semana, com justificativa e validação do limite diário.
- Na visualização semanal, somente nomes: motoristas em ordem alfabética, depois ajudantes em ordem alfabética.

## Alterações do banco autorizadas

1. Acrescentar armazenamento da situação individual de cada pessoa em cada dia e distinguir as escalas individuais das antigas escalas por equipes.
2. Identificar as duas equipes fixas já mantidas manualmente; manter os antigos grupos e vínculos disponíveis para o histórico.
3. Ajustar as funções de consulta, salvamento e validação da Escala, incluindo o histórico usado nos próximos sorteios.
4. Validar no servidor os colaboradores da unidade, as duas folgas, o domingo, os limites por função, as equipes fixas, as indisponibilidades e as alterações concorrentes.
5. Manter as funções públicas com as permissões existentes e os manipuladores privilegiados no esquema privado; preservar isolamento por unidade, controle de revisão e registro de auditoria.

Não há proposta de apagar funcionários, perfis, DTOs ou históricos de escala. Rotas realizadas, escalas aprovadas e dias protegidos devem continuar preservados.

## Estado da preparação

A preparação e a aplicação da migração foram autorizadas explicitamente pelo usuário nesta conversa em 26/11/2026. O cálculo e as telas passaram nos testes unitários e de interface, nos modos claro e escuro e em telas de 1440 e 390 px. O banco local validou persistência, revisões, reenvios idempotentes, aprovação, isolamento por unidade, limites de folga e preservação de situações realizadas e dias bloqueados. A implantação usa a migração `20261126165054_escala_individual_weekly_rest.sql`.

## Regras legais conferidas em 26/11/2026

- Padrão de planejamento: 8h efetivas por dia, 1h de almoço, 40h por semana e duas folgas. Entrada às 07:00, saída às 16:00. A jornada menor não é aumentada para atingir o teto legal.
- Teto de 44h até 15/12/2026; 42h de 16/12/2026 a 15/12/2027; 40h a partir de 16/12/2027. A garantia constitucional de duas folgas passa a ser exigível em 16/12/2026. O módulo antecipa o regime 5x2 contratado, sem recriar históricos.
- Compensação normal acima de 8h exige indicação expressa e referência do instrumento coletivo, além da conferência de vigência pela gestão. O app não presume a existência de acordo. Regimes especiais e compensação mensal de repousos não são ativados automaticamente.
- Preservar 11h entre jornadas e 24h por folga, sem confundir esses intervalos. O intervalo de refeição fica fora das horas trabalhadas.
- Feriado que coincide naturalmente com descanso já definido não duplica a folga. O JSON diário registra se o descanso também corresponde à folga semanal. Trabalho em feriado continua dependendo de tratamento e autorização aplicáveis à categoria; o módulo não calcula folha nem autoriza esse trabalho por si só.
- Dois grupos fixos, domingos livres e capacidade de 1 motorista/2 ajudantes de folga útil são opções operacionais da unidade, não exigências universais da CLT.
- Migração complementar: `20261126185256_escala_clt_5x2_policy.sql`. Somente as configurações iniciais ainda não conferidas passam de 8h24/42h para 8h/40h. Calendários, aprovações, vínculos e situações realizadas são preservados.

Fontes: [EC 141/2026](https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc141.htm), [Decreto 13.173/2026](https://www2.camara.leg.br/legin/fed/decret/2026/decreto-13173-19-novembro-2026-800207-publicacaooriginal-182072-pe.html), [Portaria MTE 2.041/2026](https://www.in.gov.br/web/dou/-/portaria-mte-n-2.041-de-19-de-novembro-de-2026-745783275), [CLT](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452compilado.htm), [Lei 605/1949](https://www.planalto.gov.br/ccivil_03/leis/l0605.htm).
