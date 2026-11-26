# Rating de Clientes: configuração da integração

A tela consulta as abas `RATING - MATRIZ` e `RATING - FILIAL`; somente o campo `Comentário` é atualizado. Os demais dados permanecem na planilha original.
Os links para as abas ficam em **Devoluções → Bases do Google** e também na tela de Rating, para a unidade selecionada. Abrir ou preencher diretamente no Google depende das permissões da própria planilha.

## 1. Aplicar permissões

Execute `supabase/90_rating_google.sql` no SQL Editor do projeto. Por padrão, somente administradores têm as permissões de consulta e edição; um administrador pode concedê-las aos usuários necessários na tela de permissões.

## 2. Criar o endpoint protegido da planilha

1. Crie um projeto independente em [script.google.com](https://script.google.com/) para evitar conflito com outros scripts já ligados à planilha.
2. Copie o conteúdo de `src/ratings/rating-google.gs` para o editor e salve.
3. Execute `configureRatingBridgeSecret` uma vez e autorize o acesso solicitado. Copie `RATING_BRIDGE_SECRET` do registro da execução.
4. Escolha **Implantar → Nova implantação → App da Web**, configure **Executar como: eu** e acesso **Qualquer pessoa**. O endpoint exige a chave aleatória guardada nas propriedades do script; ela fica somente nos segredos do Supabase e não é enviada ao navegador.
5. Copie o URL da implantação.

## 3. Configurar e implantar a função Supabase

Configure os dois segredos no ambiente Supabase, sem colocá-los no `config.js` nem no código do navegador:

```sh
supabase secrets set RATING_GOOGLE_SCRIPT_URL="URL_DA_IMPLANTACAO" RATING_GOOGLE_BRIDGE_SECRET="CHAVE_DO_REGISTRO_DO_APPS_SCRIPT"
supabase functions deploy rating-google
```

O navegador chama a função usando a sessão existente do sistema. Ela verifica `RATING_VIEW`/`RATING_EDIT` e o vínculo do usuário à unidade antes de encaminhar qualquer operação à planilha.
Se a função não estiver implantada, a tela não conseguirá consultar nem salvar; confira a implantação e a conectividade antes de tentar novamente. Ao alterar o Apps Script, publique uma nova versão da implantação.

## Cabeçalhos esperados

As duas abas devem ter, na primeira linha, os cabeçalhos `DATA DA AVALIAÇÃO`, `CÓDIGO DO PDV`, `NOME PDV`, `CIDADE`, `MOTORISTA`, `MOTIVO` e `COMENTÁRIO` (acentos e caixa são ignorados). Também são aceitos `Data Avaliação` e `Cod PDV`. Cada campo deve aparecer uma única vez. O restante das colunas pode permanecer como está. Se a linha for alterada entre a consulta e a gravação, a alteração é recusada e a tela deve ser atualizada antes de tentar novamente.
