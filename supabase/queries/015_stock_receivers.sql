-- Destinatarios rastreaveis para retiradas e numeracao interna das movimentacoes.
create table public.project_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.project_teams(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
  role text,
  phone text,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_team_members enable row level security;
create policy "members read field workers" on public.project_team_members for select to authenticated
using (exists(select 1 from public.project_teams t where t.id=team_id and public.is_project_member(t.project_id)));
create policy "staff manage field workers" on public.project_team_members for all to authenticated
using (exists(select 1 from public.project_teams t where t.id=team_id and public.has_project_role(t.project_id,array['admin','manager','engineer']::public.project_role[])))
with check (exists(select 1 from public.project_teams t where t.id=team_id and public.has_project_role(t.project_id,array['admin','manager','engineer']::public.project_role[])));
create trigger project_team_members_touch before update on public.project_team_members for each row execute function public.touch_updated_at();
create index project_team_members_team_idx on public.project_team_members(team_id,active,name);

alter table public.inventory_movements
  add column movement_number bigint generated always as identity (start with 1001),
  add column receiver_kind text check (receiver_kind is null or receiver_kind in ('user','team','worker')),
  add column receiver_id uuid;
create unique index inventory_movements_number_idx on public.inventory_movements(movement_number);

create or replace function public.save_project_team(
  p_project_id uuid, p_team_id uuid, p_name text, p_company text,
  p_specialty text, p_contact text, p_active boolean, p_members jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_team_id uuid; v_member jsonb;
begin
  if not public.has_project_role(p_project_id,array['admin','manager','engineer']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if nullif(trim(p_name),'') is null or nullif(trim(p_company),'') is null or nullif(trim(p_specialty),'') is null then raise exception 'preencha os dados da equipe'; end if;
  if p_team_id is null then
    insert into public.project_teams(project_id,name,company,specialty,contact,active,created_by)
    values(p_project_id,trim(p_name),trim(p_company),trim(p_specialty),nullif(trim(p_contact),''),coalesce(p_active,true),auth.uid()) returning id into v_team_id;
  else
    update public.project_teams set name=trim(p_name),company=trim(p_company),specialty=trim(p_specialty),contact=nullif(trim(p_contact),''),active=coalesce(p_active,true)
    where id=p_team_id and project_id=p_project_id returning id into v_team_id;
    if v_team_id is null then raise exception 'equipe nao encontrada'; end if;
    delete from public.project_team_members where team_id=v_team_id;
  end if;
  for v_member in select * from jsonb_array_elements(coalesce(p_members,'[]'::jsonb)) loop
    if nullif(trim(v_member->>'name'),'') is null then raise exception 'nome do colaborador obrigatorio'; end if;
    insert into public.project_team_members(team_id,name,role,phone,active,created_by)
    values(v_team_id,trim(v_member->>'name'),nullif(trim(v_member->>'role'),''),nullif(trim(v_member->>'phone'),''),coalesce((v_member->>'active')::boolean,true),auth.uid());
  end loop;
  return v_team_id;
end $$;

drop function if exists public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text,text,text);
create or replace function public.move_inventory(
  p_item_id uuid, p_type public.stock_movement_type, p_quantity numeric,
  p_task_id uuid default null, p_purpose text default null,
  p_receiver text default null, p_receiver_kind text default null,
  p_receiver_id uuid default null, p_document text default null
) returns numeric language plpgsql security definer set search_path=''
as $$
declare v_project_id uuid; v_current numeric; v_next numeric; v_valid_receiver boolean:=false;
begin
  select project_id,current_quantity into v_project_id,v_current from public.inventory_items where id=p_item_id for update;
  if not found then raise exception 'material nao encontrado'; end if;
  if not public.has_project_role(v_project_id,array['admin','manager','engineer','foreman']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if p_quantity < 0 or (p_type <> 'adjustment' and p_quantity = 0) then raise exception 'quantidade invalida'; end if;
  if p_type='exit' and nullif(trim(p_purpose),'') is null then raise exception 'informe a finalidade da retirada'; end if;
  if p_type='exit' then
    if p_receiver_kind='user' then v_valid_receiver:=exists(select 1 from public.project_members where project_id=v_project_id and user_id=p_receiver_id);
    elsif p_receiver_kind='team' then v_valid_receiver:=exists(select 1 from public.project_teams where project_id=v_project_id and id=p_receiver_id and active);
    elsif p_receiver_kind='worker' then v_valid_receiver:=exists(select 1 from public.project_team_members w join public.project_teams t on t.id=w.team_id where t.project_id=v_project_id and w.id=p_receiver_id and w.active and t.active);
    end if;
    if not v_valid_receiver or nullif(trim(p_receiver),'') is null then raise exception 'selecione um destinatario valido'; end if;
  end if;
  v_next := case when p_type='entry' then v_current+p_quantity when p_type='exit' then v_current-p_quantity else p_quantity end;
  if v_next < 0 then raise exception 'saldo insuficiente'; end if;
  update public.inventory_items set current_quantity=v_next where id=p_item_id;
  insert into public.inventory_movements(item_id,task_id,movement_type,quantity,note,purpose,receiver_name,receiver_kind,receiver_id,document_number,balance_after,created_by)
  values(p_item_id,p_task_id,p_type,p_quantity,p_purpose,coalesce(nullif(trim(p_purpose),''),'Movimentacao de estoque'),nullif(trim(p_receiver),''),p_receiver_kind,p_receiver_id,nullif(trim(p_document),''),v_next,auth.uid());
  if p_type='exit' and p_task_id is not null then
    update public.inventory_allocations set consumed_quantity=least(planned_quantity,consumed_quantity+p_quantity) where item_id=p_item_id and task_id=p_task_id;
  end if;
  return v_next;
end $$;

drop function if exists public.transition_inventory_request(uuid,public.inventory_request_status,text,text,text);
create or replace function public.transition_inventory_request(
  p_request_id uuid, p_status public.inventory_request_status,
  p_note text default null, p_receiver text default null,
  p_receiver_kind text default null, p_receiver_id uuid default null,
  p_document text default null
) returns void language plpgsql security definer set search_path=''
as $$
declare v_request public.inventory_requests%rowtype; v_current numeric; v_next numeric; v_valid_receiver boolean:=false;
begin
  select * into v_request from public.inventory_requests where id=p_request_id for update;
  if not found then raise exception 'requisicao nao encontrada'; end if;
  if not public.has_project_role(v_request.project_id,array['admin','manager','engineer']::public.project_role[]) then raise exception 'sem permissao'; end if;
  if p_status='fulfilled' and v_request.status <> 'approved' then raise exception 'aprove a requisicao antes do atendimento'; end if;
  if v_request.status in ('fulfilled','rejected','cancelled') then raise exception 'requisicao ja encerrada'; end if;
  if p_status='fulfilled' then
    if p_receiver_kind='user' then v_valid_receiver:=exists(select 1 from public.project_members where project_id=v_request.project_id and user_id=p_receiver_id);
    elsif p_receiver_kind='team' then v_valid_receiver:=exists(select 1 from public.project_teams where project_id=v_request.project_id and id=p_receiver_id and active);
    elsif p_receiver_kind='worker' then v_valid_receiver:=exists(select 1 from public.project_team_members w join public.project_teams t on t.id=w.team_id where t.project_id=v_request.project_id and w.id=p_receiver_id and w.active and t.active);
    end if;
    if not v_valid_receiver or nullif(trim(p_receiver),'') is null then raise exception 'selecione um destinatario valido'; end if;
    select current_quantity into v_current from public.inventory_items where id=v_request.item_id for update;
    v_next := v_current-v_request.quantity;
    if v_next < 0 then raise exception 'saldo insuficiente para atender a requisicao'; end if;
    update public.inventory_items set current_quantity=v_next where id=v_request.item_id;
    update public.inventory_allocations set consumed_quantity=least(planned_quantity,consumed_quantity+v_request.quantity) where item_id=v_request.item_id and task_id=v_request.task_id;
    insert into public.inventory_movements(item_id,task_id,movement_type,quantity,note,purpose,receiver_name,receiver_kind,receiver_id,document_number,balance_after,request_id,created_by)
    values(v_request.item_id,v_request.task_id,'exit',v_request.quantity,p_note,v_request.purpose,nullif(trim(p_receiver),''),p_receiver_kind,p_receiver_id,nullif(trim(p_document),''),v_next,v_request.id,auth.uid());
  end if;
  update public.inventory_requests set status=p_status,review_note=nullif(trim(p_note),''),reviewed_by=case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,reviewed_at=case when p_status in ('approved','rejected') then now() else reviewed_at end,fulfilled_by=case when p_status='fulfilled' then auth.uid() else fulfilled_by end,fulfilled_at=case when p_status='fulfilled' then now() else fulfilled_at end where id=p_request_id;
end $$;

revoke execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text,text,text,uuid,text) from public,anon;
revoke execute on function public.transition_inventory_request(uuid,public.inventory_request_status,text,text,text,uuid,text) from public,anon;
revoke execute on function public.save_project_team(uuid,uuid,text,text,text,text,boolean,jsonb) from public,anon;
grant execute on function public.move_inventory(uuid,public.stock_movement_type,numeric,uuid,text,text,text,uuid,text) to authenticated;
grant execute on function public.transition_inventory_request(uuid,public.inventory_request_status,text,text,text,uuid,text) to authenticated;
grant execute on function public.save_project_team(uuid,uuid,text,text,text,text,boolean,jsonb) to authenticated;

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='project_team_members') then alter publication supabase_realtime add table public.project_team_members; end if;
end $$;
