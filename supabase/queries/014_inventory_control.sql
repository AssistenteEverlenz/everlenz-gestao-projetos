-- Controle completo de estoque: rastreabilidade das movimentacoes, requisicoes
-- e importacao atomica de uma planilha previamente validada.
create type public.inventory_request_status as enum ('pending','approved','rejected','fulfilled','cancelled');

create table public.inventory_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0),
  purpose text not null,
  status public.inventory_request_status not null default 'pending',
  requested_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  fulfilled_by uuid references public.profiles(id),
  review_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  fulfilled_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.inventory_movements
  add column purpose text not null default '',
  add column receiver_name text,
  add column document_number text,
  add column balance_after numeric(14,3) not null default 0,
  add column request_id uuid references public.inventory_requests(id) on delete set null;

alter table public.inventory_requests enable row level security;
create policy "members read inventory requests" on public.inventory_requests for select to authenticated using (public.is_project_member(project_id));
create policy "members create inventory requests" on public.inventory_requests for insert to authenticated with check (public.is_project_member(project_id) and requested_by=auth.uid());
create policy "requesters cancel own pending requests" on public.inventory_requests for update to authenticated using (requested_by=auth.uid() and status='pending') with check (requested_by=auth.uid());
create policy "staff manage inventory requests" on public.inventory_requests for all to authenticated using (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[])) with check (public.has_project_role(project_id,array['admin','manager','engineer']::public.project_role[]));
create trigger inventory_requests_touch before update on public.inventory_requests for each row execute function public.touch_updated_at();
create index inventory_requests_project_status_idx on public.inventory_requests(project_id,status,requested_at desc);
create index inventory_movements_item_created_idx on public.inventory_movements(item_id,created_at desc);

-- Registra o saldo inicial tanto nos cadastros manuais quanto nas importacoes.
create or replace function public.record_initial_inventory_balance()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.current_quantity > 0 then
    insert into public.inventory_movements(item_id,movement_type,quantity,note,purpose,balance_after,created_by,created_at)
    values(new.id,'entry',new.current_quantity,'Saldo inicial','Saldo inicial do material',new.current_quantity,new.created_by,new.created_at);
  end if;
  return new;
end $$;
create trigger inventory_items_initial_balance after insert on public.inventory_items for each row execute function public.record_initial_inventory_balance();

insert into public.inventory_movements(item_id,movement_type,quantity,note,purpose,balance_after,created_by,created_at)
select i.id,'entry',i.current_quantity,'Saldo inicial','Saldo inicial anterior ao controle de movimentacoes',i.current_quantity,i.created_by,i.created_at
from public.inventory_items i
where i.current_quantity>0 and not exists(select 1 from public.inventory_movements m where m.item_id=i.id);

drop function if exists public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text);
create or replace function public.move_inventory(
  p_item_id uuid, p_type public.stock_movement_type, p_quantity numeric,
  p_task_id uuid default null, p_purpose text default null,
  p_receiver text default null, p_document text default null
) returns numeric language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid; v_current numeric; v_next numeric;
begin
  select project_id,current_quantity into v_project_id,v_current from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'material nao encontrado'; end if;
  if not public.has_project_role(v_project_id,array['admin','manager','engineer','foreman']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if p_quantity < 0 or (p_type <> 'adjustment' and p_quantity = 0) then raise exception 'quantidade invalida'; end if;
  if p_type='exit' and nullif(trim(p_purpose),'') is null then raise exception 'informe a finalidade da retirada'; end if;
  v_next := case when p_type='entry' then v_current+p_quantity when p_type='exit' then v_current-p_quantity else p_quantity end;
  if v_next < 0 then raise exception 'saldo insuficiente'; end if;
  update public.inventory_items set current_quantity=v_next where id=p_item_id;
  insert into public.inventory_movements(item_id,task_id,movement_type,quantity,note,purpose,receiver_name,document_number,balance_after,created_by)
  values(p_item_id,p_task_id,p_type,p_quantity,p_purpose,coalesce(nullif(trim(p_purpose),''),'Movimentacao de estoque'),nullif(trim(p_receiver),''),nullif(trim(p_document),''),v_next,auth.uid());
  if p_type='exit' and p_task_id is not null then
    update public.inventory_allocations set consumed_quantity=least(planned_quantity,consumed_quantity+p_quantity) where item_id=p_item_id and task_id=p_task_id;
  end if;
  return v_next;
end $$;

create or replace function public.transition_inventory_request(
  p_request_id uuid, p_status public.inventory_request_status,
  p_note text default null, p_receiver text default null, p_document text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_request public.inventory_requests%rowtype; v_current numeric; v_next numeric;
begin
  select * into v_request from public.inventory_requests where id=p_request_id for update;
  if not found then raise exception 'requisicao nao encontrada'; end if;
  if not public.has_project_role(v_request.project_id,array['admin','manager','engineer']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if p_status='fulfilled' and v_request.status <> 'approved' then raise exception 'aprove a requisicao antes do atendimento'; end if;
  if v_request.status in ('fulfilled','rejected','cancelled') then raise exception 'requisicao ja encerrada'; end if;
  if p_status='fulfilled' then
    select current_quantity into v_current from public.inventory_items where id=v_request.item_id for update;
    v_next := v_current-v_request.quantity;
    if v_next < 0 then raise exception 'saldo insuficiente para atender a requisicao'; end if;
    update public.inventory_items set current_quantity=v_next where id=v_request.item_id;
    update public.inventory_allocations set consumed_quantity=least(planned_quantity,consumed_quantity+v_request.quantity) where item_id=v_request.item_id and task_id=v_request.task_id;
    insert into public.inventory_movements(item_id,task_id,movement_type,quantity,note,purpose,receiver_name,document_number,balance_after,request_id,created_by)
    values(v_request.item_id,v_request.task_id,'exit',v_request.quantity,p_note,v_request.purpose,nullif(trim(p_receiver),''),nullif(trim(p_document),''),v_next,v_request.id,auth.uid());
  end if;
  update public.inventory_requests set status=p_status,review_note=nullif(trim(p_note),''),reviewed_by=case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,reviewed_at=case when p_status in ('approved','rejected') then now() else reviewed_at end,fulfilled_by=case when p_status='fulfilled' then auth.uid() else fulfilled_by end,fulfilled_at=case when p_status='fulfilled' then now() else fulfilled_at end where id=p_request_id;
end $$;

create or replace function public.import_inventory_items(p_project_id uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_row jsonb; v_item_id uuid; v_task_id uuid; v_count integer:=0;
begin
  if not public.has_project_role(p_project_id,array['admin','manager','engineer']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'nenhum material para importar'; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if exists(select 1 from public.inventory_items where project_id=p_project_id and lower(sku)=lower(v_row->>'sku')) then raise exception 'SKU % ja existe no estoque',v_row->>'sku'; end if;
    insert into public.inventory_items(project_id,name,category,sku,unit,current_quantity,minimum_quantity,lead_days,created_by)
    values(p_project_id,v_row->>'name',v_row->>'category',v_row->>'sku',v_row->>'unit',(v_row->>'quantity')::numeric,(v_row->>'minimum')::numeric,(v_row->>'leadDays')::integer,auth.uid()) returning id into v_item_id;
    for v_task_id in select (allocation->>'taskId')::uuid from jsonb_array_elements(coalesce(v_row->'allocations','[]'::jsonb)) allocation loop
      if not exists(select 1 from public.tasks where id=v_task_id and project_id=p_project_id) then raise exception 'EAP de outro projeto detectada'; end if;
      insert into public.inventory_allocations(item_id,task_id,planned_quantity) select v_item_id,v_task_id,(allocation->>'planned')::numeric from jsonb_array_elements(v_row->'allocations') allocation where (allocation->>'taskId')::uuid=v_task_id;
    end loop;
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

revoke execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text,text,text) from public,anon;
revoke execute on function public.transition_inventory_request(uuid,public.inventory_request_status,text,text,text) from public,anon;
revoke execute on function public.import_inventory_items(uuid,jsonb) from public,anon;
grant execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text,text,text) to authenticated;
grant execute on function public.transition_inventory_request(uuid,public.inventory_request_status,text,text,text) to authenticated;
grant execute on function public.import_inventory_items(uuid,jsonb) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_requests') then alter publication supabase_realtime add table public.inventory_requests; end if;
end $$;
