import type {
  JournalEntry,
  JournalPhoto,
  Member,
  Project,
  ProjectWorkspace,
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
  engineer: "Engenheiro",
  foreman: "Encarregado",
  client: "Cliente",
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
  Engenheiro: "engineer",
  Encarregado: "foreman",
  Cliente: "client",
};

export async function getProfile() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,organization_id,full_name")
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
      "id,organization_id,name,client_name,contract_number,description,address,start_date,planned_end_date,status",
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
            "user_id,role,profiles!project_members_user_id_fkey(full_name,avatar_url)",
          )
          .eq("project_id", row.id),
        supabase
          .from("project_invitations")
          .select("id,email,role")
          .eq("project_id", row.id)
          .is("accepted_at", null),
        supabase
          .from("status_reports")
          .select("id,report_date,status")
          .eq("project_id", row.id),
      ]);
      if (taskError) throw taskError;
      if (feedError) throw feedError;
      if (membershipError) throw membershipError;
      if (invitationError) throw invitationError;
      if (reportError) throw reportError;

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
          email: membership.user_id === profile.id ? userEmail : "",
          role: roleMap[membership.role] ?? "Engenheiro",
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
          role: roleMap[invitation.role] ?? "Engenheiro",
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
        },
        tasks,
        entries,
        members,
        reports: (reportRows ?? []).map((report) => ({
          id: report.id,
          date: report.report_date,
          status: report.status,
        })),
      } satisfies ProjectWorkspace;
    }),
  );
  return { profile, workspaces };
}

export async function inviteRemoteMember(projectId: string, member: Member) {
  const { error } = await getSupabaseBrowserClient().rpc(
    "invite_project_member",
    {
      p_project_id: projectId,
      p_email: member.email,
      p_role: databaseRole[member.role],
    },
  );
  if (error) throw error;
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
        .update({ wbs: task.code })
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
  const { error } = await supabase.rpc("record_daily_progress", {
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
}
