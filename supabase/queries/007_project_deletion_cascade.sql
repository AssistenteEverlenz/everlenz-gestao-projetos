-- Mantem a exclusao de uma obra consistente: os apontamentos pertencem
-- exclusivamente a atividade e devem acompanhar sua remocao.
alter table public.task_updates
  drop constraint if exists task_updates_task_id_fkey;

alter table public.task_updates
  add constraint task_updates_task_id_fkey
  foreign key (task_id) references public.tasks(id) on delete cascade;
