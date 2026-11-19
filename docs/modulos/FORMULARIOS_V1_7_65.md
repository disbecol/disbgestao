# Formulários 1.7.65

Na criação do formulário, a avaliação de colaboradores pede somente a área. Ao iniciar cada aplicação, a lista é consultada no banco: pessoas ativas da área e da unidade selecionada. O aplicador escolhe a equipe daquela avaliação. O modelo deixa de manter uma lista fixa de avaliados.

Em Usuários e perfis, o campo **Área para avaliações** permite ajustar a área de cada pessoa. Quando vazio, usa o padrão do cargo: Armazém, Entrega, Puxada, Vendas ou Gestão. A migração aproveita áreas explicitamente configuradas nos modelos antigos quando existe uma única área para a pessoa. As aplicações anteriores preservam os participantes, nomes, áreas e perguntas originais.

**Formulários → Minhas avaliações** mostra resultados finalizados da pessoa conectada, com filtro por ano e formulário, histórico, respostas, observações, fotos, plano de ação em leitura, PDF, CSV e evolução mensal por pergunta em tela separada. Respostas de grupo compõem a avaliação de todos os participantes; respostas individuais compõem somente a avaliação daquela pessoa. N/A fica fora da aderência.

## Banco e privacidade

- Migração `81_forms_area_and_self_results.sql` aplicada no Supabase Disb Gestão com autorização específica.
- `FORMS_SELF_VIEW` permite consultar somente a própria avaliação.
- `my_form_evaluations` usa o usuário autenticado, sem receber ID de outro avaliado. Retorna somente respostas compartilhadas e individuais da própria pessoa, com nota recalculada e planos correspondentes.
- A RLS de `form_responses` não foi ampliada para avaliados: o registro coletivo não é entregue ao colaborador.
- Fotos permanecem no bucket privado. A leitura individual exige que o caminho esteja efetivamente referenciado em uma resposta de grupo ou da própria pessoa. Fotos dos colegas e arquivos sem vínculo não são liberados.
- Alterações de área exigem `ADMIN_USERS` e geram auditoria.
- Nenhuma contagem, formulário ou resposta de teste foi criada em produção.

## Validação

- 144 testes aprovados, incluindo 32 testes do banco de Formulários com as migrações reais 79–81.
- Casos de isolamento entre pessoas e unidades, usuário inativo, permissão revogada, anônimo, fotos privadas, rascunhos, planos individuais e preservação de históricos.
- Verificação visual no PC e em largura de celular; sem rolagem horizontal da página. Evolução por pergunta abre em tela separada.
- CSV baixado pela interface e conferido: somente a pessoa conectada, respostas e plano correspondentes.
- APK `releases/DisbGestao-1.7.65.apk`, versionCode 232, compilado com sucesso. Assinatura igual à versão anterior. Seis arquivos web do APK comparados byte a byte com os arquivos finais do repositório.

O site/PWA recebe a atualização publicada. O aplicativo Android precisa do APK 1.7.65 para mostrar as novas telas.
