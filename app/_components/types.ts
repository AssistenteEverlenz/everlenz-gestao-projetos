export type ViewId =
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
};

export type DependencyType = "FS" | "SS" | "FF" | "SF";

export type Task = {
  id: string;
  code: string;
  name: string;
  phase: string;
  plannedStart: string;
  plannedEnd: string;
  progress: number;
  weight: number;
  baselineStart?: string;
  baselineEnd?: string;
  parentId?: string;
  dependencyId?: string;
  dependencyType?: DependencyType;
  lagDays?: number;
  responsible: string;
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
