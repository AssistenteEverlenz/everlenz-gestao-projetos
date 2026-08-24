"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; updateTaskProgress: (id: number, progress: number) => void; setToast: (value: string) => void };
const days = Array.from({ length: 84 }, (_, index) => index);
const weeks = ["03 AGO", "10 AGO", "17 AGO", "24 AGO", "31 AGO", "07 SET", "14 SET", "21 SET", "28 SET", "05 OUT", "12 OUT", "19 OUT"];

export function Schedule({ tasks, updateTaskProgress, setToast }: Props) {
  const [selected, setSelected] = useState<Task | null>(null);
  const [zoom, setZoom] = useState<"Dias" | "Semanas">("Semanas");
  const [showBaseline, setShowBaseline] = useState(true);
  const [filterCritical, setFilterCritical] = useState(false);
  const visible = useMemo(() => filterCritical ? tasks.filter((task) => task.critical) : tasks, [filterCritical, tasks]);

  return <div className="view-stack schedule-view">
    <section className="schedule-toolbar glass">
      <div className="toolbar-group"><button className="primary-btn compact" onClick={() => setToast("A criação de atividades será conectada ao banco na próxima etapa.")}><Icon name="plus"/> Nova atividade</button><button className="secondary-btn compact"><Icon name="filter"/> Filtros</button></div>
      <div className="toolbar-group center"><button className={filterCritical ? "toggle-chip active" : "toggle-chip"} onClick={() => setFilterCritical((value) => !value)}><span className="critical-dot"/> Caminho crítico</button><label className="switch-label"><input type="checkbox" checked={showBaseline} onChange={(event) => setShowBaseline(event.target.checked)}/><span/> Linha de base</label></div>
      <div className="segmented"><button className={zoom === "Dias" ? "active" : ""} onClick={() => setZoom("Dias")}>Dias</button><button className={zoom === "Semanas" ? "active" : ""} onClick={() => setZoom("Semanas")}>Semanas</button></div>
    </section>

    <section className="gantt-shell glass">
      <div className="gantt-summary"><div><span>AVANÇO REAL</span><strong>38%</strong></div><div><span>PLANEJADO</span><strong>41%</strong></div><div><span>DESVIO</span><strong className="danger">−3,0 p.p.</strong></div><div><span>TÉRMINO PREVISTO</span><strong>18 FEV 2027</strong></div><div><span>CAMINHO CRÍTICO</span><strong className="danger">4 atividades</strong></div></div>
      <div className="gantt-scroll">
        <div className={`gantt-grid ${zoom === "Dias" ? "zoom-days" : ""}`}>
          <div className="task-table-head"><span>ID</span><span>ATIVIDADE</span><span>DURAÇÃO</span><span>%</span></div>
          <div className="timeline-head">{weeks.map((week) => <span key={week}>{week}</span>)}</div>
          {visible.map((task) => <div className={`gantt-row ${task.critical ? "critical" : ""}`} key={task.id}>
            <button className="task-row" onClick={() => setSelected(task)}><span>{task.code}</span><span><strong>{task.name}</strong><small>{task.responsible}</small></span><span>{task.milestone ? "Marco" : `${task.duration}d`}</span><span><b>{task.progress}%</b></span></button>
            <button className="timeline-row" onClick={() => setSelected(task)} aria-label={`Editar ${task.name}`}>
              <div className="day-lines">{days.map((day) => <i key={day}/>)}</div>
              <span className="today-line"/>
              {showBaseline && <span className="baseline-bar" style={{ left: `${task.baselineStart * 1.18}%`, width: `${Math.max(task.baselineDuration * 1.18, 1.2)}%` }}/>} 
              {task.milestone ? <span className="milestone" style={{ left: `${task.start * 1.18}%` }}/> : <span className="gantt-bar" style={{ left: `${task.start * 1.18}%`, width: `${task.duration * 1.18}%` }}><i style={{ width: `${task.progress}%` }}/>{task.duration > 6 && <b>{task.progress}%</b>}</span>}
            </button>
          </div>)}
        </div>
      </div>
      <footer className="gantt-legend"><span><i className="legend-plan"/> Planejado</span><span><i className="legend-done"/> Realizado</span><span><i className="legend-base"/> Linha de base</span><span><i className="legend-critical"/> Caminho crítico</span><small>Hoje · 24 ago</small></footer>
    </section>

    {selected && <Modal title={selected.name} subtitle={`${selected.phase} · Atividade ${selected.code}`} onClose={() => setSelected(null)}>
      <div className="task-modal-body">
        <div className="form-grid"><label><span>Responsável</span><input value={selected.responsible} readOnly/></label><label><span>Dependência</span><input value={selected.dependency || "Sem dependência"} readOnly/></label></div>
        <label className="range-field"><span>Avanço físico <strong>{selected.progress}%</strong></span><input type="range" min="0" max="100" value={selected.progress} onChange={(event) => { const progress = Number(event.target.value); setSelected({ ...selected, progress }); updateTaskProgress(selected.id, progress); }}/><div><small>0%</small><small>50%</small><small>100%</small></div></label>
        <div className="modal-note"><Icon name="spark"/><p><strong>Impacto no planejamento</strong><br/>Alterações nesta atividade podem recalcular as sucessoras quando as dependências automáticas forem ativadas.</p></div>
        <div className="modal-actions"><button className="secondary-btn" onClick={() => setSelected(null)}>Cancelar</button><button className="primary-btn" onClick={() => { setSelected(null); setToast("Progresso da atividade atualizado."); }}>Salvar alteração</button></div>
      </div>
    </Modal>}
  </div>;
}
