export type ViewId =
  | "projects"
  | "overview"
  | "schedule"
  | "journal"
  | "photos"
  | "inventory"
  | "alerts"
  | "reports"
  | "team"
  | "settings";

export type Project = {
  id: string;
  name: string;
  client: string;
  location: string;
  start: string;
  end: string;
  progress: number;
  status: "Planejamento" | "No prazo" | "Atenção" | "Atrasada" | "Concluída";
  description?: string;
  contractNumber?: string;
  workDays?: number[];
  archivedAt?: string;
  /** Logo da obra/projeto. */
  logoUrl?: string;
  logoBackground?: string;
  /** Identidade do cliente contratante, independente da obra. */
  clientLogoUrl?: string;
  clientLogoBackground?: string;
  organizationName?: string;
  organizationLogoUrl?: string;
  organizationLogoBackground?: string;
};

export type TaskResponsibleKind = "user" | "team" | "worker";

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Task = {
  id: string;
  code: string;
  name: string;
  phase: string;
  plannedStart: string;
  plannedEnd: string;
  /** Duração planejada em dias úteis; aceita frações como 0,25 e 0,5. */
  durationDays?: number;
  progress: number;
  weight: number;
  baselineStart?: string;
  baselineEnd?: string;
  parentId?: string;
  dependencyId?: string;
  dependencyType?: DependencyType;
  lagDays?: number;
  responsible: string;
  responsibleKind?: TaskResponsibleKind;
  responsibleRefId?: string;
  color: string;
  critical?: boolean;
  milestone?: boolean;
  notes?: string;
};

export type JournalEntry = {
  id: string;
  date: string;
  time: string;
  taskId: string;
  title: string;
  description: string;
  progressBefore: number;
  progressAdded: number;
  progressAfter: number;
  author: string;
  weather: string;
  crew: number;
  teams?: EntryTeam[];
  photos: JournalPhoto[];
};

export type ProjectTeam = {
  id: string;
  name: string;
  specialty: string;
  company: string;
  contact?: string;
  active: boolean;
  members?: ProjectTeamMember[];
};

export type ProjectTeamMember = {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  active: boolean;
};

export type EntryTeam = {
  teamId: string;
  name: string;
  workers: number;
};

export type InventoryAllocation = {
  id: string;
  taskId: string;
  planned: number;
  consumed: number;
};

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  sku?: string;
  unit: string;
  quantity: number;
  minimum: number;
  leadDays: number;
  allocations: InventoryAllocation[];
  movements?: InventoryMovement[];
  requests?: InventoryRequest[];
};

export type InventoryMovement = {
  id: string;
  internalCode: string;
  type: "entry" | "exit" | "adjustment";
  quantity: number;
  balanceAfter: number;
  taskId?: string;
  purpose: string;
  receiver?: string;
  receiverKind?: "user" | "team" | "worker";
  receiverId?: string;
  document?: string;
  requestId?: string;
  createdBy: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt?: string;
};

export type InventoryRequest = {
  id: string;
  itemId: string;
  taskId?: string;
  quantity: number;
  purpose: string;
  status: "pending" | "approved" | "rejected" | "fulfilled" | "cancelled";
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  fulfilledBy?: string;
  reviewNote?: string;
};

export type ProjectIssue = {
  id: string;
  title: string;
  description: string;
  category: "schedule" | "stock" | "field" | "quality" | "safety" | "other";
  priority: "low" | "medium" | "high" | "critical";
  status: "open" | "monitoring" | "resolved";
  taskId?: string;
  dueDate?: string;
  createdAt: string;
};

export type ReportTemplate = {
  id: string;
  name: string;
  isDefault: boolean;
  showSummary: boolean;
  showPhotos: boolean;
  showGantt: boolean;
  showSCurve: boolean;
  showAttention: boolean;
  photoSize: "medium" | "large";
  compact: boolean;
};

export type JournalPhoto = {
  id?: string;
  url: string;
  storagePath?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: "Administrador" | "Gestor" | "Usuário";
  initials: string;
  color: string;
  online: boolean;
  pending?: boolean;
};

export type ProjectWorkspace = {
  project: Project;
  organizationId?: string;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  projectTeams?: ProjectTeam[];
  inventory?: InventoryItem[];
  issues?: ProjectIssue[];
  reportTemplates?: ReportTemplate[];
  reports?: ReportSummary[];
};

export type ReportSummary = {
  id: string;
  date: string;
  status: "draft" | "review" | "approved" | "sent";
  executiveSummary?: string;
  reviewNote?: string;
};
