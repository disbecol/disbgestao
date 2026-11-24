# Puxada integrada

Interface React do projeto isolado, executada dentro do Disb Gestão com a sessão, as unidades, o tema e as permissões do aplicativo principal. O código original do projeto isolado não é alterado por esta compilação.

Na raiz do repositório:

```sh
npm ci
npm --prefix modules/puxada ci
npm run build:puxada
npm --prefix modules/puxada test
npm run prepare:web
```

`build:puxada` valida TypeScript, compila para `src/puxada-app` e atualiza a lista de arquivos do service worker principal. `prepare:web` executa essa compilação antes de copiar os arquivos para o Android. A pasta gerada não contém credenciais ou um login próprio.

O banco existente é acessado pelo adaptador em `src/puxada/app-bridge.js`, através do gateway autenticado `pull_app_request`. A migração está em `supabase/migrations/20261123171055_puxada_isolated_integration.sql`. As tabelas operacionais, o vínculo de NRI, os IDs e as filas offline anteriores são preservados.

`functions/` contém apenas o suporte dos testes herdados do projeto isolado. Não é um serviço a publicar: o backend desta integração é o Supabase do Disb Gestão.
