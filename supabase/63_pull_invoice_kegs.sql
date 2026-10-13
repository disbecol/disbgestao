-- DANFE de chopp informa litros; os NRIs contam barris.
begin;

alter table public.products add column if not exists invoice_liters_per_unit integer;
alter table public.products drop constraint if exists products_invoice_unit_valid;
alter table public.products add constraint products_invoice_unit_valid
  check (invoice_unit is null or invoice_unit in ('CX','DZ','UN','L'));
alter table public.products drop constraint if exists products_invoice_liters_valid;
alter table public.products add constraint products_invoice_liters_valid
  check ((invoice_unit='L' and invoice_liters_per_unit is not null and invoice_liters_per_unit>0)
    or (invoice_unit is distinct from 'L' and invoice_liters_per_unit is null));

-- A capacidade antiga foi importada em litros (360 L/800 L).
-- O novo valor representa barris por palete, preservando ajustes manuais diferentes.
update public.products set invoice_unit='L',invoice_liters_per_unit=30,
  commercial_units_per_pallet=case when commercial_units_per_pallet=360 then 12 else commercial_units_per_pallet end,
  updated_at=now()
where code='828';
update public.products set invoice_unit='L',invoice_liters_per_unit=50,
  commercial_units_per_pallet=case when commercial_units_per_pallet=800 then 16 else commercial_units_per_pallet end,
  updated_at=now()
where code='838';

create or replace function public.pull_invoice_items(p_lines jsonb,p_origin_unit text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_product public.products%rowtype; v_line record; v_items jsonb:='[]'::jsonb;
  v_seen text[]:='{}'; v_count integer:=0; v_quantity numeric; v_unit text;
begin
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>500 then
    raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  for v_line in
    select upper(btrim(x.reference_code)) as reference_code,
      case when upper(btrim(x.commercial_unit))='LT' then 'L' else upper(btrim(x.commercial_unit)) end as commercial_unit,
      sum(x.quantity) as quantity
    from jsonb_to_recordset(p_lines) as x(reference_code text,commercial_unit text,quantity numeric)
    group by upper(btrim(x.reference_code)),
      case when upper(btrim(x.commercial_unit))='LT' then 'L' else upper(btrim(x.commercial_unit)) end
  loop
    if v_line.reference_code is null or v_line.reference_code='' or v_line.commercial_unit is null
      or v_line.commercial_unit not in ('CX','DZ','UN','UND','UNID','UNIDADE','DUZIA','DÚZIA','CAIXA','L')
      or v_line.quantity is null or v_line.quantity<=0 or v_line.quantity<>trunc(v_line.quantity)
      then raise exception 'ITEM_NOTA_INVALIDO'; end if;
    if v_line.reference_code=any(v_seen) then raise exception 'UNIDADES_DIFERENTES_NA_NOTA: %',v_line.reference_code; end if;
    v_seen:=array_append(v_seen,v_line.reference_code);
    select * into v_product from public.products where
      upper(case when p_origin_unit='Filial Pau dos Ferros' then nf_reference_code_filial else nf_reference_code end)=v_line.reference_code
      and active=true;
    if v_product.code is null then raise exception 'REFERENCIA_NF_NAO_CADASTRADA: %',v_line.reference_code; end if;
    if coalesce(v_product.commercial_units_per_pallet,0)<1 then raise exception 'PALETE_NAO_CADASTRADO: %',v_product.code; end if;
    if v_product.invoice_unit is not null and v_product.invoice_unit<>v_line.commercial_unit then
      raise exception 'UNIDADE_NOTA_DIVERGENTE: %',v_product.code; end if;
    v_quantity:=v_line.quantity;
    v_unit:=v_line.commercial_unit;
    if v_unit='L' then
      if v_product.invoice_unit<>'L' or coalesce(v_product.invoice_liters_per_unit,0)<1 then
        raise exception 'LITROS_POR_BARRIL_NAO_CADASTRADOS: %',v_product.code; end if;
      if mod(v_quantity,v_product.invoice_liters_per_unit)<>0 then
        raise exception 'LITROS_NAO_FORMAM_BARRIS_INTEIROS: %',v_product.code; end if;
      v_quantity:=v_quantity/v_product.invoice_liters_per_unit;
      v_unit:='UN';
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object(
      'reference_code',v_line.reference_code,'commercial_unit',v_unit,
      'quantity',v_quantity,'product_code',v_product.code,'product_name',v_product.name,
      'commercial_units_per_pallet',v_product.commercial_units_per_pallet,
      'full_pallets',trunc(v_quantity/v_product.commercial_units_per_pallet),
      'remaining_units',mod(v_quantity,v_product.commercial_units_per_pallet),
      'source_unit',case when v_line.commercial_unit='L' then 'L' else null end,
      'source_quantity',case when v_line.commercial_unit='L' then v_line.quantity else null end,
      'liters_per_unit',case when v_line.commercial_unit='L' then v_product.invoice_liters_per_unit else null end));
    v_count:=v_count+1;
  end loop;
  if v_count<1 then raise exception 'ITENS_NOTA_INVALIDOS'; end if;
  return v_items;
end;$$;
revoke all on function public.pull_invoice_items(jsonb,text) from public,anon,authenticated;

commit;
