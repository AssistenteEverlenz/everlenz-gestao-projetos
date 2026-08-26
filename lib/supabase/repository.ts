import type {
  InventoryItem,
  JournalEntry,
  JournalPhoto,
  Member,
  Project,
  ProjectIssue,
  ProjectTeam,
  ProjectWorkspace,
  ReportTemplate,
  Task,
} from "@/app/_components/types";
import { getSupabaseBrowserClient } from "./client";
import { uploadWorksitePhotos } from "./storage";

type ProfileState = {
  id: string;
  organization_id: string | null;
  full_name: string;
};

const roleMap: Record<string, Member["role"]> = {
  admin: "Administrador",
  manager: "Gestor",
  engineer: "Usuário",
  foreman: "Usuário",
  client: "Usuário",
};

const statusMap: Record<string, Project["status"]> = {
  planning: "Planejamento",
  active: "No prazo",
  paused: "Atenção",
  completed: "Concluída",
};
const databaseRole: Record<Member["role"], string> = {
  Administrador: "admin",
  Gestor: "manager",
  Usuário: "engineer",
};

export async function getProfile() {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error("Usuário não autenticado.");

  const { data, error } = await supabase
    .from("profiles")
    .select("id,organization_id,full_name")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data as ProfileState;
}

export async function createOrganization(name: string, slug: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "create_organization",
    { p_name: name, p_slug: slug },
  );
  if (error) throw error;
  return data as string;
}

export async function loadAvailableWorkspaces(userEmail: string) {
  let result = await loadWorkspaces(userEmail);
  if (!result.profile.organization_id) {
    const { data, error } = await getSupabaseBrowserClient().rpc(
      "claim_project_invitations",
    );
    if (error) throw error;
    if (Number(data) > 0) result = await loadWorkspaces(userEmail);
  }
  return result;
}

export async function loadWorkspaces(userEmail: string) {
  const supabase = getSupabaseBrowserClient();
  const profile = await getProfile();
  if (!profile.organization_id)
    return { profile, workspaces: [] as ProjectWorkspace[] };

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select(
      "id,organization_id,name,client_name,contract_number,description,address,start_date,planned_end_date,status,work_days",
    )
    .order("created_at");
  if (projectError) throw projectError;

  const workspaces = await Promise.all(
    (projectRows ?? []).map(async (row) => {
      const [
        { data: taskRows, error: taskError },
        { data: feedRows, error: feedError },
        { data: membershipRows, error: membershipError },
        { data: invitationRows, error: invitationError },
        { data: reportRows, error: reportError },
        { data: projectTeamRows, error: projectTeamError },
        { data: updateTeamRows, error: updateTeamError },
        { data: inventoryRows, error: inventoryError },
        { data: issueRows, error: issueError },
        { data: templateRows, error: templateError },
      ] = await Promise.all([
        supabase
          .from("project_gantt")
          .select("*")
          .eq("project_id", row.id)
          .order("sort_order"),
        supabase
          .from("daily_report_feed")
          .select("*")
          .eq("project_id", row.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("project_members")
          .select(
            "user_id,role,profiles!project_members_user_id_fkey(full_name,avatar_url,email)",
          )
          .eq("project_id", row.id),
        supabase
          .from("project_invitations")
          .select("id,email,role")
          .eq("project_id", row.id)
          .is("accepted_at", null),
        supabase
          .from("status_reports")
          .select("id,report_date,status,executive_summary,review_note")
          .eq("project_id", row.id),
        supabase
          .from("project_teams")
          .select("id,name,company,specialty,contact,active")
          .eq("project_id", row.id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("task_update_teams")
          .select("update_id,team_id,worker_count,project_teams!inner(name,project_id)")
          .eq("project_teams.project_id", row.id),
        supabase
          .from("inventory_items")
          .select("id,name,category,sku,unit,current_quantity,minimum_quantity,lead_days,inventory_allocations(id,task_id,planned_quantity,consumed_quantity)")
          .eq("project_id", row.id)
          .order("name"),
        supabase
          .from("project_issues")
          .select("id,title,description,category,priority,status,task_id,due_date,created_at")
          .eq("project_id", row.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_templates")
          .select("id,name,is_default,settings")
          .eq("project_id", row.id)
          .order("created_at"),
      ]);
      if (taskError) throw taskError;
      if (feedError) throw feedError;
      if (membershipError) throw membershipError;
      if (invitationError) throw invitationError;
      if (reportError) throw reportError;
      if (projectTeamError) throw projectTeamError;
      if (updateTeamError) throw updateTeamError;
      if (inventoryError) throw inventoryError;
      if (issueError) throw issueError;
      if (templateError) throw templateError;

      const tasks: Task[] = [];
      for (const item of taskRows ?? []) {
        if (tasks.some((task) => task.id === item.id)) continue;
        tasks.push({
          id: item.id,
          code: item.wbs,
          name: item.name,
          phase: item.phase,
          plannedStart: item.planned_start,
          plannedEnd: item.planned_end,
          baselineStart: item.baseline_start ?? undefined,
          baselineEnd: item.baseline_end ?? undefined,
          progress: Number(item.progress),
          weight: Number(item.weight),
          parentId: item.parent_id ?? undefined,
          dependencyId: item.predecessor_id ?? undefined,
          dependencyType: item.dependency_type ?? undefined,
          lagDays: item.lag_days ?? undefined,
          responsible: item.responsible_name ?? "",
          color: item.color,
          critical: item.is_critical,
          milestone: item.is_milestone,
          notes: item.notes ?? undefined,
        });
      }

      const photoPaths = (feedRows ?? []).flatMap((item) =>
        (item.photos ?? []).map(
          (photo: { storage_path: string }) => photo.storage_path,
        ),
      );
      const signedByPath = new Map<string, string>();
      if (photoPaths.length) {
        const { data: signed } = await supabase.storage
          .from("worksite-photos")
          .createSignedUrls(photoPaths, 3600);
        signed?.forEach((item) => {
          if (item.path && item.signedUrl)
            signedByPath.set(item.path, item.signedUrl);
        });
      }
      const entries: JournalEntry[] = (feedRows ?? []).map((item) => ({
        id: item.update_id,
        date: item.log_date,
        time: new Date(item.created_at).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        taskId: item.task_id,
        title: item.title,
        description: item.description,
        progressBefore: Number(item.progress_before),
        progressAdded: Number(item.progress_delta),
        progressAfter: Number(item.progress_after),
        author: item.author_name,
        weather: item.weather ?? "Não informado",
        crew: item.crew_count,
        teams: (updateTeamRows ?? [])
          .filter((team) => team.update_id === item.update_id)
          .map((team) => {
            const related = Array.isArray(team.project_teams)
              ? team.project_teams[0]
              : team.project_teams;
            return {
              teamId: team.team_id,
              name: related?.name ?? "Equipe",
              workers: team.worker_count,
            };
          }),
        photos: (item.photos ?? [])
          .map((photo: { id: string; storage_path: string }) => ({
            id: photo.id,
            url: signedByPath.get(photo.storage_path) ?? "",
            storagePath: photo.storage_path,
          }))
          .filter((photo: JournalPhoto) => Boolean(photo.url)),
      }));
      const members: Member[] = (membershipRows ?? []).map((membership) => {
        const related = Array.isArray(membership.profiles)
          ? membership.profiles[0]
          : membership.profiles;
        const name = related?.full_name || "Usuário";
        return {
          id: membership.user_id,
          name,
          email: related?.email || (membership.user_id === profile.id ? userEmail : ""),
          role: roleMap[membership.role] ?? "Usuário",
          initials: name
            .split(" ")
            .map((part: string) => part[0])
            .slice(0, 2)
            .join("")
            .toUpperCase(),
          color: membership.user_id === profile.id ? "#26332f" : "#54756a",
          online: membership.user_id === profile.id,
        };
      });
      for (const invitation of invitationRows ?? []) {
        members.push({
          id: invitation.id,
          name: invitation.email.split("@")[0],
          email: invitation.email,
          role: roleMap[invitation.role] ?? "Usuário",
          initials: invitation.email.slice(0, 2).toUpperCase(),
          color: "#8c654f",
          online: false,
          pending: true,
        });
      }
      return {
        organizationId: row.organization_id,
        project: {
          id: row.id,
          name: row.name,
          client: row.client_name,
          contractNumber: row.contract_number ?? undefined,
          description: row.description ?? undefined,
          location: row.address,
          start: row.start_date,
          end: row.planned_end_date,
          progress: 0,
          status: statusMap[row.status] ?? "Planejamento",
          workDays: row.work_days ?? [1, 2, 3, 4, 5],
        },
        tasks,
        entries,
        members,
        projectTeams: (projectTeamRows ?? []).map((team) => ({
          id: team.id,
          name: team.name,
          company: team.company,
          specialty: team.specialty,
          contact: team.contact ?? undefined,
          active: team.active,
        } satisfies ProjectTeam)),
        inventory: (inventoryRows ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          sku: item.sku ?? undefined,
          unit: item.unit,
          quantity: Number(item.current_quantity),
          minimum: Number(item.minimum_quantity),
          leadDays: item.lead_days,
          allocations: (item.inventory_allocations ?? []).map((allocation) => ({
            id: allocation.id,
            taskId: allocation.task_id,
            planned: Number(allocation.planned_quantity),
            consumed: Number(allocation.consumed_quantity),
          })),
        } satisfies InventoryItem)),
        issues: (issueRows ?? []).map((issue) => ({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          category: issue.category,
          priority: issue.priority,
          status: issue.status,
          taskId: issue.task_id ?? undefined,
          dueDate: issue.due_date ?? undefined,
          createdAt: issue.created_at,
        } satisfies ProjectIssue)),
        reportTemplates: (templateRows ?? []).map((template) => {
          const settings = (template.settings ?? {}) as Record<string, unknown>;
          return {
            id: template.id,
            name: template.name,
            isDefault: template.is_default,
            showSummary: settings.showSummary !== false,
            showPhotos: settings.showPhotos !== false,
            showGantt: settings.showGantt !== false,
            showSCurve: settings.showSCurve !== false,
            showAttention: settings.showAttention !== false,
            photoSize: settings.photoSize === "medium" ? "medium" : "large",
            compact: settings.compact === true,
          } satisfies ReportTemplate;
        }),
        reports: (reportRows ?? []).map((report) => ({
          id: report.id,
          date: report.report_date,
          status: report.status,
          executiveSummary: report.executive_summary ?? undefined,
          reviewNote: report.review_note ?? undefined,
        })),
      } satisfies ProjectWorkspace;
    }),
  );
  return { profile, workspaces };
}

export async function inviteRemoteMember(projectId: string, member: Member) {
  const supabase = getSupabaseBrowserClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Sessão inválida. Entre novamente.");
  const response = await fetch("/api/team", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      projectId,
      name: member.name,
      email: member.email,
      role: databaseRole[member.role],
    }),
  });
  const result = (await response.json()) as {
    member?: Member & { role: string };
    senha_provisoria?: string | null;
    error?: string;
  };
  if (!response.ok || result.error)
    throw new Error(result.error ?? "Não foi possível criar o acesso.");
  return {
    member: {
      ...member,
      id: result.member?.id ?? member.id,
      pending: false,
    },
    temporaryPassword: result.senha_provisoria ?? undefined,
  };
}

async function teamRequest<T>(
  method: "PATCH" | "DELETE",
  body: Record<string, unknown>,
) {
  const supabase = getSupabaseBrowserClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Sessão inválida. Entre novamente.");
  const response = await fetch("/api/team", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok || result.error)
    throw new Error(result.error ?? "Não foi possível gerenciar o acesso.");
  return result;
}

export async function updateRemoteMember(
  projectId: string,
  member: Pick<Member, "id" | "name" | "role">,
) {
  return teamRequest<{ member: Member }>("PATCH", {
    action: "update",
    projectId,
    userId: member.id,
    name: member.name,
    role: databaseRole[member.role],
  });
}

export async function resetRemoteMemberPassword(
  projectId: string,
  userId: string,
) {
  return teamRequest<{ senha_provisoria: string; email: string }>("PATCH", {
    action: "reset_password",
    projectId,
    userId,
  });
}

export async function deleteRemoteMember(projectId: string, userId: string) {
  return teamRequest<{ deleted: boolean }>("DELETE", { projectId, userId });
}

export async function ensureRemoteStatusReport(
  projectId: string,
  reportDate: string,
) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "create_daily_status_report",
    {
      p_project_id: projectId,
      p_report_date: reportDate,
      p_executive_summary: null,
    },
  );
  if (error) throw error;
  return data as string;
}

export async function approveRemoteStatusReport(
  projectId: string,
  reportDate: string,
) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from("status_reports")
    .update({
      status: "approved",
      approved_by: userData.user?.id ?? null,
      approved_at: new Date().toISOString(),
    })
    .eq("project_id", projectId)
    .eq("report_date", reportDate)
    .select("id")
    .single();
  if (error) throw error;
}

export async function transitionRemoteStatusReport(
  reportId: string,
  status: "draft" | "review" | "approved" | "sent",
  note?: string,
) {
  const { error } = await getSupabaseBrowserClient().rpc(
    "transition_status_report",
    { p_report_id: reportId, p_status: status, p_note: note ?? null },
  );
  if (error) throw error;
}

export async function saveRemoteReportSummary(reportId: string, summary: string) {
  const { error } = await getSupabaseBrowserClient()
    .from("status_reports")
    .update({ executive_summary: summary })
    .eq("id", reportId);
  if (error) throw error;
}

export async function generateRemoteReportSummary(payload: Record<string, unknown>) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão inválida. Entre novamente.");
  const response = await fetch("/api/report-summary", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json() as { summary?: string; error?: string };
  if (!response.ok || !result.summary) throw new Error(result.error ?? "Não foi possível gerar o resumo.");
  return result.summary;
}

export async function saveRemoteProjectTeam(
  projectId: string,
  team: ProjectTeam,
) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    project_id: projectId,
    name: team.name,
    company: team.company,
    specialty: team.specialty,
    contact: team.contact ?? null,
    active: team.active,
  };
  const query = team.id
    ? supabase.from("project_teams").update(payload).eq("id", team.id)
    : supabase.from("project_teams").insert({
        ...payload,
        created_by: userData.user?.id,
      });
  const { error } = await query;
  if (error) throw error;
}

export async function deleteRemoteProjectTeam(teamId: string) {
  const { error } = await getSupabaseBrowserClient()
    .from("project_teams")
    .update({ active: false })
    .eq("id", teamId);
  if (error) throw error;
}

export async function saveRemoteInventoryItem(
  projectId: string,
  item: InventoryItem,
) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    project_id: projectId,
    name: item.name,
    category: item.category,
    sku: item.sku ?? null,
    unit: item.unit,
    current_quantity: item.quantity,
    minimum_quantity: item.minimum,
    lead_days: item.leadDays,
  };
  const { data, error } = item.id
    ? await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", item.id)
        .select("id")
        .single()
    : await supabase
        .from("inventory_items")
        .insert({ ...payload, created_by: userData.user?.id })
        .select("id")
        .single();
  if (error) throw error;
  const itemId = data.id as string;
  const { error: removeError } = await supabase
    .from("inventory_allocations")
    .delete()
    .eq("item_id", itemId);
  if (removeError) throw removeError;
  if (item.allocations.length) {
    const { error: allocationError } = await supabase
      .from("inventory_allocations")
      .insert(
        item.allocations.map((allocation) => ({
          item_id: itemId,
          task_id: allocation.taskId,
          planned_quantity: allocation.planned,
          consumed_quantity: allocation.consumed,
        })),
      );
    if (allocationError) throw allocationError;
  }
  return itemId;
}

export async function moveRemoteInventory(
  itemId: string,
  type: "entry" | "exit" | "adjustment",
  quantity: number,
  taskId?: string,
  note?: string,
) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "move_inventory",
    {
      p_item_id: itemId,
      p_type: type,
      p_quantity: quantity,
      p_task_id: taskId ?? null,
      p_note: note ?? null,
    },
  );
  if (error) throw error;
  return Number(data);
}

export async function deleteRemoteInventoryItem(itemId: string) {
  const { error } = await getSupabaseBrowserClient()
    .from("inventory_items")
    .delete()
    .eq("id", itemId);
  if (error) throw error;
}

export async function saveRemoteIssue(projectId: string, issue: ProjectIssue) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  const payload = {
    project_id: projectId,
    title: issue.title,
    description: issue.description,
    category: issue.category,
    priority: issue.priority,
    status: issue.status,
    task_id: issue.taskId ?? null,
    due_date: issue.dueDate ?? null,
    resolved_at: issue.status === "resolved" ? new Date().toISOString() : null,
  };
  const query = issue.id
    ? supabase.from("project_issues").update(payload).eq("id", issue.id)
    : supabase.from("project_issues").insert({
        ...payload,
        created_by: userData.user?.id,
      });
  const { error } = await query;
  if (error) throw error;
}

export async function saveRemoteReportTemplate(
  projectId: string,
  template: ReportTemplate,
) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  if (template.isDefault)
    await supabase
      .from("report_templates")
      .update({ is_default: false })
      .eq("project_id", projectId);
  const payload = {
    project_id: projectId,
    name: template.name,
    is_default: template.isDefault,
    settings: {
      showSummary: template.showSummary,
      showPhotos: template.showPhotos,
      showGantt: template.showGantt,
      showSCurve: template.showSCurve,
      showAttention: template.showAttention,
      photoSize: template.photoSize,
      compact: template.compact,
    },
  };
  const query = template.id
    ? supabase.from("report_templates").update(payload).eq("id", template.id)
    : supabase.from("report_templates").insert({
        ...payload,
        created_by: userData.user?.id,
      });
  const { error } = await query;
  if (error) throw error;
}

export async function createRemoteProject(project: Project) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "create_project_with_owner",
    {
      p_name: project.name,
      p_client_name: project.client,
      p_address: project.location,
      p_start_date: project.start,
      p_planned_end_date: project.end,
      p_contract_number: project.contractNumber ?? null,
      p_description: project.description ?? null,
    },
  );
  if (error) throw error;
  return data as string;
}

export async function updateRemoteProjectWorkDays(
  projectId: string,
  workDays: number[],
) {
  const { error } = await getSupabaseBrowserClient()
    .from("projects")
    .update({ work_days: workDays })
    .eq("id", projectId);
  if (error) throw error;
}

export async function updateRemoteTaskDates(projectId: string, tasks: Task[]) {
  const supabase = getSupabaseBrowserClient();
  const results = await Promise.all(
    tasks.map((task) =>
      supabase
        .from("tasks")
        .update({
          planned_start: task.plannedStart,
          planned_end: task.plannedEnd,
        })
        .eq("id", task.id)
        .eq("project_id", projectId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function createRemoteTask(
  projectId: string,
  task: Task,
  members: Member[],
  sortOrder: number,
) {
  const supabase = getSupabaseBrowserClient();
  const responsibleId =
    members.find(
      (member) => member.name === task.responsible && !member.pending,
    )?.id ?? null;
  const { error } = await supabase.from("tasks").insert({
    id: task.id,
    project_id: projectId,
    parent_id: task.parentId ?? null,
    wbs: task.code,
    name: task.name,
    phase: task.phase,
    notes: task.notes ?? null,
    planned_start: task.plannedStart,
    planned_end: task.plannedEnd,
    baseline_start: task.baselineStart ?? null,
    baseline_end: task.baselineEnd ?? null,
    progress: task.progress,
    weight: task.weight,
    responsible_id: responsibleId,
    color: task.color,
    is_milestone: Boolean(task.milestone),
    is_critical: Boolean(task.critical),
    sort_order: sortOrder,
  });
  if (error) throw error;
  if (task.dependencyId) {
    const { error: dependencyError } = await supabase
      .from("task_dependencies")
      .insert({
        predecessor_id: task.dependencyId,
        successor_id: task.id,
        dependency_type: task.dependencyType ?? "FS",
        lag_days: task.lagDays ?? 0,
      });
    if (dependencyError) throw dependencyError;
  }
}

export async function updateRemoteTask(
  projectId: string,
  task: Task,
  members: Member[],
) {
  const supabase = getSupabaseBrowserClient();
  const responsibleId =
    members.find(
      (member) => member.name === task.responsible && !member.pending,
    )?.id ?? null;
  const { error } = await supabase
    .from("tasks")
    .update({
      parent_id: task.parentId ?? null,
      wbs: task.code,
      name: task.name,
      phase: task.phase,
      notes: task.notes ?? null,
      planned_start: task.plannedStart,
      planned_end: task.plannedEnd,
      baseline_start: task.baselineStart ?? null,
      baseline_end: task.baselineEnd ?? null,
      weight: task.weight,
      responsible_id: responsibleId,
      color: task.color,
      is_milestone: Boolean(task.milestone),
      is_critical: Boolean(task.critical),
    })
    .eq("id", task.id)
    .eq("project_id", projectId);
  if (error) throw error;

  const { error: removeDependencyError } = await supabase
    .from("task_dependencies")
    .delete()
    .eq("successor_id", task.id);
  if (removeDependencyError) throw removeDependencyError;
  if (task.dependencyId) {
    const { error: dependencyError } = await supabase
      .from("task_dependencies")
      .insert({
        predecessor_id: task.dependencyId,
        successor_id: task.id,
        dependency_type: task.dependencyType ?? "FS",
        lag_days: task.lagDays ?? 0,
      });
    if (dependencyError) throw dependencyError;
  }
}

export async function reorderRemoteTasks(projectId: string, tasks: Task[]) {
  const supabase = getSupabaseBrowserClient();
  const temporary = await Promise.all(
    tasks.map((task, sortOrder) =>
      supabase
        .from("tasks")
        .update({
          wbs: `tmp-${task.id}`,
          parent_id: task.parentId ?? null,
          sort_order: sortOrder,
        })
        .eq("id", task.id)
        .eq("project_id", projectId),
    ),
  );
  const temporaryFailure = temporary.find((result) => result.error);
  if (temporaryFailure?.error) throw temporaryFailure.error;
  const results = await Promise.all(
    tasks.map((task) =>
      supabase
        .from("tasks")
        .update({
          wbs: task.code,
          planned_start: task.plannedStart,
          planned_end: task.plannedEnd,
          baseline_start: task.baselineStart ?? null,
          baseline_end: task.baselineEnd ?? null,
        })
        .eq("id", task.id)
        .eq("project_id", projectId),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function updateRemoteTaskProgress(
  taskId: string,
  progress: number,
) {
  const { error } = await getSupabaseBrowserClient()
    .from("tasks")
    .update({ progress })
    .eq("id", taskId);
  if (error) throw error;
}

export async function deleteRemoteTask(projectId: string, taskId: string) {
  const supabase = getSupabaseBrowserClient();
  const { count: updateCount, error: countError } = await supabase
    .from("task_updates")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (countError) throw countError;
  if (updateCount)
    throw new Error(
      "A atividade possui registros no Diário de Obra e não pode ser excluída.",
    );
  const { error } = await supabase
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .eq("project_id", projectId);
  if (error) throw error;
}

async function photoToFile(photo: JournalPhoto, index: number) {
  const response = await fetch(photo.url);
  const blob = await response.blob();
  return new File([blob], photo.originalName ?? `evidencia-${index + 1}.jpg`, {
    type: photo.mimeType || blob.type || "image/jpeg",
  });
}

export async function recordRemoteEntry(
  workspace: ProjectWorkspace,
  entry: JournalEntry,
) {
  if (!workspace.organizationId)
    throw new Error("Organização não identificada.");
  const files = await Promise.all(entry.photos.map(photoToFile));
  const uploadId = crypto.randomUUID();
  const uploaded = await uploadWorksitePhotos(
    workspace.organizationId,
    workspace.project.id,
    entry.date,
    uploadId,
    files,
  );
  const supabase = getSupabaseBrowserClient();
  const { data: updateId, error } = await supabase.rpc("record_daily_progress", {
    p_project_id: workspace.project.id,
    p_task_id: entry.taskId,
    p_log_date: entry.date,
    p_title: entry.title,
    p_description: entry.description,
    p_progress_delta: entry.progressAdded,
    p_crew_count: entry.crew,
    p_weather: entry.weather,
    p_photos: uploaded,
  });
  if (error) {
    await supabase.storage
      .from("worksite-photos")
      .remove(uploaded.map((item) => item.storage_path));
    throw error;
  }
  if (entry.teams?.length && updateId) {
    const { error: teamError } = await supabase.from("task_update_teams").insert(
      entry.teams.map((team) => ({
        update_id: updateId,
        team_id: team.teamId,
        worker_count: team.workers,
      })),
    );
    if (teamError) throw teamError;
  }
}

export async function updateRemoteEntry(
  workspace: ProjectWorkspace,
  entry: JournalEntry,
) {
  if (!workspace.organizationId)
    throw new Error("Organização não identificada.");
  const existing = entry.photos.filter(
    (photo) => photo.id && photo.storagePath,
  );
  const additions = entry.photos.filter((photo) => !photo.id);
  const files = await Promise.all(additions.map(photoToFile));
  const uploadId = crypto.randomUUID();
  const uploaded = await uploadWorksitePhotos(
    workspace.organizationId,
    workspace.project.id,
    entry.date,
    uploadId,
    files,
  );
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("update_daily_progress", {
    p_update_id: entry.id,
    p_title: entry.title,
    p_description: entry.description,
    p_progress_delta: entry.progressAdded,
    p_crew_count: entry.crew,
    p_weather: entry.weather,
    p_keep_photo_ids: existing.map((photo) => photo.id),
    p_new_photos: uploaded,
  });
  if (error) {
    if (uploaded.length)
      await supabase.storage
        .from("worksite-photos")
        .remove(uploaded.map((item) => item.storage_path));
    throw error;
  }
  const deletedPaths =
    (data as { deleted_paths?: string[] } | null)?.deleted_paths ?? [];
  if (deletedPaths.length)
    await supabase.storage.from("worksite-photos").remove(deletedPaths);
  const { error: removeTeamError } = await supabase
    .from("task_update_teams")
    .delete()
    .eq("update_id", entry.id);
  if (removeTeamError) throw removeTeamError;
  if (entry.teams?.length) {
    const { error: teamError } = await supabase.from("task_update_teams").insert(
      entry.teams.map((team) => ({
        update_id: entry.id,
        team_id: team.teamId,
        worker_count: team.workers,
      })),
    );
    if (teamError) throw teamError;
  }
}

export async function deleteRemoteEntry(entryId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("delete_daily_progress", {
    p_update_id: entryId,
  });
  if (error) throw error;
  const deletedPaths =
    (data as { deleted_paths?: string[] } | null)?.deleted_paths ?? [];
  if (deletedPaths.length)
    await supabase.storage.from("worksite-photos").remove(deletedPaths);
}
