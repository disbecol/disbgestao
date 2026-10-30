# Formulários v1.7.64

Atualização das referências e alterações confirmadas em 30/10/2026.

- Tipos: Checklist, DTO, GSP, GSDPQ, GSA, GSR, Relato de anomalia, Segurança,
  5S e Outros. Modelos antigos de Auditoria e Pesquisa permanecem válidos.
- Catálogo com pesquisa, filtro de tipo e filtro de área combinados.
- Menu fixo com criação, formulários disponíveis, agendamentos e acompanhamento.
  Criar um modelo não cria mais um submódulo.
- Agendamentos quinzenais a cada 14 dias e abas Lista e Calendário.
- Avaliação de colaboradores: o gestor informa a área avaliada e seleciona
  as pessoas que pertencem à área, respeitando as unidades do formulário.
- Ao iniciar, o aplicador escolhe uma ou mais pessoas dessa lista.
- Cada pergunta pode ter uma resposta comum ao grupo ou respostas individuais.
  A pergunta individual aparece uma vez e apresenta, juntas, as respostas de
  todas as pessoas: por exemplo, João OK, Lucas NOK e José OK.
- O responsável por aplicar continua identificado separadamente dos avaliados.
- Controle de execução com aderência mensal das pessoas avaliadas, sem atribuir
  ao aplicador a nota dos outros. Registros antigos sem avaliados continuam
  disponíveis, sem avaliações retroativas inventadas.
- A evolução por pergunta abre uma tela própria, com pessoa, unidade, ano e
  botão de retorno que preserva os filtros do controle de execução.
- Perguntas do tipo Fotos e anexos opcionais nas respostas NOK. Há câmera e
  seleção de arquivo, com redução das imagens para JPEG até 1600 pixels.
- Até cinco fotos por resposta e quarenta por aplicação, em armazenamento privado.
  Os caminhos são validados no servidor e pertencem ao aplicador e ao registro.
- Fotos e notas individuais não são copiadas para outra pessoa. Perguntas comuns
  são consideradas na aderência de todos os avaliados selecionados.
- Planos individuais são associados à pergunta e à pessoa. A conclusão é auditada.
- CSV/Excel distinguem aplicador, avaliado, área, alcance e evidências. O PDF
  inclui as fotos e os resultados por pessoa, sem duplicar a mesma imagem.

Fotos exigem conexão para enviar. As respostas de texto dos rascunhos continuam
guardadas no aparelho; iniciar e finalizar exigem conexão. Não há notificações
externas ou formulários públicos nesta versão.

## Implantação

Requer a migração `supabase/80_forms_evaluated_people.sql`, depois da 79.
A migração amplia os tipos, adiciona os snapshots das pessoas avaliadas, valida
as respostas de grupo e individuais, adiciona a repetição quinzenal e cria um
bucket privado para as fotos. Não remove respostas ou formulários existentes.
Não autoriza gravação direta nas tabelas do módulo nem acesso anônimo.

A migração 80 foi autorizada e aplicada ao Supabase Disb Gestão em 30/10/2026.
A verificação posterior confirmou os avaliados, o bucket privado de fotos,
as duas políticas de acesso, a rotina de avaliação habilitada e o bloqueio do
acesso anônimo e dos helpers internos. O APK antigo não contém a nova interface.

APK: `releases/DisbGestao-1.7.64.apk`, versionCode 231. A compilação foi concluída,
a assinatura corresponde à versão anterior e os arquivos web do pacote foram
comparados ao código final, incluindo a imagem de produto atualizada no GitHub.

## Verificação

138 testes aprovados, incluindo 42 de Formulários. Os testes de banco executam
as migrações em PostgreSQL local isolado e verificam permissões, unidades,
respostas individuais/comuns, planos, periodicidade e acesso às fotos.

A interface foi exercitada com dados fictícios: criação, filtros, seleção dos
avaliados, respostas diferentes à mesma pergunta, foto individual NOK, foto
comum, finalização e calendário. A tela de evolução foi conferida separadamente.
O layout de aplicação em 390 pixels não gerou rolagem horizontal na página.
O gerador real de PDF foi executado com fotos e suas páginas renderizadas e
conferidas visualmente. Nenhum registro de teste foi criado em produção.
