import type {
  InventoryItem,
  InventoryRequest,
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
import { uploadBrandAsset, uploadWorksitePhotos } from "./storage";

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

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("name,logo_url")
    .eq("id", profile.organization_id)
    .single();
  if (organizationError) throw organizationError;

  let { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select(
      "id,organization_id,name,client_name,contract_number,description,address,start_date,planned_end_date,status,work_days,archived_at,logo_path",
    )
    .order("created_at");
  if (projectError?.message.includes("logo_path")) {
    const fallback = await supabase
      .from("projects")
      .select(
        "id,organization_id,name,client_name,contract_number,description,address,start_date,planned_end_date,status,work_days,archived_at",
      )
      .order("created_at");
    projectRows = fallback.data?.map((row) => ({ ...row, logo_path: null })) ?? null;
    projectError = fallback.error;
  }
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
        { data: projectTeamMemberRows, error: projectTeamMemberError },
        { data: updateTeamRows, error: updateTeamError },
        { data: inventoryRows, error: inventoryError },
        { data: issueRows, error: issueError },
        { data: templateRows, error: templateError },
        { data: movementRows, error: movementError },
        { data: requestRows, error: requestError },
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
          .from("project_team_members")
          .select(
            "id,team_id,name,role,phone,active,project_teams!inner(project_id)",
          )
          .eq("project_teams.project_id", row.id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("task_update_teams")
          .select(
            "update_id,team_id,worker_count,project_teams!inner(name,project_id)",
          )
          .eq("project_teams.project_id", row.id),
        supabase
          .from("inventory_items")
          .select(
            "id,name,category,sku,unit,current_quantity,minimum_quantity,lead_days,inventory_allocations(id,task_id,planned_quantity,consumed_quantity)",
          )
          .eq("project_id", row.id)
          .order("name"),
        supabase
          .from("project_issues")
          .select(
            "id,title,description,category,priority,status,task_id,due_date,created_at",
          )
          .eq("project_id", row.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("report_templates")
          .select("id,name,is_default,settings")
          .eq("project_id", row.id)
          .order("created_at"),
        supabase
          .from("inventory_movements")
          .select(
            "id,movement_number,item_id,task_id,movement_type,quantity,purpose,receiver_name,receiver_kind,receiver_id,document_number,balance_after,request_id,created_at,updated_at,creator:profiles!inventory_movements_created_by_fkey(full_name),updater:profiles!inventory_movements_updated_by_fkey(full_name),inventory_items!inner(project_id)",
          )
          .eq("inventory_items.project_id", row.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("inventory_requests")
          .select(
            "id,item_id,task_id,quantity,purpose,status,review_note,requested_at,profiles!inventory_requests_requested_by_fkey(full_name),reviewer:profiles!inventory_requests_reviewed_by_fkey(full_name),fulfiller:profiles!inventory_requests_fulfilled_by_fkey(full_name)",
          )
          .eq("project_id", row.id)
          .order("requested_at", { ascending: false }),
      ]);
      if (taskError) throw taskError;
      if (feedError) throw feedError;
      if (membershipError) throw membershipError;
      if (invitationError) throw invitationError;
      if (reportError) throw reportError;
      if (projectTeamError) throw projectTeamError;
      if (projectTeamMemberError) throw projectTeamMemberError;
      if (updateTeamError) throw updateTeamError;
      if (inventoryError) throw inventoryError;
      if (issueError) throw issueError;
      if (templateError) throw templateError;
      if (movementError) throw movementError;
      if (requestError) throw requestError;

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
          responsibleKind: item.responsible_kind ?? undefined,
          responsibleRefId: item.responsible_ref_id ?? undefined,
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
          email:
            related?.email ||
            (membership.user_id === profile.id ? userEmail : ""),
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
          archivedAt: row.archived_at ?? undefined,
          logoUrl: row.logo_path
            ? supabase.storage.from("brand-assets").getPublicUrl(row.logo_path)
                .data.publicUrl
            : undefined,
          organizationName: organization.name,
          organizationLogoUrl: organization.logo_url
            ? supabase.storage
                .from("brand-assets")
                .getPublicUrl(organization.logo_url).data.publicUrl
            : undefined,
        },
        tasks,
        entries,
        members,
        projectTeams: (projectTeamRows ?? []).map(
          (team) =>
            ({
              id: team.id,
              name: team.name,
              company: team.company,
              specialty: team.specialty,
              contact: team.contact ?? undefined,
              active: team.active,
              members: (projectTeamMemberRows ?? [])
                .filter((member) => member.team_id === team.id)
                .map((member) => ({
                  id: member.id,
                  name: member.name,
                  role: member.role ?? undefined,
                  phone: member.phone ?? undefined,
                  active: member.active,
                })),
            }) satisfies ProjectTeam,
        ),
        inventory: (inventoryRows ?? []).map(
          (item) =>
            ({
              id: item.id,
              name: item.name,
              category: item.category,
              sku: item.sku ?? undefined,
              unit: item.unit,
              quantity: Number(item.current_quantity),
              minimum: Number(item.minimum_quantity),
              leadDays: item.lead_days,
              allocations: (item.inventory_allocations ?? []).map(
                (allocation) => ({
                  id: allocation.id,
                  taskId: allocation.task_id,
                  planned: Number(allocation.planned_quantity),
                  consumed: Number(allocation.consumed_quantity),
                }),
              ),
              movements: (movementRows ?? [])
                .filter((movement) => movement.item_id === item.id)
                .map((movement) => {
                  const creator = Array.isArray(movement.creator)
                    ? movement.creator[0]
                    : movement.creator;
                  const updater = Array.isArray(movement.updater)
                    ? movement.updater[0]
                    : movement.updater;
                  return {
                    id: movement.id,
                    internalCode: `MOV-${String(movement.movement_number).padStart(6, "0")}`,
                    type: movement.movement_type,
                    quantity: Number(movement.quantity),
                    balanceAfter: Number(movement.balance_after),
                    taskId: movement.task_id ?? undefined,
                    purpose: movement.purpose || "Movimentação de estoque",
                    receiver: movement.receiver_name ?? undefined,
                    receiverKind: movement.receiver_kind ?? undefined,
                    receiverId: movement.receiver_id ?? undefined,
                    document: movement.document_number ?? undefined,
                    requestId: movement.request_id ?? undefined,
                    createdBy: creator?.full_name ?? "Usuário",
                    createdAt: movement.created_at,
                    updatedBy: updater?.full_name ?? undefined,
                    updatedAt: movement.updated_at ?? undefined,
                  };
                }),
              requests: (requestRows ?? [])
                .filter((request) => request.item_id === item.id)
                .map((request) => {
                  const requester = Array.isArray(request.profiles)
                    ? request.profiles[0]
                    : request.profiles;
                  const reviewer = Array.isArray(request.reviewer)
                    ? request.reviewer[0]
                    : request.reviewer;
                  const fulfiller = Array.isArray(request.fulfiller)
                    ? request.fulfiller[0]
                    : request.fulfiller;
                  return {
                    id: request.id,
                    itemId: request.item_id,
                    taskId: request.task_id ?? undefined,
                    quantity: Number(request.quantity),
                    purpose: request.purpose,
                    status: request.status,
                    requestedBy: requester?.full_name ?? "Usuário",
                    requestedAt: request.requested_at,
                    reviewedBy: reviewer?.full_name ?? undefined,
                    fulfilledBy: fulfiller?.full_name ?? undefined,
                    reviewNote: request.review_note ?? undefined,
                  } satisfies InventoryRequest;
                }),
            }) satisfies InventoryItem,
        ),
        issues: (issueRows ?? []).map(
          (issue) =>
            ({
              id: issue.id,
              title: issue.title,
              description: issue.description,
              category: issue.category,
              priority: issue.priority,
              status: issue.status,
              taskId: issue.task_id ?? undefined,
              dueDate: issue.due_date ?? undefined,
              createdAt: issue.created_at,
            }) satisfies ProjectIssue,
        ),
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

export async function saveRemoteReportSummary(
  reportId: string,
  summary: string,
) {
  const { error } = await getSupabaseBrowserClient()
    .from("status_reports")
    .update({ executive_summary: summary })
    .eq("id", reportId);
  if (error) throw error;
}

export async function generateRemoteReportSummary(
  payload: Record<string, unknown>,
) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão inválida. Entre novamente.");
  const response = await fetch("/api/report-summary", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as {
    summary?: string;
    error?: string;
  };
  if (!response.ok || !result.summary)
    throw new Error(result.error ?? "Não foi possível gerar o resumo.");
  return result.summary;
}

export async function saveRemoteProjectTeam(
  projectId: string,
  team: ProjectTeam,
) {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc("save_project_team", {
    p_project_id: projectId,
    p_team_id: team.id || null,
    p_name: team.name,
    p_company: team.company,
    p_specialty: team.specialty,
    p_contact: team.contact ?? null,
    p_active: team.active,
    p_members: (team.members ?? []).map((member) => ({
      name: member.name,
      role: member.role,
      phone: member.phone,
      active: member.active,
    })),
  });
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
  purpose?: string,
  receiver?: string,
  receiverKind?: "user" | "team" | "worker",
  receiverId?: string,
  document?: string,
) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "move_inventory",
    {
      p_item_id: itemId,
      p_type: type,
      p_quantity: quantity,
      p_task_id: taskId ?? null,
      p_purpose: purpose ?? null,
      p_receiver: receiver ?? null,
      p_receiver_kind: receiverKind ?? null,
      p_receiver_id: receiverId ?? null,
      p_document: document ?? null,
    },
  );
  if (error) throw error;
  return Number(data);
}

export async function updateRemoteInventoryMovement(
  movementId: string,
  type: "entry" | "exit" | "adjustment",
  quantity: number,
  taskId?: string,
  purpose?: string,
  receiver?: string,
  receiverKind?: "user" | "team" | "worker",
  receiverId?: string,
  document?: string,
) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "update_inventory_movement",
    {
      p_movement_id: movementId,
      p_type: type,
      p_quantity: quantity,
      p_task_id: taskId ?? null,
      p_purpose: purpose ?? null,
      p_receiver: receiver ?? null,
      p_receiver_kind: receiverKind ?? null,
      p_receiver_id: receiverId ?? null,
      p_document: document ?? null,
    },
  );
  if (error) throw error;
  return Number(data);
}

export async function deleteRemoteInventoryMovement(movementId: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "delete_inventory_movement",
    {
      p_movement_id: movementId,
    },
  );
  if (error) throw error;
  return Number(data);
}

export async function createRemoteInventoryRequest(
  projectId: string,
  request: Pick<InventoryRequest, "itemId" | "taskId" | "quantity" | "purpose">,
) {
  const supabase = getSupabaseBrowserClient();
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("inventory_requests").insert({
    project_id: projectId,
    item_id: request.itemId,
    task_id: request.taskId ?? null,
    quantity: request.quantity,
    purpose: request.purpose,
    requested_by: userData.user?.id,
  });
  if (error) throw error;
}

export async function transitionRemoteInventoryRequest(
  requestId: string,
  status: InventoryRequest["status"],
  note?: string,
  receiver?: string,
  receiverKind?: "user" | "team" | "worker",
  receiverId?: string,
  document?: string,
) {
  const { error } = await getSupabaseBrowserClient().rpc(
    "transition_inventory_request",
    {
      p_request_id: requestId,
      p_status: status,
      p_note: note ?? null,
      p_receiver: receiver ?? null,
      p_receiver_kind: receiverKind ?? null,
      p_receiver_id: receiverId ?? null,
      p_document: document ?? null,
    },
  );
  if (error) throw error;
}

export async function importRemoteInventoryItems(
  projectId: string,
  rows: InventoryItem[],
) {
  const { data, error } = await getSupabaseBrowserClient().rpc(
    "import_inventory_items",
    {
      p_project_id: projectId,
      p_rows: rows.map((item) => ({
        name: item.name,
        category: item.category,
        sku: item.sku,
        unit: item.unit,
        quantity: item.quantity,
        minimum: item.minimum,
        leadDays: item.leadDays,
        allocations: item.allocations.map((allocation) => ({
          taskId: allocation.taskId,
          planned: allocation.planned,
        })),
      })),
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

export async function setRemoteProjectArchived(
  projectId: string,
  archived: boolean,
) {
  const { error } = await getSupabaseBrowserClient().rpc(
    "set_project_archived",
    { p_project_id: projectId, p_archived: archived },
  );
  if (error) throw error;
}

export async function saveRemoteBrandLogo(
  organizationId: string,
  projectId: string | undefined,
  file: File | null,
) {
  const uploaded = file
    ? await uploadBrandAsset(organizationId, projectId ?? "organization", file)
    : null;
  const rpc = projectId ? "set_project_logo" : "set_organization_logo";
  const args = projectId
    ? { p_project_id: projectId, p_logo_path: uploaded?.path ?? null }
    : { p_logo_path: uploaded?.path ?? null };
  const { error } = await getSupabaseBrowserClient().rpc(rpc, args);
  if (error) throw error;
  return uploaded?.url;
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
    task.responsibleKind === "user"
      ? (task.responsibleRefId ??
        members.find(
          (member) => member.name === task.responsible && !member.pending,
        )?.id ??
        null)
      : null;
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
    responsible_kind: task.responsibleKind ?? null,
    responsible_ref_id: task.responsibleRefId ?? null,
    responsible_label: task.responsible || null,
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
    task.responsibleKind === "user"
      ? (task.responsibleRefId ??
        members.find(
          (member) => member.name === task.responsible && !member.pending,
        )?.id ??
        null)
      : null;
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
      responsible_kind: task.responsibleKind ?? null,
      responsible_ref_id: task.responsibleRefId ?? null,
      responsible_label: task.responsible || null,
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
  const { data: updateId, error } = await supabase.rpc(
    "record_daily_progress",
    {
      p_project_id: workspace.project.id,
      p_task_id: entry.taskId,
      p_log_date: entry.date,
      p_title: entry.title,
      p_description: entry.description,
      p_progress_delta: entry.progressAdded,
      p_crew_count: entry.crew,
      p_weather: entry.weather,
      p_photos: uploaded,
    },
  );
  if (error) {
    await supabase.storage
      .from("worksite-photos")
      .remove(uploaded.map((item) => item.storage_path));
    throw error;
  }
  if (entry.teams?.length && updateId) {
    const { error: teamError } = await supabase
      .from("task_update_teams")
      .insert(
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
    const { error: teamError } = await supabase
      .from("task_update_teams")
      .insert(
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
