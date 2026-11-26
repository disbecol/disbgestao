begin;
-- Keep weekday holidays separate from the rotating weekly rest. Existing
-- calendars, approvals, actuals and audit rows are intentionally unchanged.
create or replace function escala_private.is_weekly_rest(p_unit text,p_date date,p jsonb) returns boolean
language sql stable set search_path=public,pg_temp as $$
 select p->>'mode'='REST' and (
  extract(dow from p_date)=0
  or not exists(select 1 from escala_holidays h where h.unit=p_unit and h.date=p_date and h.enabled and h.kind<>'OPTIONAL' and not h.operates)
  or extract(dow from p_date)=6 and (nullif(p->>'fixed_team_id','') is not null or coalesce((p->>'weekly_rest')::boolean,true))
 );
$$;
revoke all on function escala_private.is_weekly_rest(text,date,jsonb) from public,anon,authenticated;

do $migration$
declare source text;old_piece text;new_piece text;
begin
 source:=pg_get_functiondef('escala_private.escala_command(text,text,uuid,integer,jsonb,uuid)'::regprocedure);
 old_piece:='else coalesce((a->>''weekly_rest'')::boolean,false) end';
 new_piece:='when extract(dow from v_date) between 1 and 5 then false '||old_piece;
 if (length(source)-length(replace(source,old_piece,'')))/length(old_piece)<>1 then raise exception 'ESCALA_WEEKDAY_HOLIDAY_BASE';end if;
 execute replace(source,old_piece,new_piece);
end;
$migration$;
notify pgrst,'reload schema';
commit;
