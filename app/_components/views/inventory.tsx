"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import { Icon } from "../icons";
import type { InventoryItem, InventoryMovement, InventoryRequest, Member, ProjectTeam, Task } from "../types";
import { Modal } from "../ui";

type MovementType = "entry" | "exit" | "adjustment";
type RequestStatus = InventoryRequest["status"];
type StockFilter = "all" | "minimum" | "empty" | "requests" | "unallocated";
type RequestFilter = "open" | "pending" | "approved" | "fulfilled" | "rejected" | "all";
type ReceiverOption = { id: string; kind: "user" | "team" | "worker"; name: string; label: string };
type Props = {
  items: InventoryItem[];
  tasks: Task[];
  members: Member[];
  projectTeams: ProjectTeam[];
  currentUserRole: Member["role"];
  saveItem: (item: InventoryItem) => Promise<void>;
  moveItem: (itemId: string, type: MovementType, quantity: number, taskId?: string, purpose?: string, receiver?: string, receiverKind?: ReceiverOption["kind"], receiverId?: string, document?: string) => Promise<void>;
  updateMovement: (itemId: string, movement: InventoryMovement, type: MovementType, quantity: number, taskId?: string, purpose?: string, receiver?: string, receiverKind?: ReceiverOption["kind"], receiverId?: string, document?: string) => Promise<void>;
  deleteMovement: (itemId: string, movement: InventoryMovement) => Promise<void>;
  deleteItem: (item: InventoryItem) => Promise<void>;
  createRequest: (request: Pick<InventoryRequest, "itemId" | "taskId" | "quantity" | "purpose">) => Promise<void>;
  transitionRequest: (requestId: string, status: RequestStatus, note?: string, receiver?: string, receiverKind?: ReceiverOption["kind"], receiverId?: string, document?: string) => Promise<void>;
  importItems: (items: InventoryItem[]) => Promise<number>;
};

const EMPTY_ITEM: InventoryItem = { id: "", name: "", category: "Geral", unit: "un", quantity: 0, minimum: 0, leadDays: 0, allocations: [] };
const IMPORT_HEADERS = ["material", "categoria", "codigo_sku", "unidade", "saldo_inicial", "estoque_minimo", "prazo_reposicao_dias", "eap", "quantidade_prevista"];
const remainingDemand = (item: InventoryItem) => item.allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.planned - allocation.consumed), 0);
const taskName = (tasks: Task[], taskId?: string) => tasks.find((task) => task.id === taskId);
const formatWhen = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const requestLabel: Record<RequestStatus, string> = { pending: "Pendente", approved: "Aprovada", rejected: "Recusada", fulfilled: "Atendida", cancelled: "Cancelada" };
const movementLabel: Record<MovementType, string> = { entry: "Entrada", exit: "Saída", adjustment: "Ajuste" };

export function Inventory({ items, tasks, members, projectTeams, currentUserRole, saveItem, moveItem, updateMovement, deleteMovement, deleteItem, createRequest, transitionRequest, importItems }: Props) {
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [moving, setMoving] = useState<InventoryItem | null>(null);
  const [editingMovement, setEditingMovement] = useState<{ item: InventoryItem; movement: InventoryMovement } | null>(null);
  const [deletingMovement, setDeletingMovement] = useState<{ item: InventoryItem; movement: InventoryMovement } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetailTab, setSelectedDetailTab] = useState<"movements" | "requests">("movements");
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<{ request: InventoryRequest; status: RequestStatus } | null>(null);
  const [importing, setImporting] = useState(false);
  const [section, setSection] = useState<"items" | "requests">("items");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [requestFilter, setRequestFilter] = useState<RequestFilter>("open");
  const [requestSearch, setRequestSearch] = useState("");
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const canManageMovements = currentUserRole === "Administrador" || currentUserRole === "Gestor";
  const requesting = items.find((item) => item.id === requestingId) ?? null;
  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, "pt-BR")), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const hasOpenRequest = (item.requests ?? []).some((request) => request.status === "pending" || request.status === "approved");
    const matchesState = stockFilter === "all"
      || (stockFilter === "minimum" && item.quantity - remainingDemand(item) > 0 && item.quantity - remainingDemand(item) <= item.minimum)
      || (stockFilter === "empty" && item.quantity - remainingDemand(item) <= 0)
      || (stockFilter === "requests" && hasOpenRequest)
      || (stockFilter === "unallocated" && item.allocations.length === 0);
    return `${item.name} ${item.category} ${item.sku ?? ""}`.toLowerCase().includes(search.toLowerCase())
      && (!categoryFilter || item.category === categoryFilter)
      && (!taskFilter || item.allocations.some((allocation) => allocation.taskId === taskFilter))
      && matchesState;
  }), [categoryFilter, items, search, stockFilter, taskFilter]);
  const shortage = items.filter((item) => item.quantity - remainingDemand(item) <= item.minimum);
  const pending = items.reduce((sum, item) => sum + (item.requests ?? []).filter((request) => request.status === "pending" || request.status === "approved").length, 0);
  const stockCounts: Record<StockFilter, number> = {
    all: items.length,
    minimum: items.filter((item) => item.quantity - remainingDemand(item) > 0 && item.quantity - remainingDemand(item) <= item.minimum).length,
    empty: items.filter((item) => item.quantity - remainingDemand(item) <= 0).length,
    requests: items.filter((item) => (item.requests ?? []).some((request) => request.status === "pending" || request.status === "approved")).length,
    unallocated: items.filter((item) => item.allocations.length === 0).length,
  };
  const receivers = useMemo<ReceiverOption[]>(() => [
    ...members.filter((member) => !member.pending).map((member) => ({ id: member.id, kind: "user" as const, name: member.name, label: `${member.name} · Usuário do sistema` })),
    ...projectTeams.filter((team) => team.active).flatMap((team) => [
      { id: team.id, kind: "team" as const, name: team.name, label: `${team.name} · ${team.company}` },
      ...(team.members ?? []).filter((member) => member.active).map((member) => ({ id: member.id, kind: "worker" as const, name: member.name, label: `${member.name} · ${member.role || team.name} · ${team.company}` })),
    ]),
  ], [members, projectTeams]);

  return <div className="view-stack inventory-view">
    <section className="inventory-summary glass">
      <div><span className="overline">MATERIAIS DA OBRA</span><h2>Estoque conectado ao planejamento</h2><p>Controle entradas, retiradas, requisições e reservas por EAP com rastreabilidade.</p></div>
      <div className="inventory-kpis"><span><b>{items.length}</b> materiais</span><span className={shortage.length ? "danger" : ""}><b>{shortage.length}</b> alertas</span><span><b>{pending}</b> requisições abertas</span></div>
      <div className="inventory-top-actions">
        <a className="secondary-btn" href="/modelo-importacao-estoque.csv" download><Icon name="download"/> Modelo CSV</a>
        <button className="secondary-btn" onClick={() => setImporting(true)}><Icon name="download"/> Importar</button>
        <button className="secondary-btn" disabled={!items.length} onClick={() => setRequestingId(items[0]?.id ?? null)}><Icon name="journal"/> Requisitar</button>
        <button className="primary-btn" onClick={() => setEditing(EMPTY_ITEM)}><Icon name="plus"/> Novo material</button>
      </div>
    </section>
    <nav className="inventory-main-tabs glass" aria-label="Seções do estoque"><button className={section === "items" ? "active" : ""} onClick={() => setSection("items")}><Icon name="building"/><span>Materiais</span><b>{items.length}</b></button><button className={section === "requests" ? "active" : ""} onClick={() => setSection("requests")}><Icon name="journal"/><span>Requisições</span><b>{pending}</b></button></nav>
    {section === "items" && <section className="panel glass">
      <div className="panel-header"><div><span className="overline">POSIÇÃO ATUAL</span><h3>Materiais e reservas</h3></div><label className="search-box"><Icon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar material..."/></label></div>
      <div className="inventory-filter-bar">
        <div className="inventory-filter-chips">{([
          ["all", "Todos"], ["minimum", "Estoque mínimo"], ["empty", "Sem estoque"], ["requests", "Com requisição"], ["unallocated", "Sem EAP"],
        ] as [StockFilter, string][]).map(([value, label]) => <button key={value} className={stockFilter === value ? "active" : ""} onClick={() => setStockFilter(value)}>{label}<b>{stockCounts[value]}</b></button>)}</div>
        <div className="inventory-filter-selects"><label><span>Categoria</span><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">Todas</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>Atividade / EAP</span><select value={taskFilter} onChange={(event) => setTaskFilter(event.target.value)}><option value="">Todas</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select></label>{(stockFilter !== "all" || categoryFilter || taskFilter) && <button className="text-btn" onClick={() => { setStockFilter("all"); setCategoryFilter(""); setTaskFilter(""); }}><Icon name="close"/> Limpar filtros</button>}</div>
      </div>
      <div className="inventory-table">
        <div className="inventory-row inventory-head"><span>Material</span><span>Saldo</span><span>Reservado</span><span>Disponível</span><span>Situação</span><span>Ações</span></div>
        {filtered.map((item) => {
          const demand = remainingDemand(item); const available = item.quantity - demand;
          const state = available <= 0 ? "Sem estoque" : available <= item.minimum ? "Estoque mínimo" : "Abastecido";
          return <div className="inventory-row" key={item.id} role="button" tabIndex={0} onClick={() => { setSelectedDetailTab("movements"); setSelectedId(item.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { setSelectedDetailTab("movements"); setSelectedId(item.id); } }}>
            <span><strong>{item.name}</strong><small>{item.category}{item.sku ? ` · ${item.sku}` : ""}</small></span>
            <b>{item.quantity} {item.unit}</b><b>{demand} {item.unit}</b><b className={available < 0 ? "danger" : ""}>{available} {item.unit}</b>
            <em className={state === "Abastecido" ? "ok" : state === "Sem estoque" ? "empty" : "warning"}>{state}</em>
            <span className="inventory-actions"><button className="secondary-btn compact" onClick={(event) => { event.stopPropagation(); setMoving(item); }}>Movimentar</button><button className="icon-btn tiny" aria-label={`Editar ${item.name}`} onClick={(event) => { event.stopPropagation(); setEditing(item); }}><Icon name="settings"/></button></span>
          </div>;
        })}
        {!filtered.length && <div className="inventory-empty"><Icon name="filter"/><strong>Nenhum material neste filtro</strong><span>Ajuste os filtros ou limpe a busca para visualizar outros itens.</span></div>}
      </div>
    </section>}
    {section === "requests" && <RequestBoard items={items} tasks={tasks} filter={requestFilter} search={requestSearch} onFilter={setRequestFilter} onSearch={setRequestSearch} onNew={() => setRequestingId(items[0]?.id ?? null)} onOpenItem={(itemId) => { setSelectedDetailTab("requests"); setSelectedId(itemId); }} onTransition={setTransitioning}/>}

    {selected && <InventoryDetail item={selected} tasks={tasks} initialTab={selectedDetailTab} canManageMovements={canManageMovements} onClose={() => setSelectedId(null)} onMove={() => { setSelectedId(null); setMoving(selected); }} onEdit={() => { setSelectedId(null); setEditing(selected); }} onRequest={() => { setSelectedId(null); setRequestingId(selected.id); }} onTransition={setTransitioning} onEditMovement={(movement) => setEditingMovement({ item: selected, movement })} onDeleteMovement={(movement) => setDeletingMovement({ item: selected, movement })}/>}
    {editing && <InventoryForm item={editing} tasks={tasks} processing={processing} onClose={() => setEditing(null)} onDelete={editing.id ? async () => { setProcessing(true); try { await deleteItem(editing); setEditing(null); setSelectedId(null); } finally { setProcessing(false); } } : undefined} onSave={async (item) => { setProcessing(true); try { await saveItem(item); setEditing(null); } finally { setProcessing(false); } }}/>}
    {moving && <MovementForm
      item={moving} tasks={tasks} receivers={receivers} processing={processing}
      onClose={() => setMoving(null)}
      onSave={async (type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document) => { setProcessing(true); try { await moveItem(moving.id, type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document); setMoving(null); } finally { setProcessing(false); } }}
    />}
    {editingMovement && <MovementForm
      item={items.find((item) => item.id === editingMovement.item.id) ?? editingMovement.item} movement={editingMovement.movement} tasks={tasks} receivers={receivers} processing={processing}
      onClose={() => setEditingMovement(null)}
      onSave={async (type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document) => { setProcessing(true); try { await updateMovement(editingMovement.item.id, editingMovement.movement, type, quantity, taskId, purpose, receiver, receiverKind, receiverId, document); setEditingMovement(null); } finally { setProcessing(false); } }}
    />}
    {deletingMovement && <MovementDeleteConfirm
      data={deletingMovement}
      processing={processing}
      onClose={() => setDeletingMovement(null)}
      onConfirm={async () => { setProcessing(true); try { await deleteMovement(deletingMovement.item.id, deletingMovement.movement); setDeletingMovement(null); } finally { setProcessing(false); } }}
    />}
    {requesting && <RequestForm item={requesting} items={items} tasks={tasks} processing={processing} onClose={() => setRequestingId(null)} onChangeItem={setRequestingId} onSave={async (request) => { setProcessing(true); try { await createRequest(request); setRequestingId(null); setSection("requests"); setRequestFilter("open"); } finally { setProcessing(false); } }}/>}
    {transitioning && <TransitionForm
      data={transitioning} receivers={receivers} processing={processing}
      onClose={() => setTransitioning(null)}
      onSave={async (note, receiver, receiverKind, receiverId, document) => { setProcessing(true); try { await transitionRequest(transitioning.request.id, transitioning.status, note, receiver, receiverKind, receiverId, document); setTransitioning(null); } finally { setProcessing(false); } }}
    />}
    {importing && <ImportForm existing={items} tasks={tasks} processing={processing} fileRef={fileRef} onClose={() => setImporting(false)} onImport={async (rows) => { setProcessing(true); try { await importItems(rows); setImporting(false); } finally { setProcessing(false); } }}/>}
  </div>;
}

function RequestBoard({ items, tasks, filter, search, onFilter, onSearch, onNew, onOpenItem, onTransition }: { items: InventoryItem[]; tasks: Task[]; filter: RequestFilter; search: string; onFilter: (value: RequestFilter) => void; onSearch: (value: string) => void; onNew: () => void; onOpenItem: (itemId: string) => void; onTransition: (data: { request: InventoryRequest; status: RequestStatus }) => void }) {
  const requests = useMemo(() => items.flatMap((item) => (item.requests ?? []).map((request) => ({ request, item }))).sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt)), [items]);
  const counts: Record<RequestFilter, number> = {
    all: requests.length,
    open: requests.filter(({ request }) => request.status === "pending" || request.status === "approved").length,
    pending: requests.filter(({ request }) => request.status === "pending").length,
    approved: requests.filter(({ request }) => request.status === "approved").length,
    fulfilled: requests.filter(({ request }) => request.status === "fulfilled").length,
    rejected: requests.filter(({ request }) => request.status === "rejected" || request.status === "cancelled").length,
  };
  const visible = requests.filter(({ item, request }) => {
    const statusMatches = filter === "all" || (filter === "open" ? request.status === "pending" || request.status === "approved" : filter === "rejected" ? request.status === "rejected" || request.status === "cancelled" : request.status === filter);
    const task = taskName(tasks, request.taskId);
    return statusMatches && `${item.name} ${item.sku ?? ""} ${request.purpose} ${request.requestedBy} ${task?.code ?? ""} ${task?.name ?? ""}`.toLowerCase().includes(search.toLowerCase());
  });
  return <section className="panel glass inventory-request-board">
    <div className="panel-header"><div><span className="overline">FLUXO DE ATENDIMENTO</span><h3>Requisições de materiais</h3><p>Acompanhe cada solicitação desde o pedido até a entrega e a baixa no estoque.</p></div><div className="request-board-actions"><label className="search-box"><Icon name="search"/><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar requisição..."/></label><button className="primary-btn" disabled={!items.length} onClick={onNew}><Icon name="plus"/> Nova requisição</button></div></div>
    <div className="request-filter-chips">{([[
      "open", "Em aberto"], ["pending", "Pendentes"], ["approved", "Aprovadas"], ["fulfilled", "Atendidas"], ["rejected", "Recusadas"], ["all", "Todas"],
    ] as [RequestFilter, string][]).map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => onFilter(value)}>{label}<b>{counts[value]}</b></button>)}</div>
    <div className="request-board-list">{visible.map(({ item, request }) => { const task = taskName(tasks, request.taskId); return <article key={request.id} className={`request-board-card ${request.status}`}>
      <button className="request-card-main" onClick={() => onOpenItem(item.id)}><span className="request-status-mark"><Icon name={request.status === "fulfilled" ? "check" : request.status === "rejected" || request.status === "cancelled" ? "close" : "clock"}/></span><span className="request-card-copy"><span><em className={`request-status ${request.status}`}>{requestLabel[request.status]}</em><time>{formatWhen(request.requestedAt)}</time></span><strong>{item.name} · {request.quantity} {item.unit}</strong><p>{request.purpose}</p><small>Solicitado por <b>{request.requestedBy}</b>{task ? <> · EAP <b>{task.code} · {task.name}</b></> : " · Uso geral da obra"}</small></span></button>
      <div className="request-card-actions"><button className="secondary-btn compact" onClick={() => onOpenItem(item.id)}>Ver detalhes</button>{request.status === "pending" && <><button className="secondary-btn compact" onClick={() => onTransition({ request, status: "rejected" })}>Recusar</button><button className="primary-btn compact" onClick={() => onTransition({ request, status: "approved" })}>Aprovar</button></>}{request.status === "approved" && <button className="primary-btn compact" onClick={() => onTransition({ request, status: "fulfilled" })}>Atender e baixar</button>}</div>
    </article>; })}{!visible.length && <div className="inventory-empty"><Icon name="journal"/><strong>Nenhuma requisição neste filtro</strong><span>Altere o status selecionado ou crie uma nova requisição.</span></div>}</div>
  </section>;
}

function InventoryDetail({ item, tasks, initialTab, canManageMovements, onClose, onMove, onEdit, onRequest, onTransition, onEditMovement, onDeleteMovement }: { item: InventoryItem; tasks: Task[]; initialTab: "movements" | "requests"; canManageMovements: boolean; onClose: () => void; onMove: () => void; onEdit: () => void; onRequest: () => void; onTransition: (data: { request: InventoryRequest; status: RequestStatus }) => void; onEditMovement: (movement: InventoryMovement) => void; onDeleteMovement: (movement: InventoryMovement) => void }) {
  const [tab, setTab] = useState<"movements" | "requests">(initialTab); const demand = remainingDemand(item);
  return <Modal title={item.name} subtitle={`${item.category}${item.sku ? ` · ${item.sku}` : ""}`} onClose={onClose} wide><div className="inventory-detail">
    <div className="inventory-detail-kpis"><span><small>Saldo atual</small><strong>{item.quantity} {item.unit}</strong></span><span><small>Reservado</small><strong>{demand} {item.unit}</strong></span><span><small>Disponível</small><strong>{item.quantity - demand} {item.unit}</strong></span><span><small>Estoque mínimo</small><strong>{item.minimum} {item.unit}</strong></span></div>
    <div className="inventory-detail-actions"><button className="secondary-btn" onClick={onEdit}><Icon name="settings"/> Editar</button><button className="secondary-btn" onClick={onRequest}><Icon name="journal"/> Requisitar</button><button className="primary-btn" onClick={onMove}><Icon name="plus"/> Movimentar</button></div>
    {!!item.allocations.length && <section className="inventory-allocations"><header><strong>Reservas por atividade</strong><span>{item.allocations.length} vínculos</span></header>{item.allocations.map((allocation) => { const task = taskName(tasks, allocation.taskId); return <div key={allocation.id}><span><b>{task?.code ?? "—"}</b>{task?.name ?? "Atividade removida"}</span><span>{allocation.consumed} de {allocation.planned} {item.unit}</span></div>; })}</section>}
    <div className="inventory-tabs"><button className={tab === "movements" ? "active" : ""} onClick={() => setTab("movements")}>Movimentações <b>{item.movements?.length ?? 0}</b></button><button className={tab === "requests" ? "active" : ""} onClick={() => setTab("requests")}>Requisições <b>{item.requests?.length ?? 0}</b></button></div>
    {tab === "movements" ? <div className="inventory-history">{(item.movements ?? []).map((movement) => { const task = taskName(tasks, movement.taskId); return <article key={movement.id}><i className={movement.type}/><div><header><strong>{movementLabel[movement.type]} · {movement.quantity} {item.unit}</strong><span className="movement-history-head"><span className="movement-reference"><b>{movement.internalCode}</b><time>{formatWhen(movement.createdAt)}</time></span>{canManageMovements && <span className="movement-row-actions"><button className="icon-btn tiny" aria-label={`Editar ${movement.internalCode}`} title="Editar movimentação" onClick={() => onEditMovement(movement)}><Icon name="edit"/></button><button className="icon-btn tiny danger" aria-label={`Excluir ${movement.internalCode}`} title="Excluir movimentação" onClick={() => onDeleteMovement(movement)}><Icon name="trash"/></button></span>}</span></header><p>{movement.purpose}</p><footer><span>Registrado por <b>{movement.createdBy}</b></span>{movement.updatedAt && <span>Editado por <b>{movement.updatedBy ?? "Gestor"}</b> em {formatWhen(movement.updatedAt)}</span>}{movement.receiver && <span>Recebido por <b>{movement.receiver}</b></span>}{task && <span>EAP <b>{task.code} · {task.name}</b></span>}{movement.document && <span>Documento externo <b>{movement.document}</b></span>}<span>Saldo após: <b>{movement.balanceAfter} {item.unit}</b></span></footer></div></article>; })}{!item.movements?.length && <EmptyState text="Nenhuma movimentação registrada neste material."/>}</div>
    : <div className="inventory-history">{(item.requests ?? []).map((request) => { const task = taskName(tasks, request.taskId); return <article key={request.id}><i className={`request-${request.status}`}/><div><header><strong>{request.quantity} {item.unit} · {requestLabel[request.status]}</strong><time>{formatWhen(request.requestedAt)}</time></header><p>{request.purpose}</p><footer><span>Solicitado por <b>{request.requestedBy}</b></span>{task && <span>EAP <b>{task.code} · {task.name}</b></span>}{request.reviewedBy && <span>Revisado por <b>{request.reviewedBy}</b></span>}{request.fulfilledBy && <span>Atendido por <b>{request.fulfilledBy}</b></span>}</footer>{request.reviewNote && <blockquote>{request.reviewNote}</blockquote>}{request.status === "pending" && <div className="request-actions"><button className="secondary-btn compact" onClick={() => onTransition({ request, status: "rejected" })}>Recusar</button><button className="primary-btn compact" onClick={() => onTransition({ request, status: "approved" })}>Aprovar</button></div>}{request.status === "approved" && <div className="request-actions"><button className="secondary-btn compact" onClick={() => onTransition({ request, status: "rejected" })}>Cancelar</button><button className="primary-btn compact" onClick={() => onTransition({ request, status: "fulfilled" })}>Atender e baixar</button></div>}</div></article>; })}{!item.requests?.length && <EmptyState text="Nenhuma requisição registrada neste material."/>}</div>}
  </div></Modal>;
}

function EmptyState({ text }: { text: string }) { return <div className="inventory-empty compact"><Icon name="info"/><span>{text}</span></div>; }

function InventoryForm({ item, tasks, processing, onClose, onSave, onDelete }: { item: InventoryItem; tasks: Task[]; processing: boolean; onClose: () => void; onSave: (item: InventoryItem) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [value, setValue] = useState(item); const executable = tasks.filter((task) => !tasks.some((child) => child.parentId === task.id));
  return <Modal title={item.id ? "Editar material" : "Cadastrar material"} subtitle="Defina o estoque mínimo e a necessidade prevista por EAP." onClose={onClose} wide><form className="inventory-form" onSubmit={(event) => { event.preventDefault(); void onSave(value); }}><label><span>Material</span><input required value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })}/></label><label><span>Categoria</span><input required value={value.category} onChange={(event) => setValue({ ...value, category: event.target.value })}/></label><label><span>Código / SKU</span><input value={value.sku ?? ""} onChange={(event) => setValue({ ...value, sku: event.target.value })}/></label><label><span>Unidade</span><input required value={value.unit} onChange={(event) => setValue({ ...value, unit: event.target.value })}/></label><label><span>Saldo {item.id ? "(somente por movimentação)" : "inicial"}</span><input disabled={!!item.id} type="number" min="0" step="0.001" value={value.quantity} onChange={(event) => setValue({ ...value, quantity: Number(event.target.value) })}/></label><label><span>Estoque mínimo</span><input type="number" min="0" step="0.001" value={value.minimum} onChange={(event) => setValue({ ...value, minimum: Number(event.target.value) })}/></label><label><span>Prazo de reposição (dias)</span><input type="number" min="0" value={value.leadDays} onChange={(event) => setValue({ ...value, leadDays: Number(event.target.value) })}/></label><section className="allocation-editor full"><header><div><span>RESERVAS POR EAP</span><p>Informe quanto deste material está previsto para cada atividade.</p></div></header>{value.allocations.map((allocation, index) => <div key={allocation.id || index}><select value={allocation.taskId} onChange={(event) => setValue({ ...value, allocations: value.allocations.map((entry, position) => position === index ? { ...entry, taskId: event.target.value } : entry) })}>{executable.map((task) => <option value={task.id} key={task.id}>{task.code} · {task.name}</option>)}</select><input aria-label="Quantidade planejada" type="number" min="0.001" step="0.001" value={allocation.planned} onChange={(event) => setValue({ ...value, allocations: value.allocations.map((entry, position) => position === index ? { ...entry, planned: Number(event.target.value) } : entry) })}/><button type="button" className="icon-btn tiny" onClick={() => setValue({ ...value, allocations: value.allocations.filter((_, position) => position !== index) })}><Icon name="close"/></button></div>)}<button type="button" className="text-btn" disabled={!executable.length} onClick={() => setValue({ ...value, allocations: [...value.allocations, { id: "", taskId: executable[0].id, planned: 1, consumed: 0 }] })}><Icon name="plus"/> Vincular EAP</button></section><div className="modal-actions full">{onDelete && <button type="button" className="danger-btn" disabled={processing} onClick={() => void onDelete()}>{processing ? "Excluindo..." : "Excluir"}</button>}<span/><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing ? <><span className="button-spinner"/>Salvando...</> : "Salvar material"}</button></div></form></Modal>;
}

function MovementForm({ item, movement, tasks, receivers, processing, onClose, onSave }: { item: InventoryItem; movement?: InventoryMovement; tasks: Task[]; receivers: ReceiverOption[]; processing: boolean; onClose: () => void; onSave: (type: MovementType, quantity: number, taskId?: string, purpose?: string, receiver?: string, receiverKind?: ReceiverOption["kind"], receiverId?: string, document?: string) => Promise<void> }) {
  const [type, setType] = useState<MovementType>(movement?.type ?? "entry"); const [quantity, setQuantity] = useState(movement?.quantity ?? 1); const [taskId, setTaskId] = useState(movement?.taskId ?? ""); const [purpose, setPurpose] = useState(movement?.purpose ?? ""); const [receiverKey, setReceiverKey] = useState(movement?.receiverKind && movement.receiverId ? `${movement.receiverKind}:${movement.receiverId}` : ""); const [document, setDocument] = useState(movement?.document ?? "");
  const selectedReceiver = receivers.find((option) => `${option.kind}:${option.id}` === receiverKey);
  return <Modal title={movement ? `Editar · ${movement.internalCode}` : `Movimentar · ${item.name}`} subtitle={movement ? `${item.name} · os saldos posteriores serão recalculados` : `Saldo atual: ${item.quantity} ${item.unit}`} onClose={onClose}><form className="invite-form" onSubmit={(event) => { event.preventDefault(); void onSave(type, quantity, taskId || undefined, purpose, selectedReceiver?.name, selectedReceiver?.kind, selectedReceiver?.id, document || undefined); }}>{movement?.requestId && <div className="form-warning"><Icon name="info"/> Esta saída nasceu de uma requisição atendida. O tipo permanece como saída e as informações da requisição serão sincronizadas.</div>}<label><span>Operação</span><select value={type} disabled={!!movement?.requestId} onChange={(event) => setType(event.target.value as MovementType)}><option value="entry">Entrada</option><option value="exit">Saída / retirada</option><option value="adjustment">Ajustar saldo para</option></select></label><label><span>{type === "adjustment" ? "Novo saldo naquele momento" : "Quantidade"}</span><input required type="number" min={type === "adjustment" ? 0 : 0.001} max={!movement && type === "exit" ? item.quantity : undefined} step="0.001" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/></label>{type === "exit" && <label><span>Destinado à EAP</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">Sem vínculo específico</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.code} · {task.name}</option>)}</select></label>}<label><span>Motivo / finalidade</span><textarea required rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Compra, consumo na atividade, devolução, inventário..."/></label>{type === "exit" && <label><span>Quem recebeu</span><select required value={receiverKey} onChange={(event) => setReceiverKey(event.target.value)}><option value="">Selecione um usuário, equipe ou colaborador</option><optgroup label="Usuários da plataforma">{receivers.filter((option) => option.kind === "user").map((option) => <option key={`user:${option.id}`} value={`user:${option.id}`}>{option.label}</option>)}</optgroup><optgroup label="Equipes de campo">{receivers.filter((option) => option.kind === "team").map((option) => <option key={`team:${option.id}`} value={`team:${option.id}`}>{option.label}</option>)}</optgroup><optgroup label="Colaboradores das empresas">{receivers.filter((option) => option.kind === "worker").map((option) => <option key={`worker:${option.id}`} value={`worker:${option.id}`}>{option.label}</option>)}</optgroup></select>{!receivers.length && <small>Cadastre usuários ou colaboradores na tela Equipe antes de retirar.</small>}</label>}<div className="system-reference"><Icon name={movement ? "info" : "lock"}/><div><strong>{movement ? `Referência preservada: ${movement.internalCode}` : "Número interno automático"}</strong><p>{movement ? "A alteração ficará registrada na trilha de auditoria." : "O sistema criará uma referência única no formato MOV-000000 ao confirmar."}</p></div></div><label><span>Documento externo (opcional)</span><input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="Nota fiscal, OS ou protocolo externo"/></label><div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={processing || (type === "exit" && !selectedReceiver)}>{processing ? <><span className="button-spinner"/>Processando...</> : movement ? "Salvar e recalcular" : "Confirmar movimentação"}</button></div></form></Modal>;
}

function MovementDeleteConfirm({ data, processing, onClose, onConfirm }: { data: { item: InventoryItem; movement: InventoryMovement }; processing: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <Modal title="Excluir movimentação" subtitle={`${data.movement.internalCode} · ${data.item.name}`} onClose={onClose}><div className="confirm-delete-modal"><span className="confirm-delete-icon"><Icon name="trash"/></span><h3>Excluir esta movimentação?</h3><p>O efeito dela será retirado do estoque, e todos os saldos posteriores e consumos por EAP serão recalculados. A versão excluída continuará preservada na auditoria.</p>{data.movement.requestId && <div className="form-warning"><Icon name="info"/> A requisição relacionada voltará para o status “Aprovada” e poderá ser atendida novamente.</div>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={processing} onClick={onClose}>Cancelar</button><button type="button" className="danger-btn" disabled={processing} onClick={() => void onConfirm()}>{processing ? <><span className="button-spinner"/>Excluindo...</> : "Excluir movimentação"}</button></div></div></Modal>;
}

function RequestForm({ item, items, tasks, processing, onClose, onChangeItem, onSave }: { item: InventoryItem; items: InventoryItem[]; tasks: Task[]; processing: boolean; onClose: () => void; onChangeItem: (id: string) => void; onSave: (request: Pick<InventoryRequest, "itemId" | "taskId" | "quantity" | "purpose">) => Promise<void> }) {
  const [quantity, setQuantity] = useState(1); const [taskId, setTaskId] = useState(""); const [purpose, setPurpose] = useState("");
  return <Modal title="Nova requisição de material" subtitle="A solicitação ficará registrada em nome do usuário conectado." onClose={onClose}><form className="invite-form" onSubmit={(event) => { event.preventDefault(); void onSave({ itemId: item.id, taskId: taskId || undefined, quantity, purpose }); }}><label><span>Material</span><select value={item.id} onChange={(event) => onChangeItem(event.target.value)}>{items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.quantity} {entry.unit}</option>)}</select></label><label><span>Quantidade solicitada</span><input required type="number" min="0.001" step="0.001" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))}/></label><label><span>Atividade / EAP</span><select value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">Uso geral da obra</option>{tasks.map((task) => <option value={task.id} key={task.id}>{task.code} · {task.name}</option>)}</select></label><label><span>Finalidade</span><textarea required rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Informe onde e para que o material será utilizado."/></label>{quantity > item.quantity && <p className="form-warning"><Icon name="alert"/> A quantidade supera o saldo atual. A requisição poderá ser aprovada, mas só será atendida após reposição.</p>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing ? <><span className="button-spinner"/>Enviando...</> : "Enviar requisição"}</button></div></form></Modal>;
}

function TransitionForm({ data, receivers, processing, onClose, onSave }: { data: { request: InventoryRequest; status: RequestStatus }; receivers: ReceiverOption[]; processing: boolean; onClose: () => void; onSave: (note?: string, receiver?: string, receiverKind?: ReceiverOption["kind"], receiverId?: string, document?: string) => Promise<void> }) {
  const [note, setNote] = useState(""); const [receiverKey, setReceiverKey] = useState(""); const [document, setDocument] = useState(""); const fulfilling = data.status === "fulfilled"; const selectedReceiver = receivers.find((option) => `${option.kind}:${option.id}` === receiverKey);
  return <Modal title={fulfilling ? "Atender requisição" : data.status === "approved" ? "Aprovar requisição" : "Recusar requisição"} subtitle={`${data.request.quantity} unidades · ${data.request.purpose}`} onClose={onClose}><form className="invite-form" onSubmit={(event) => { event.preventDefault(); void onSave(note || undefined, selectedReceiver?.name, selectedReceiver?.kind, selectedReceiver?.id, document || undefined); }}>{fulfilling && <><label><span>Entregue para</span><select required value={receiverKey} onChange={(event) => setReceiverKey(event.target.value)}><option value="">Selecione o destinatário</option>{receivers.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.label}</option>)}</select></label><div className="system-reference"><Icon name="lock"/><div><strong>Número interno automático</strong><p>Será gerado ao atender e baixar o estoque.</p></div></div><label><span>Documento externo (opcional)</span><input value={document} onChange={(event) => setDocument(event.target.value)} placeholder="Nota fiscal, OS ou protocolo externo"/></label></>}<label><span>{data.status === "rejected" ? "Motivo da recusa" : "Observação"}</span><textarea required={data.status === "rejected"} rows={3} value={note} onChange={(event) => setNote(event.target.value)}/></label><div className="modal-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className={data.status === "rejected" ? "danger-btn" : "primary-btn"} disabled={processing || (fulfilling && !selectedReceiver)}>{processing ? <><span className="button-spinner"/>Processando...</> : fulfilling ? "Atender e baixar estoque" : data.status === "approved" ? "Aprovar" : "Confirmar recusa"}</button></div></form></Modal>;
}

type ImportResult = { items: InventoryItem[]; errors: string[]; rowCount: number };
function parseCsvLine(line: string) { const values: string[] = []; let value = ""; let quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"') { if (quoted && line[index + 1] === '"') { value += '"'; index += 1; } else quoted = !quoted; } else if (char === ";" && !quoted) { values.push(value.trim()); value = ""; } else value += char; } values.push(value.trim()); return values; }
function validateImport(text: string, existing: InventoryItem[], tasks: Task[]): ImportResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); if (!lines.length) return { items: [], errors: ["O arquivo está vazio."], rowCount: 0 };
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase()); const errors: string[] = [];
  if (headers.join("|") !== IMPORT_HEADERS.join("|")) errors.push(`Cabeçalho inválido. Use exatamente: ${IMPORT_HEADERS.join("; ")}.`);
  const grouped = new Map<string, InventoryItem>(); const allocationKeys = new Set<string>(); const existingSkus = new Set(existing.map((item) => item.sku?.toLowerCase()).filter(Boolean));
  lines.slice(1).forEach((line, offset) => { const number = offset + 2; const cells = parseCsvLine(line); if (cells.length !== IMPORT_HEADERS.length) { errors.push(`Linha ${number}: possui ${cells.length} colunas; eram esperadas ${IMPORT_HEADERS.length}.`); return; }
    const [name, category, sku, unit, rawQuantity, rawMinimum, rawLead, eap, rawPlanned] = cells; const quantity = Number(rawQuantity.replace(",", ".")); const minimum = Number(rawMinimum.replace(",", ".")); const leadDays = Number(rawLead); const planned = Number(rawPlanned.replace(",", ".")); const key = sku.toLowerCase(); const task = tasks.find((entry) => entry.code.toLowerCase() === eap.toLowerCase());
    if (!name || !category || !sku || !unit) errors.push(`Linha ${number}: material, categoria, código SKU e unidade são obrigatórios.`);
    if ([quantity, minimum, leadDays, planned].some((entry) => !Number.isFinite(entry) || entry < 0)) errors.push(`Linha ${number}: quantidades e prazos devem ser números iguais ou maiores que zero.`);
    if (!Number.isInteger(leadDays)) errors.push(`Linha ${number}: prazo de reposição deve ser um número inteiro.`);
    if (!eap || !task) errors.push(`Linha ${number}: EAP "${eap || "vazio"}" não existe neste cronograma.`);
    if (planned <= 0) errors.push(`Linha ${number}: quantidade prevista deve ser maior que zero.`);
    if (existingSkus.has(key)) errors.push(`Linha ${number}: o SKU ${sku} já existe no estoque.`);
    const allocationKey = `${key}|${eap.toLowerCase()}`; if (allocationKeys.has(allocationKey)) errors.push(`Linha ${number}: o SKU ${sku} já possui uma reserva para a EAP ${eap}.`); allocationKeys.add(allocationKey);
    const current = grouped.get(key); if (current && (current.name !== name || current.category !== category || current.unit !== unit || current.quantity !== quantity || current.minimum !== minimum || current.leadDays !== leadDays)) errors.push(`Linha ${number}: dados gerais do SKU ${sku} divergem das linhas anteriores.`);
    if (!current) grouped.set(key, { id: "", name, category, sku, unit, quantity, minimum, leadDays, allocations: [] });
    if (task && planned > 0) grouped.get(key)?.allocations.push({ id: "", taskId: task.id, planned, consumed: 0 });
  });
  return { items: [...grouped.values()], errors: [...new Set(errors)], rowCount: Math.max(0, lines.length - 1) };
}
function ImportForm({ existing, tasks, processing, fileRef, onClose, onImport }: { existing: InventoryItem[]; tasks: Task[]; processing: boolean; fileRef: RefObject<HTMLInputElement | null>; onClose: () => void; onImport: (items: InventoryItem[]) => Promise<void> }) {
  const [result, setResult] = useState<ImportResult | null>(null); const [fileName, setFileName] = useState("");
  return <Modal title="Importar estoque" subtitle="A validação é integral: se uma linha tiver erro, nenhum dado será importado." onClose={onClose} wide><div className="inventory-import"><div className="import-instructions"><Icon name="info"/><div><strong>Use o modelo CSV da plataforma</strong><p>Não altere os nomes ou a ordem das colunas. Repita o mesmo SKU em linhas diferentes para vinculá-lo a mais de uma EAP.</p><a className="text-btn" href="/modelo-importacao-estoque.csv" download><Icon name="download"/> Baixar modelo preenchido</a></div></div><input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); const reader = new FileReader(); reader.onload = () => setResult(validateImport(String(reader.result ?? ""), existing, tasks)); reader.readAsText(file, "UTF-8"); }}/><button className="import-dropzone" onClick={() => fileRef.current?.click()}><Icon name="download"/><strong>{fileName || "Selecionar arquivo CSV"}</strong><span>Clique para escolher o arquivo preenchido</span></button>{result && <section className={result.errors.length ? "import-result error" : "import-result success"}><header><Icon name={result.errors.length ? "alert" : "check"}/><div><strong>{result.errors.length ? "Importação bloqueada" : "Arquivo validado"}</strong><span>{result.rowCount} linhas · {result.items.length} materiais identificados</span></div></header>{result.errors.length ? <ul>{result.errors.map((error) => <li key={error}>{error}</li>)}</ul> : <p>Todos os campos, SKUs, números e vínculos EAP estão consistentes. O lote pode ser importado.</p>}</section>}<div className="modal-actions"><button className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={processing || !result || !!result.errors.length || !result.items.length} onClick={() => result && void onImport(result.items)}>{processing ? <><span className="button-spinner"/>Importando...</> : "Importar lote"}</button></div></div></Modal>;
}
