-- Limpeza pontual de dados operacionais de um usuario.
-- Execute no Supabase SQL Editor apenas depois de revisar a PREVIA.
-- Por padrao, v_execute=false: o script mostra contagens e nao apaga nada.
-- Para executar, troque v_execute para true nesta copia revisada.
--
-- Preserva perfil, permissoes, unidades, cadastros compartilhados, estoque,
-- movimentos de materiais, tokens/dispositivos push, recibos de sincronizacao
-- offline e revisoes feitas pelo usuario em avarias de outras pessoas.
-- Fotos do Storage nao sao apagadas; exporte-as antes de uma limpeza definitiva.

begin;

do $$
declare
  v_account text := 'marcelo';
  v_execute boolean := false;
  v_uid uuid;
  v_matches integer;
begin
  select count(*) into v_matches
  from public.profiles
  where lower(btrim(coalesce(name,'')))=lower(v_account)
     or lower(btrim(coalesce(username,'')))=lower(v_account);

  if v_matches<>1 then
    raise exception 'Esperado exatamente 1 perfil para "%"; encontrados %.', v_account, v_matches;
  end if;

  select id into v_uid from public.profiles
  where lower(btrim(coalesce(name,'')))=lower(v_account)
     or lower(btrim(coalesce(username,'')))=lower(v_account)
  limit 1;

  -- Um registro de outro autor impede a exclusao em cascata do seu pai.
  create temp table _cleanup_nri_requests on commit drop as
  select r.id from public.nri_requests r
  where r.created_by=v_uid
    and not exists (
      select 1 from public.nris n
      where n.request_id=r.id and n.created_by is distinct from v_uid
    )
    and not exists (
      select 1 from public.nri_damage_items d
      where d.request_id=r.id and d.created_by is distinct from v_uid
    );

  create temp table _cleanup_damage_requests on commit drop as
  select r.id from public.damage_requests r
  where r.created_by=v_uid and r.delivery_user_id=v_uid;

  create temp table _cleanup_sales_damage_requests on commit drop as
  select r.id from public.sales_damage_requests r
  where r.created_by=v_uid and r.seller_id=v_uid;

  create temp table _cleanup_fefo_counts on commit drop as
  select c.id from public.fefo_counts c
  where c.counter_id=v_uid
    and not exists (
      select 1 from public.fefo_count_items i
      where i.count_id=c.id and i.created_by<>v_uid
    );

  create temp table _cleanup_rotating_counts on commit drop as
  select c.id from public.rotating_asset_counts c
  where c.counter_id=v_uid
    and not exists (
      select 1 from public.rotating_asset_entries e
      where e.count_id=c.id and e.created_by<>v_uid
    );

  create temp table _cleanup_rotating_entries on commit drop as
  select e.id from public.rotating_asset_entries e
  where e.created_by=v_uid
     or e.count_id in (select id from _cleanup_rotating_counts);

  create temp table _cleanup_marketplace_receipts on commit drop as
  select r.id from public.marketplace_receipts r
  where r.checker_id=v_uid
    and not exists (
      select 1 from public.nri_requests n
      where n.marketplace_receipt_id=r.id
        and n.id not in (select id from _cleanup_nri_requests)
    );

  -- Viagens com outro motorista sao compartilhadas e permanecem.
  -- Na viagem solo, driver2_id aponta para o proprio driver1_id.
  create temp table _cleanup_pull_trips on commit drop as
  select t.id from public.pull_trips t
  where t.driver1_id=v_uid and t.solo_trip=true and t.driver2_id=v_uid
    and not exists (
      select 1 from public.nri_requests n
      where n.pull_trip_id=t.id
        and n.id not in (select id from _cleanup_nri_requests)
    );

  -- O inventario pode ter gerado ajustes no estoque. Esses casos ficam
  -- preservados para nao perder a origem contabil dos movimentos.
  create temp table _cleanup_material_counts on commit drop as
  select c.id from public.material_inventory_counts c
  where c.counter_id=v_uid
    and not exists (
      select 1 from public.material_movements m
      where m.origin_type='INVENTORY' and m.origin_id=c.id
    );

  raise notice 'PREVIA para % (id %):', v_account, v_uid;
  raise notice 'NRI requisicoes: %', (select count(*) from _cleanup_nri_requests);
  raise notice 'NRIs do usuario: %', (select count(*) from public.nris where created_by=v_uid);
  raise notice 'Avarias entrega: %', (select count(*) from _cleanup_damage_requests);
  raise notice 'Avarias vendas: %', (select count(*) from _cleanup_sales_damage_requests);
  raise notice 'Contagens FEFO: %', (select count(*) from _cleanup_fefo_counts);
  raise notice 'Contagens Ativo de Giro: %', (select count(*) from _cleanup_rotating_counts);
  raise notice 'Entradas Ativo de Giro: %', (select count(*) from _cleanup_rotating_entries);
  raise notice 'Recebimentos Marketplace: %', (select count(*) from _cleanup_marketplace_receipts);
  raise notice 'Viagens solo Puxada/Transferencia: %', (select count(*) from _cleanup_pull_trips);
  raise notice 'Conferencias de vasilhames: %', (select count(*) from public.container_conferences where checker_id=v_uid);
  raise notice 'Inventarios de Materiais sem ajuste de estoque: %', (select count(*) from _cleanup_material_counts);
  raise notice 'Inventarios de Materiais preservados por ajuste: %',
    (select count(*) from public.material_inventory_counts c
     where c.counter_id=v_uid and c.id not in (select id from _cleanup_material_counts));
  raise notice 'Viagens compartilhadas preservadas: %',
    (select count(*) from public.pull_trips t
     where t.driver1_id=v_uid and t.id not in (select id from _cleanup_pull_trips));

  if not v_execute then
    raise notice 'MODO PREVIA: nenhuma linha foi apagada. Para executar, altere v_execute para true.';
    return;
  end if;

  -- Filhos sem FK de cascata sao apagados antes dos pais.
  delete from public.rotating_asset_entry_audit
  where entry_id in (select id from _cleanup_rotating_entries)
     or count_id in (select id from _cleanup_rotating_counts);

  delete from public.rotating_asset_entries
  where id in (select id from _cleanup_rotating_entries);
  delete from public.rotating_asset_counts
  where id in (select id from _cleanup_rotating_counts);

  delete from public.fefo_count_items
  where created_by=v_uid or count_id in (select id from _cleanup_fefo_counts);
  delete from public.fefo_counts
  where id in (select id from _cleanup_fefo_counts);

  -- Fotos NRI sao removidas por ON DELETE CASCADE dos itens.
  delete from public.nri_damage_items
  where created_by=v_uid or request_id in (select id from _cleanup_nri_requests);
  delete from public.nris where created_by=v_uid;
  delete from public.nri_requests
  where id in (select id from _cleanup_nri_requests);

  -- Itens/fotos de avarias sao removidos pelas FKs ON DELETE CASCADE.
  delete from public.damage_requests
  where id in (select id from _cleanup_damage_requests);
  delete from public.sales_damage_requests
  where id in (select id from _cleanup_sales_damage_requests);

  delete from public.marketplace_receipts
  where id in (select id from _cleanup_marketplace_receipts);
  -- Eventos, ocorrencias, trilha GPS e tokens da viagem usam CASCADE.
  delete from public.pull_trips
  where id in (select id from _cleanup_pull_trips);

  -- Itens e identificadores do inventario usam CASCADE. Saldo, cadastro e
  -- historico de movimentos dos materiais permanecem intactos.
  delete from public.material_inventory_counts
  where id in (select id from _cleanup_material_counts);

  delete from public.container_conferences where checker_id=v_uid;
  delete from public.print_events where user_id=v_uid;

  raise notice 'Limpeza concluida para % (%).', v_account, v_uid;
end
$$;

commit;
