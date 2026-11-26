# Escala individual

Destino proposto: banco do Disb Gestão no Supabase, projeto `jrsjbcdahqpcgcvzdtfb`.

## Comportamento

- Apenas duas equipes fixas por unidade, mantidas manualmente, com sábado e domingo de folga.
- Demais colaboradores da Entrega participam diretamente do sorteio individual; não precisam de vínculo com outra equipe.
- Domingo de folga para todos e uma segunda folga entre segunda e sábado.
- Em dias úteis normais, no máximo 1 motorista e 2 ajudantes de folga.
- Quem folga na semana fica disponível no sábado; quem folga no sábado fica disponível de segunda a sexta. Feriados fechados aparecem em azul e entram como descanso; não geram outra folga comum no revezamento.
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
