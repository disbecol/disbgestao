# Revisão da Puxada — 1.7.66

Data: 04/11/2026. Versão anterior informada pela equipe: 1.7.64.

## Evidências em produção

- Checklist desativado em `pull_settings`; o gatilho de etapas respeita a opção.
- PUX-0000108: chegada ao apoio no retorno registrada pelo celular em 03/11 às 16:15:09 e recebida no servidor em 04/11 às 02:17:29 (602,3 minutos de diferença). A conclusão posterior não significa que o fluxo funcionou no momento da tentativa.
- PUX-0000109: etapas da transferência recebidas com mais de duas horas de atraso; refeição permanece aberta no servidor. O usuário relata tentativas de encerramento que não chegam a concluir.
- Na leitura inicial, cinco ciclos em andamento, nenhum motorista ativo divergente da próxima etapa e nenhuma etapa duplicada.
- Estas verificações não permitem identificar o erro exato guardado na fila privada de cada celular. Não foram alterados os horários ou o andamento dessas viagens para simular uma conclusão.

## Correções

1. Separação da fila operacional (etapas, ocorrências e checklist habilitado) dos envios de fotos, pontos de GPS e outros módulos. Uma foto sem resposta não prende o envio de uma etapa.
2. Chamadas concorrentes reaproveitam a sincronização em curso, com prazo por operação. Uma falha de rede conserva o registro e libera a interface para nova tentativa.
3. Confirmação do evento no servidor antes de remover o envelope local. Uma resposta vazia não equivale a sucesso.
4. Confirmação repetida de etapa e de encerramento de ocorrência retorna o registro já salvo, preservando identidade, horário e responsável.
5. Projeção local mantém etapas pendentes e ocorrências encerradas offline ao atualizar. Uma leitura antiga ou uma falha no catálogo não restaura o andamento anterior.
6. A fila recebe ordem crescente persistida, inclusive quando vários registros são criados no mesmo milissegundo. Falhas operacionais preservam a ordem das ações da mesma viagem.
7. Consulta atômica `pull_driver_state`, com as políticas RLS existentes, reúne viagem, etapas, ocorrências e configuração. Não depende de consultar catálogos de perfis, veículos, fotos ou NF.
8. Consulta automática enquanto a tela de viagem está aberta, a cada 12 segundos, além de atualização manual, retorno de conexão e retomada do aplicativo. A consulta não depende exclusivamente do websocket.
9. Atualização manual tenta enviar as próprias pendências antes de consultar o servidor.
10. Checklist desligado não exige carregamento de perguntas ou regras. Envelopes antigos de checklist são preservados no aparelho e ficam fora do processamento operacional enquanto a opção estiver desligada.
11. GPS ignora amostras inválidas/antigas; o rastreio em primeiro plano também tem prazo de inicialização. Uma inicialização antiga não deve manter o rastreio de uma viagem que mudou.
12. Viagem e usuário são conferidos novamente após capturar GPS, evitando atribuir um clique a outro ciclo que entrou numa recarga.
13. A renovação de autenticação recebe prazo para a resposta completa e cancelamento da requisição quando não responder, evitando reter chamadas posteriores do cliente.

## Validação

`node --test tests/*.test.mjs`: 175 testes aprovados.

Os testes novos executam o código final do aplicativo em dois contextos isolados de motorista e as funções SQL reais em PostgreSQL PGlite. Incluem ciclo de dez etapas, transferência, viagem solo, ida/retorno, perda da resposta após commit, falta de resposta, foto presa, recarga antiga, duplo clique, isolamento por usuário/unidade, checklist desligado, restauração offline, ordenação da fila, refeição iniciada/encerrada offline e nova tentativa do encerramento.

Verificação visual local: chegada avança para a etapa de troca; o outro motorista recebe o botão de registro após confirmação, sem checklist no fluxo.

APK: applicationId mantido `br.com.disbecol.gestaooperacional`; versão 1.7.66; versionCode 233; certificado com o mesmo SHA-256 da 1.7.64, permitindo atualização no lugar.

## Publicação e operação

- Aplicar `supabase/82_pull_step_delivery.sql` após a autorização específica de produção. A migração não finaliza, apaga nem muda os registros das viagens existentes e não liga o checklist.
- Publicar os arquivos web e instalar o APK 1.7.66 nos dois motoristas. Atualizar sobre a instalação existente, mantendo os dados do aplicativo; não desinstalar nem limpar o armazenamento com pendências.
- Depois de atualizar, abrir a viagem com conexão para enviar as pendências já guardadas no celular.
- O segundo celular recebe o avanço depois que a ação do primeiro efetivamente chega ao servidor. Enquanto o primeiro permanecer desconectado, o outro aparelho não tem como receber esse registro.
- O reenvio JavaScript ocorre com o aplicativo em execução e ao retomá-lo. Não se trata de uma nova tarefa Android nativa para enviar etapas com o aplicativo encerrado à força.
- A validação automatizada e a compilação não substituem a observação do primeiro ciclo nos aparelhos reais após a atualização.

## Dados preservados

Os históricos, NRIs, checklists já respondidos, anexos, configuração semanal e regras de responsabilidade das etapas são mantidos. A operação continua exigindo o encerramento das ocorrências realmente abertas e os critérios de GPS configurados.
