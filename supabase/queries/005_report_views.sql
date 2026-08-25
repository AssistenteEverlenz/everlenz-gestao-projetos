-- Consultas consolidadas usadas pelo Status Report.
create or replace view public.daily_report_feed
with (security_invoker = true)
as
select
  d.project_id, d.log_date, d.id as daily_log_id, u.id as update_id, u.task_id,
  t.wbs, t.name as task_name, t.phase, u.title, u.description,
  u.progress_before, u.progress_delta, u.progress_after, u.crew_count,
  u.weather, u.created_at, p.full_name as author_name,
  coalesce(
    jsonb_agg(jsonb_build_object(
      'id', ph.id, 'storage_path', ph.storage_path, 'caption', ph.caption,
      'taken_at', ph.taken_at, 'sort_order', ph.sort_order
    ) order by ph.sort_order) filter (where ph.id is not null),
    '[]'::jsonb
  ) as photos
from public.daily_logs d
join public.task_updates u on u.daily_log_id = d.id
join public.tasks t on t.id = u.task_id
join public.profiles p on p.id = u.created_by
left join public.update_photos ph on ph.update_id = u.id
group by d.project_id, d.log_date, d.id, u.id, t.wbs, t.name, t.phase, p.full_name;

create or replace view public.project_gantt
with (security_invoker = true)
as
select
  t.*, parent.wbs as parent_wbs, parent.name as parent_name,
  pred.wbs as predecessor_wbs, dep.dependency_type, dep.lag_days,
  responsible.full_name as responsible_name
from public.tasks t
left join public.tasks parent on parent.id = t.parent_id
left join public.task_dependencies dep on dep.successor_id = t.id
left join public.tasks pred on pred.id = dep.predecessor_id
left join public.profiles responsible on responsible.id = t.responsible_id;

grant select on public.daily_report_feed to authenticated;
grant select on public.project_gantt to authenticated;
