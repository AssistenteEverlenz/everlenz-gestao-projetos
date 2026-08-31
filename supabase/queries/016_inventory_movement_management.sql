-- Edicao e exclusao segura de movimentacoes por administradores e gestores.
-- Toda alteracao recalcula o saldo historico e o consumo das reservas por EAP.

alter table public.inventory_movements
  add column updated_by uuid references public.profiles(id),
  add column updated_at timestamptz;

create table public.inventory_movement_audit (
  id uuid primary key default gen_random_uuid(),
  movement_id uuid not null,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  action text not null check (action in ('update','delete')),
  previous_data jsonb not null,
  changed_by uuid not null references public.profiles(id),
  changed_at timestamptz not null default now()
);

alter table public.inventory_movement_audit enable row level security;
create policy "members read movement audit" on public.inventory_movement_audit
  for select to authenticated
  using (exists(
    select 1 from public.inventory_items i
    where i.id=item_id and public.is_project_member(i.project_id)
  ));

create index inventory_movement_audit_item_idx
  on public.inventory_movement_audit(item_id,changed_at desc);

create or replace function public.recalculate_inventory_item(p_item_id uuid)
returns numeric language plpgsql security definer set search_path=''
as $$
declare
  v_balance numeric:=0;
  v_movement record;
begin
  perform 1 from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'material nao encontrado'; end if;

  for v_movement in
    select id,movement_type,quantity
    from public.inventory_movements
    where item_id=p_item_id
    order by created_at,movement_number,id
    for update
  loop
    v_balance:=case
      when v_movement.movement_type='entry' then v_balance+v_movement.quantity
      when v_movement.movement_type='exit' then v_balance-v_movement.quantity
      else v_movement.quantity
    end;
    if v_balance < 0 then
      raise exception 'a alteracao deixaria o estoque negativo no historico';
    end if;
    update public.inventory_movements set balance_after=v_balance where id=v_movement.id;
  end loop;

  update public.inventory_items set current_quantity=v_balance where id=p_item_id;
  update public.inventory_allocations allocation
  set consumed_quantity=least(
    allocation.planned_quantity,
    coalesce((
      select sum(movement.quantity)
      from public.inventory_movements movement
      where movement.item_id=p_item_id
        and movement.task_id=allocation.task_id
        and movement.movement_type='exit'
    ),0)
  )
  where allocation.item_id=p_item_id;
  return v_balance;
end $$;

create or replace function public.update_inventory_movement(
  p_movement_id uuid, p_type public.stock_movement_type, p_quantity numeric,
  p_task_id uuid default null, p_purpose text default null,
  p_receiver text default null, p_receiver_kind text default null,
  p_receiver_id uuid default null, p_document text default null
) returns numeric language plpgsql security definer set search_path=''
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_project_id uuid;
  v_valid_receiver boolean:=false;
begin
  select * into v_movement from public.inventory_movements
  where id=p_movement_id for update;
  if not found then raise exception 'movimentacao nao encontrada'; end if;
  select project_id into v_project_id from public.inventory_items
  where id=v_movement.item_id for update;
  if not public.has_project_role(v_project_id,array['admin','manager']::public.project_role[]) then raise exception 'somente administradores e gestores podem editar movimentacoes'; end if;
  if p_quantity < 0 or (p_type <> 'adjustment' and p_quantity = 0) then raise exception 'quantidade invalida'; end if;
  if p_task_id is not null and not exists(select 1 from public.tasks where id=p_task_id and project_id=v_project_id) then raise exception 'atividade de outro projeto'; end if;
  if p_type='exit' then
    if nullif(trim(p_purpose),'') is null then raise exception 'informe a finalidade da retirada'; end if;
    if p_receiver_kind='user' then v_valid_receiver:=exists(select 1 from public.project_members where project_id=v_project_id and user_id=p_receiver_id);
    elsif p_receiver_kind='team' then v_valid_receiver:=exists(select 1 from public.project_teams where project_id=v_project_id and id=p_receiver_id and active);
    elsif p_receiver_kind='worker' then v_valid_receiver:=exists(select 1 from public.project_team_members worker join public.project_teams team on team.id=worker.team_id where team.project_id=v_project_id and worker.id=p_receiver_id and worker.active and team.active);
    end if;
    if not v_valid_receiver or nullif(trim(p_receiver),'') is null then raise exception 'selecione um destinatario valido'; end if;
  end if;
  if v_movement.request_id is not null and p_type <> 'exit' then raise exception 'uma baixa originada por requisicao deve continuar como saida'; end if;

  insert into public.inventory_movement_audit(movement_id,item_id,action,previous_data,changed_by)
  values(v_movement.id,v_movement.item_id,'update',to_jsonb(v_movement),auth.uid());

  update public.inventory_movements set
    task_id=p_task_id,movement_type=p_type,quantity=p_quantity,
    note=p_purpose,purpose=coalesce(nullif(trim(p_purpose),''),'Movimentacao de estoque'),
    receiver_name=case when p_type='exit' then nullif(trim(p_receiver),'') else null end,
    receiver_kind=case when p_type='exit' then p_receiver_kind else null end,
    receiver_id=case when p_type='exit' then p_receiver_id else null end,
    document_number=nullif(trim(p_document),''),updated_by=auth.uid(),updated_at=now()
  where id=p_movement_id;

  if v_movement.request_id is not null then
    update public.inventory_requests
    set task_id=p_task_id,quantity=p_quantity,
      purpose=coalesce(nullif(trim(p_purpose),''),purpose),updated_at=now()
    where id=v_movement.request_id;
  end if;
  return public.recalculate_inventory_item(v_movement.item_id);
end $$;

create or replace function public.delete_inventory_movement(p_movement_id uuid)
returns numeric language plpgsql security definer set search_path=''
as $$
declare
  v_movement public.inventory_movements%rowtype;
  v_project_id uuid;
begin
  select * into v_movement from public.inventory_movements
  where id=p_movement_id for update;
  if not found then raise exception 'movimentacao nao encontrada'; end if;
  select project_id into v_project_id from public.inventory_items
  where id=v_movement.item_id for update;
  if not public.has_project_role(v_project_id,array['admin','manager']::public.project_role[]) then raise exception 'somente administradores e gestores podem excluir movimentacoes'; end if;

  insert into public.inventory_movement_audit(movement_id,item_id,action,previous_data,changed_by)
  values(v_movement.id,v_movement.item_id,'delete',to_jsonb(v_movement),auth.uid());

  if v_movement.request_id is not null then
    update public.inventory_requests
    set status='approved',fulfilled_by=null,fulfilled_at=null,
      review_note=coalesce(review_note,'Baixa removida por gestor'),updated_at=now()
    where id=v_movement.request_id;
  end if;
  delete from public.inventory_movements where id=p_movement_id;
  return public.recalculate_inventory_item(v_movement.item_id);
end $$;

revoke execute on function public.recalculate_inventory_item(uuid) from public,anon,authenticated;
revoke execute on function public.update_inventory_movement(uuid,public.stock_movement_type,numeric,uuid,text,text,text,uuid,text) from public,anon;
revoke execute on function public.delete_inventory_movement(uuid) from public,anon;
grant execute on function public.update_inventory_movement(uuid,public.stock_movement_type,numeric,uuid,text,text,text,uuid,text) to authenticated;
grant execute on function public.delete_inventory_movement(uuid) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_movement_audit') then
    alter publication supabase_realtime add table public.inventory_movement_audit;
  end if;
end $$;
