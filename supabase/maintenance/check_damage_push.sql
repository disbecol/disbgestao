-- Diagnostico somente leitura das notificacoes de avarias.
-- Execute no Supabase SQL Editor e verifique se destinatarios_aptos > 0
-- na unidade em que a avaria foi registrada. Nao mostra tokens nem endpoints.

select
  u.name as unidade,
  coalesce(d.channel,'SEM_DISPOSITIVO') as canal,
  count(d.id) filter (where d.active=true) as dispositivos_ativos,
  count(d.id) filter (
    where d.active=true
      and p.active=true
      and uu.user_id is not null
      and up.allowed=true
      and (
        (d.channel='FCM' and nullif(btrim(d.fcm_token),'') is not null)
        or (d.channel='WEB' and nullif(d.subscription->>'endpoint','') is not null)
      )
  ) as destinatarios_aptos,
  max(d.last_seen_at) filter (where d.active=true) as ultimo_registro
from public.units u
left join public.push_devices d on d.unit=u.name
left join public.profiles p on p.id=d.user_id
left join public.user_units uu on uu.user_id=d.user_id and uu.unit_name=u.name
left join public.user_permissions up on up.user_id=d.user_id
  and up.permission_code='DAMAGE_NOTIFICATION'
where u.active=true
group by u.name,d.channel
order by u.name,d.channel;
