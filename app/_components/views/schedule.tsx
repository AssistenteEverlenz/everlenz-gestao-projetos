"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import { EntryHistoryModal } from "../entry-history";
import { Icon } from "../icons";
import type { DependencyType, JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; addTask: (task: Task) => void; editTask: (task: Task) => Promise<void>; editEntry: (entry: JournalEntry) => Promise<void>; reorderTasks: (tasks: Task[]) => Promise<void>; updateTaskProgress: (id: string, progress: number) => void; setToast: (value: string) => void };

const dayMs = 86_400_000;
const colors = ["#e98243", "#4b7164", "#55768a", "#8c6c9c", "#b85b50", "#c09a42"];
const toDate = (value: string) => new Date(`${value}T12:00:00`);
const daysBetween = (start: string, end: string) => Math.max(0, Math.round((toDate(end).getTime() - toDate(start).getTime()) / dayMs));
const duration = (task: Task) => Math.max(1, daysBetween(task.plannedStart, task.plannedEnd) + 1);
const formatDate = (value: string) => toDate(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).replace(" de ", " ");

export function Schedule({ project, tasks, entries, members, metrics, addTask, editTask, editEntry, reorderTasks, updateTaskProgress, setToast }: Props) {
  const [selected, setSelected] = useState<Task | null>(null);
  const [editing, setEditing] = useState(false);
  const [historyTask, setHistoryTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [zoom, setZoom] = useState<"Dias" | "Semanas">("Semanas");
  const [showBaseline, setShowBaseline] = useState(true);
  const [filterCritical, setFilterCritical] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "done" | "waiting">("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<{ targetId: string; asChild: boolean } | null>(null);
  const visible = useMemo(() => tasks.filter((task) => !filterCritical || task.critical).filter((task) => !hideCompleted || statusFilter === "done" || task.progress < 100).filter((task) => statusFilter === "all" || statusFilter === "active" && task.progress > 0 && task.progress < 100 || statusFilter === "done" && task.progress === 100 || statusFilter === "waiting" && task.progress === 0), [filterCritical, hideCompleted, statusFilter, tasks]);
  const projectDays = Math.max(1, daysBetween(project.start, project.end) + 1);
  const planned = useMemo(() => {
    const measurable = tasks.filter((task) => !tasks.some((child) => child.parentId === task.id));
    const today = new Date();
    const weighted = measurable.reduce((sum, task) => {
      const start = toDate(task.plannedStart); const end = toDate(task.plannedEnd);
      const expected = today < start ? 0 : today >= end ? 100 : Math.round(((today.getTime() - start.getTime()) / Math.max(dayMs, end.getTime() - start.getTime())) * 100);
      return sum + expected * task.weight;
    }, 0);
    const weight = measurable.reduce((sum, task) => sum + task.weight, 0);
    return weight ? Math.round(weighted / weight) : 0;
  }, [tasks]);
  const timelineLabels = useMemo(() => Array.from({ length: zoom === "Dias" ? 14 : 8 }, (_, index) => {
    const date = toDate(project.start); date.setDate(date.getDate() + index * (zoom === "Dias" ? Math.max(1, Math.floor(projectDays / 14)) : Math.max(7, Math.floor(projectDays / 8))));
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).toUpperCase().replace(" DE ", " ");
  }), [project.start, projectDays, zoom]);

  function barStyle(task: Task, baseline = false) {
    const startValue = baseline ? task.baselineStart : task.plannedStart;
    const endValue = baseline ? task.baselineEnd : task.plannedEnd;
    if (!startValue || !endValue) return { display: "none" };
    return { left: `${Math.min(99, daysBetween(project.start, startValue) / projectDays * 100)}%`, width: `${Math.max(0.8, (daysBetween(startValue, endValue) + 1) / projectDays * 100)}%` };
  }
  function taskDepth(task: Task) { let depth = 0; let parentId = task.parentId; while (parentId && depth < 6) { depth += 1; parentId = tasks.find((item) => item.id === parentId)?.parentId; } return depth; }
  function descendantIds(taskId: string) { const found = new Set<string>(); const visit = (parentId: string) => tasks.filter((task) => task.parentId === parentId).forEach((task) => { found.add(task.id); visit(task.id); }); visit(taskId); return found; }
  function updateDropIntent(event: ReactDragEvent<HTMLElement>, targetId: string) {
    event.preventDefault();
    if (!draggingId || draggingId === targetId || descendantIds(draggingId).has(targetId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIntent({ targetId, asChild: event.clientX > bounds.left + Math.min(150, bounds.width * .34) });
  }
  async function applyReorder(target: Task, childIntent?: boolean) {
    const dragged = tasks.find((task) => task.id === draggingId);
    if (!dragged || dragged.id === target.id || descendantIds(dragged.id).has(target.id)) return resetDrag();
    const movingIds = new Set([dragged.id, ...descendantIds(dragged.id)]);
    const moving = tasks.filter((task) => movingIds.has(task.id));
    const remaining = tasks.filter((task) => !movingIds.has(task.id));
    const asChild = childIntent ?? (dropIntent?.targetId === target.id && dropIntent.asChild);
    const targetTree = descendantIds(target.id);
    const targetIndex = remaining.findIndex((task) => task.id === target.id);
    const targetEnd = asChild ? targetIndex : remaining.reduce((last, task, index) => targetTree.has(task.id) ? index : last, targetIndex);
    const normalizedMoving = moving.map((task) => task.id === dragged.id ? { ...task, parentId: asChild ? target.id : undefined } : task);
    remaining.splice(targetEnd + 1, 0, ...normalizedMoving);
    resetDrag();
    try { await reorderTasks(remaining); } catch (cause) { setToast(cause instanceof Error ? cause.message : "Não foi possível reorganizar o Gantt."); }
  }
  async function applyDrop(event: ReactDragEvent<HTMLElement>, target: Task) { event.preventDefault(); await applyReorder(target); }
  function pointerTarget(event: ReactPointerEvent<HTMLElement>) {
    return (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-task-id]") ?? null;
  }
  function beginPointerDrag(event: ReactPointerEvent<HTMLElement>, taskId: string) {
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); setDraggingId(taskId);
  }
  function movePointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingId) return;
    const row = pointerTarget(event); const targetId = row?.dataset.taskId;
    if (!row || !targetId || targetId === draggingId || descendantIds(draggingId).has(targetId)) return;
    const bounds = row.getBoundingClientRect();
    setDropIntent({ targetId, asChild: event.clientX > bounds.left + Math.min(150, bounds.width * .34) });
  }
  function endPointerDrag(event: ReactPointerEvent<HTMLElement>) {
    if (!draggingId) return;
    const row = pointerTarget(event); const target = tasks.find((task) => task.id === row?.dataset.taskId);
    if (target && row) { const bounds = row.getBoundingClientRect(); void applyReorder(target, event.clientX > bounds.left + Math.min(150, bounds.width * .34)); } else resetDrag();
  }
  function resetDrag() { setDraggingId(null); setDropIntent(null); }

  if (!tasks.length) return <div className="view-stack schedule-view"><section className="empty-schedule glass"><span className="empty-workspace-icon"><Icon name="gantt" /></span><span className="overline">CRONOGRAMA EM BRANCO</span><h2>Monte a estrutura da obra</h2><p>Comece pelas etapas principais e depois adicione subitens, responsáveis, datas, dependências e pesos. O Diário de Obra será liberado assim que houver uma atividade executável.</p><div className="gantt-feature-grid"><span><Icon name="calendar"/><b>Datas e linha de base</b></span><span><Icon name="team"/><b>Responsáveis</b></span><span><Icon name="trend"/><b>Pesos e progresso</b></span><span><Icon name="gantt"/><b>Pais e dependências</b></span></div><button className="primary-btn" onClick={() => setCreating(true)}><Icon name="plus"/> Criar primeira atividade</button></section>{creating && <TaskForm project={project} tasks={tasks} members={members} onClose={() => setCreating(false)} onSave={(task) => { addTask(task); setCreating(false); }} />}</div>;

  return <div className="view-stack schedule-view">
    <section className="schedule-toolbar glass">
      <div className="toolbar-group"><button className="primary-btn compact" onClick={() => setCreating(true)}><Icon name="plus"/> Nova atividade</button><button className="secondary-btn compact"><Icon name="filter"/> Filtros</button></div>
      <div className="toolbar-group center"><button className={filterCritical ? "toggle-chip active" : "toggle-chip"} onClick={() => setFilterCritical((value) => !value)}><span className="critical-dot"/> Caminho crítico</button><label className="switch-label"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)}/><span/> Linha de base</label></div>
      <div className="segmented"><button className={zoom === "Dias" ? "active" : ""} onClick={() => setZoom("Dias")}>Dias</button><button className={zoom === "Semanas" ? "active" : ""} onClick={() => setZoom("Semanas")}>Semanas</button></div>
      <div className="gantt-quick-filters"><button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>Todas <b>{tasks.length}</b></button><button className={statusFilter === "active" ? "active" : ""} onClick={() => setStatusFilter("active")}>Em andamento <b>{tasks.filter((task) => task.progress > 0 && task.progress < 100).length}</b></button><button className={statusFilter === "waiting" ? "active" : ""} onClick={() => setStatusFilter("waiting")}>Aguardando <b>{tasks.filter((task) => task.progress === 0).length}</b></button><button className={statusFilter === "done" ? "active" : ""} onClick={() => setStatusFilter("done")}>Concluídas <b>{tasks.filter((task) => task.progress === 100).length}</b></button><label className="switch-label hide-completed"><input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)}/><span/> Ocultar concluídas</label></div>
    </section>

    <section className="gantt-shell glass">
      <div className="gantt-summary"><div><span>AVANÇO REAL</span><strong>{metrics.overall}%</strong></div><div><span>PLANEJADO</span><strong>{planned}%</strong></div><div><span>DESVIO</span><strong className={metrics.overall < planned ? "danger" : ""}>{metrics.overall - planned > 0 ? "+" : ""}{metrics.overall - planned} p.p.</strong></div><div><span>TÉRMINO PREVISTO</span><strong>{formatDate(project.end)}</strong></div><div><span>CAMINHO CRÍTICO</span><strong className="danger">{tasks.filter((task) => task.critical).length} atividades</strong></div></div>
      <div className="gantt-scroll">
        <div className={`gantt-grid ${zoom === "Dias" ? "zoom-days" : ""}`}>
          <div className="task-table-head"><span>EAP</span><span>ATIVIDADE</span><span>DURAÇÃO</span><span>%</span></div>
          <div className="timeline-head">{timelineLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
          {visible.map((task) => <div data-task-id={task.id} draggable onDragStart={(event) => { setDraggingId(task.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => updateDropIntent(event, task.id)} onDrop={(event) => void applyDrop(event, task)} onDragEnd={resetDrag} className={`gantt-row ${task.critical ? "critical" : ""} ${draggingId === task.id ? "is-dragging" : ""} ${dropIntent?.targetId === task.id ? dropIntent.asChild ? "drop-as-child" : "drop-as-root" : ""}`} key={task.id}>
            <span className="drag-grip" role="button" aria-label={`Reorganizar ${task.name}`} onPointerDown={(event) => beginPointerDrag(event, task.id)} onPointerMove={movePointerDrag} onPointerUp={endPointerDrag}>••</span>
            <button className="task-row" onClick={() => setSelected(task)}><span>{task.code}</span><span style={{ paddingLeft: taskDepth(task) * 12 }}><strong>{task.name}</strong><small>{task.responsible || "Sem responsável"}{entries.filter((entry) => entry.taskId === task.id).length > 0 && <em className="task-journal-count"><Icon name="journal"/> {entries.filter((entry) => entry.taskId === task.id).length}</em>}</small></span><span>{task.milestone ? "Marco" : `${duration(task)}d`}</span><span><b>{task.progress}%</b></span></button>
            <button className="timeline-row" onClick={() => setSelected(task)} aria-label={`Editar ${task.name}`}>
              <div className="day-lines">{Array.from({ length: 16 }, (_, day) => <i key={day}/>)}</div>
              {showBaseline && <span className="baseline-bar" style={barStyle(task, true)}/>}
              {task.milestone ? <span className="milestone" style={{ ...barStyle(task), width: undefined }}/> : <span className="gantt-bar" style={{ ...barStyle(task), background: task.color }}><i style={{ width: `${task.progress}%` }}/>{duration(task) > 2 && <b>{task.progress}%</b>}</span>}
            </button>
          </div>)}
        </div>
      </div>
      <div className="gantt-mobile-list">{visible.map((task) => { const depth = taskDepth(task); const journalCount = entries.filter((entry) => entry.taskId === task.id).length; const childCount = tasks.filter((item) => item.parentId === task.id).length; return <button data-task-id={task.id} draggable onDragStart={(event) => { setDraggingId(task.id); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => updateDropIntent(event, task.id)} onDrop={(event) => void applyDrop(event, task)} onDragEnd={resetDrag} key={task.id} className={`gantt-mobile-card ${depth ? "is-child" : ""} ${childCount ? "is-parent" : ""} ${draggingId === task.id ? "is-dragging" : ""} ${dropIntent?.targetId === task.id ? dropIntent.asChild ? "drop-as-child" : "drop-as-root" : ""}`} style={{ "--task-depth": depth } as CSSProperties} onClick={() => { if (!draggingId) setSelected(task); }}><span className="drag-grip" role="button" aria-label={`Reorganizar ${task.name}`} onPointerDown={(event) => beginPointerDrag(event, task.id)} onPointerMove={movePointerDrag} onPointerUp={endPointerDrag}>••</span><span className="mobile-task-color" style={{ background: task.color }}/><div><small>{task.code} · {task.phase}{childCount > 0 && ` · ${childCount} subitem${childCount > 1 ? "s" : ""}`}</small><strong>{task.name}</strong><span><Icon name="calendar"/>{formatDate(task.plannedStart)} → {formatDate(task.plannedEnd)}</span><span><Icon name="team"/>{task.responsible || "Sem responsável"}{journalCount > 0 && <em className="mobile-journal-count"><Icon name="journal"/>{journalCount}</em>}</span><div className="thin-progress"><i style={{ width: `${task.progress}%`, background: task.color }}/></div></div><b>{task.progress}%</b></button>; })}</div>
      <footer className="gantt-legend"><span><i className="legend-plan"/> Planejado</span><span><i className="legend-done"/> Realizado</span><span><i className="legend-base"/> Linha de base</span><span><i className="legend-critical"/> Caminho crítico</span></footer>
    </section>

    {creating && <TaskForm project={project} tasks={tasks} members={members} onClose={() => setCreating(false)} onSave={(task) => { addTask(task); setCreating(false); }} />}
    {selected && <Modal title={editing ? `Editar ${selected.name}` : selected.name} subtitle={`${selected.phase} · Atividade ${selected.code}`} onClose={() => { setSelected(null); setEditing(false); }} wide>
      {editing ? <TaskForm project={project} tasks={tasks} members={members} initial={selected} onClose={() => setEditing(false)} onSave={async (task) => { await editTask(task); setSelected(task); setEditing(false); }}/>
      : <div className="task-modal-body"><div className="task-detail-grid"><span><small>INÍCIO</small><strong>{formatDate(selected.plannedStart)}</strong></span><span><small>TÉRMINO</small><strong>{formatDate(selected.plannedEnd)}</strong></span><span><small>RESPONSÁVEL</small><strong>{selected.responsible || "Não definido"}</strong></span><span><small>PREDECESSORA</small><strong>{selected.dependencyId ? `${tasks.find((task) => task.id === selected.dependencyId)?.code} · ${selected.dependencyType} ${selected.lagDays ? `+${selected.lagDays}d` : ""}` : "Nenhuma"}</strong></span></div><label className="range-field"><span>Avanço físico <strong>{selected.progress}%</strong></span><input type="range" min="0" max="100" value={selected.progress} onChange={(event) => setSelected({ ...selected, progress: Number(event.target.value) })}/><div><small>0%</small><small>50%</small><small>100%</small></div></label><div className="task-history-callout"><Icon name="journal"/><div><strong>Diário de Obra desta atividade</strong><span>{entries.filter((entry) => entry.taskId === selected.id).length ? `${entries.filter((entry) => entry.taskId === selected.id).length} registro(s) com descrições, medições e fotos.` : "Ainda não há registros de campo vinculados."}</span></div><button className="secondary-btn" disabled={!entries.some((entry) => entry.taskId === selected.id)} onClick={() => { setHistoryTask(selected); setSelected(null); }}>Ver diários</button></div><div className="modal-note"><Icon name="journal"/><p><strong>Medição preferencial pelo Diário de Obra</strong><br/>Use o ajuste manual apenas para correções. No uso diário, registre o percentual junto com as evidências.</p></div><div className="modal-actions split-actions"><button className="secondary-btn" onClick={() => setEditing(true)}><Icon name="settings"/> Editar dados</button><span/><button className="secondary-btn" onClick={() => setSelected(null)}>Fechar</button><button className="primary-btn" onClick={() => { updateTaskProgress(selected.id, selected.progress); setSelected(null); setToast("Progresso manual atualizado."); }}>Salvar avanço</button></div></div>}
    </Modal>}
    {historyTask && <EntryHistoryModal
      task={historyTask}
      entries={entries.filter((entry) => entry.taskId === historyTask.id)}
      onClose={() => setHistoryTask(null)}
      onUpdate={editEntry}
    />}
  </div>;
}

function TaskForm({ project, tasks, members, initial, onClose, onSave }: { project: Project; tasks: Task[]; members: Member[]; initial?: Task; onClose: () => void; onSave: (task: Task) => void | Promise<void> }) {
  const [nextId] = useState(() => initial?.id ?? crypto.randomUUID());
  const [name, setName] = useState(initial?.name ?? ""); const [code, setCode] = useState(initial?.code ?? String(tasks.length + 1)); const [phase, setPhase] = useState(initial?.phase ?? "");
  const [plannedStart, setPlannedStart] = useState(initial?.plannedStart ?? project.start); const [plannedEnd, setPlannedEnd] = useState(initial?.plannedEnd ?? project.start);
  const [baselineStart, setBaselineStart] = useState(initial?.baselineStart ?? project.start); const [baselineEnd, setBaselineEnd] = useState(initial?.baselineEnd ?? project.start);
  const [responsible, setResponsible] = useState(initial?.responsible ?? ""); const [parentId, setParentId] = useState(initial?.parentId ?? ""); const [dependencyId, setDependencyId] = useState(initial?.dependencyId ?? "");
  const [dependencyType, setDependencyType] = useState<DependencyType>(initial?.dependencyType ?? "FS"); const [lagDays, setLagDays] = useState(initial?.lagDays ?? 0); const [weight, setWeight] = useState(initial?.weight ?? 1);
  const [color, setColor] = useState(initial?.color ?? colors[tasks.length % colors.length]); const [critical, setCritical] = useState(Boolean(initial?.critical)); const [milestone, setMilestone] = useState(Boolean(initial?.milestone)); const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); setError(""); try { await onSave({ id: nextId, code, name, phase: phase || "Sem etapa", plannedStart, plannedEnd: milestone ? plannedStart : plannedEnd, baselineStart, baselineEnd: milestone ? baselineStart : baselineEnd, progress: initial?.progress ?? 0, weight, responsible, parentId: parentId || undefined, dependencyId: dependencyId || undefined, dependencyType: dependencyId ? dependencyType : undefined, lagDays: dependencyId ? lagDays : undefined, color, critical, milestone, notes }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a atividade."); setSaving(false); } }
  const availableTasks = tasks.filter((task) => task.id !== initial?.id);
  const form = <form className="task-form" onSubmit={submit}><label><span>Código EAP</span><input required value={code} onChange={(event) => setCode(event.target.value)} placeholder="Ex.: 2.1"/></label><label className="grow"><span>Nome da atividade</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Armação da laje"/></label><label><span>Etapa / disciplina</span><input required value={phase} onChange={(event) => setPhase(event.target.value)} placeholder="Estrutura"/></label><label><span>Item pai</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Sem item pai</option>{availableTasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select></label><label><span>Início planejado</span><input type="date" min={project.start} max={project.end} required value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)}/></label><label><span>Término planejado</span><input type="date" min={plannedStart} max={project.end} required disabled={milestone} value={milestone ? plannedStart : plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)}/></label><label><span>Início da linha de base</span><input type="date" value={baselineStart} onChange={(event) => setBaselineStart(event.target.value)}/></label><label><span>Término da linha de base</span><input type="date" min={baselineStart} disabled={milestone} value={milestone ? baselineStart : baselineEnd} onChange={(event) => setBaselineEnd(event.target.value)}/></label><label><span>Responsável</span><select value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="">Definir depois</option>{members.filter((member) => member.role !== "Cliente" && !member.pending).map((member) => <option key={member.id}>{member.name}</option>)}</select></label><label><span>Peso no avanço</span><input type="number" min="0.01" step="0.01" required value={weight} onChange={(event) => setWeight(Number(event.target.value))}/></label><label><span>Atividade predecessora</span><select value={dependencyId} onChange={(event) => setDependencyId(event.target.value)}><option value="">Sem dependência</option>{availableTasks.map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select></label><label className="dependency-fields"><span>Relação e espera</span><span><select value={dependencyType} disabled={!dependencyId} onChange={(event) => setDependencyType(event.target.value as DependencyType)}><option value="FS">Término → Início (FS)</option><option value="SS">Início → Início (SS)</option><option value="FF">Término → Término (FF)</option><option value="SF">Início → Término (SF)</option></select><input aria-label="Dias de espera" type="number" disabled={!dependencyId} value={lagDays} onChange={(event) => setLagDays(Number(event.target.value))}/></span></label><label className="color-field"><span>Cor da atividade</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)}/></label><div className="task-checks"><label><input type="checkbox" checked={critical} onChange={(event) => setCritical(event.target.checked)}/><span>Caminho crítico</span></label><label><input type="checkbox" checked={milestone} onChange={(event) => setMilestone(event.target.checked)}/><span>Marco do projeto</span></label></div><label className="full"><span>Observações técnicas</span><textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Premissas, restrições, critérios de aceite..."/></label>{error && <div className="access-message full"><Icon name="alert"/>{error}</div>}<div className="modal-actions full"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={saving}><Icon name="check"/> {saving ? "Salvando..." : initial ? "Salvar correções" : "Adicionar atividade"}</button></div></form>;
  return initial ? form : <Modal title="Nova atividade do Gantt" subtitle="Configure planejamento, hierarquia, responsabilidade e dependências." onClose={onClose} wide>{form}</Modal>;
}
