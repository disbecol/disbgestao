# Rating de Clientes: configuração

Execute `supabase/migrations/20261126120000_rating_site_comments.sql` no SQL Editor do projeto. Ela cria as permissões e o armazenamento das tratativas; por padrão, somente administradores têm acesso. Um administrador pode conceder `RATING_VIEW` e `RATING_EDIT` aos usuários necessários.

A tela lê as abas `RATING - MATRIZ` e `RATING - FILIAL` pelo Google Planilhas, como as demais bases, e grava tratativas no Supabase, sem modificar a planilha. Não é necessário Apps Script nem Edge Function. Os links das abas ficam em **Devoluções → Bases do Google** e na tela de Rating; o acesso direto depende das permissões da planilha.

As abas precisam ter os cabeçalhos `DATA DA AVALIAÇÃO`, `CÓDIGO DO PDV`, `NOME PDV`, `CIDADE`, `MOTORISTA`, `MOTIVO` e `COMENTÁRIO` na primeira linha. Também são aceitos `Data Avaliação` e `Cod PDV`; acentos e caixa são ignorados.

Cada avaliação é identificada pela unidade, data original e código do PDV. Ordenar ou mover linhas não altera a tratativa. Linhas sem data ou código, ou com a mesma combinação duplicada, não permitem edição até a base ser corrigida. Alterar a data ou o código identifica uma avaliação diferente e não transfere automaticamente a tratativa anterior. Conflitos de edição simultânea são recusados.
