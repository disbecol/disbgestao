# Disb Gestão v1.7.22 — Ativo de Giro e cancelamento de avarias

## Publicação

1. Execute `supabase/53_cancelamento_avarias_entrega.sql` no SQL Editor do projeto Supabase.
2. Publique novamente a Edge Function `send-damage-receipt`, pois ela agora ignora produtos cancelados e bloqueia comprovantes de ocorrências totalmente canceladas.
3. Publique a aplicação web atualizada. Para um novo APK, gere a versão Android 1.7.22 (código 192).

O número de WhatsApp da empresa continua sem cadastro na conta de produção da Meta; essa configuração será retomada quando o site HTTPS da Disbecol estiver acessível.

## Comportamento

- Ativo de Giro: o botão **Compartilhar PDF** gera um arquivo com páginas de Pátio, Refugo e Total. As faixas de resumo numérico foram retiradas dessas páginas; a tabela de cada ativo permanece.
- Avarias de entrega: na visualização da ocorrência, **Cancelar avaria** cancela um produto. Em ocorrências com vários produtos, **Cancelar produtos não entregues** cancela todos os produtos elegíveis. O motivo é obrigatório, e o sistema registra responsável, data e status anterior.
- Avarias marcadas como **Entregue** não podem ser canceladas. Revisores podem cancelar produtos pendentes, aprovados, reprovados ou lançados. Usuários com permissão de lançamento podem cancelar os aprovados ou lançados da sua unidade.
- O cancelamento no Disb Gestão não desfaz um lançamento feito em outro sistema nem recolhe comprovantes que já tenham sido enviados.
