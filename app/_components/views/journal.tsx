"use client";
/* eslint-disable @next/next/no-img-element -- o diário precisa exibir URLs blob de uploads locais */

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { EmptyPhoto, Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; addEntry: (entry: JournalEntry) => void };

export function Journal({ tasks, entries, addEntry }: Props) {
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState(tasks.find((task) => task.progress < 100)?.id || tasks[0].id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState(5);
  const [crew, setCrew] = useState(6);
  const [image, setImage] = useState<string | null>(null);
  const dates = useMemo(() => ["24 AGO", "23 AGO"], []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const task = tasks.find((item) => item.id === taskId)!;
    addEntry({ id: crypto.randomUUID(), date: "24 AGO", time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), taskId, title: title || task.name, description, progressAdded: progress, author: "Gustavo Adriano", weather: "Ensolarado · 26 °C", crew, image: image || "" });
    setOpen(false); setTitle(""); setDescription(""); setImage(null);
  }

  return <div className="view-stack journal-view">
    <section className="journal-toolbar glass"><div className="date-navigator"><button className="icon-btn"><Icon name="chevron" className="flip"/></button><div><span>SEGUNDA-FEIRA</span><strong>24 de agosto de 2026</strong></div><button className="icon-btn"><Icon name="chevron"/></button></div><div className="day-context"><span><Icon name="weather"/> Ensolarado · 26 °C</span><span><Icon name="users"/> 18 pessoas em campo</span></div><button className="primary-btn" onClick={() => setOpen(true)}><Icon name="plus"/> Novo registro</button></section>

    <div className="journal-layout">
      <section className="journal-feed">
        {dates.map((date) => <div key={date} className="journal-day"><div className="day-divider"><span>{date === "24 AGO" ? "HOJE" : "ONTEM"}</span><i/></div>
          {entries.filter((entry) => entry.date === date).map((entry) => { const task = tasks.find((item) => item.id === entry.taskId); return <article key={entry.id} className="journal-card glass">
            <div className="journal-photo">{entry.image ? <img src={entry.image} alt={entry.title}/> : <EmptyPhoto>Sem foto</EmptyPhoto>}<span><Icon name="camera"/> 1 foto</span></div>
            <div className="journal-content"><div className="journal-card-head"><span className="task-chip">{task?.code} · {task?.phase}</span><button className="icon-btn tiny"><Icon name="more"/></button></div><h3>{entry.title}</h3><p>{entry.description}</p><div className="entry-progress"><span>Avanço informado</span><div><i style={{ width: `${entry.progressAdded * 4}%` }}/></div><strong>+{entry.progressAdded}%</strong></div><footer><span className="avatar small">{entry.author.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><span><strong>{entry.author}</strong><small>{entry.time}</small></span><em/><span><Icon name="users"/>{entry.crew} pessoas</span><span><Icon name="weather"/>{entry.weather}</span></footer></div>
          </article>; })}
        </div>)}
      </section>

      <aside className="journal-aside">
        <section className="panel glass"><span className="overline">RESUMO DO DIA</span><h3>Execução em números</h3><div className="daily-stats"><div><strong>2</strong><span>atividades atualizadas</span></div><div><strong>+17%</strong><span>avanço registrado</span></div><div><strong>5</strong><span>fotos anexadas</span></div><div><strong>18</strong><span>pessoas em campo</span></div></div></section>
        <section className="panel glass"><span className="overline">CHECKLIST DO RDO</span><div className="check-list"><span><Icon name="check"/> Clima informado</span><span><Icon name="check"/> Efetivo registrado</span><span><Icon name="check"/> Atividades vinculadas</span><span className="pending"><Icon name="clock"/> Aguardando aprovação</span></div></section>
      </aside>
    </div>

    {open && <Modal title="Novo registro de campo" subtitle="O avanço informado atualizará a atividade no cronograma." onClose={() => setOpen(false)} wide>
      <form className="journal-form" onSubmit={submit}>
        <label className="full"><span>Atividade do cronograma</span><select value={taskId} onChange={(event) => setTaskId(Number(event.target.value))}>{tasks.filter((task) => task.progress < 100).map((task) => <option key={task.id} value={task.id}>{task.code} · {task.name}</option>)}</select></label>
        <label><span>Título do registro</span><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Armação positiva da laje"/></label>
        <label><span>Avanço realizado (%)</span><input type="number" min="0" max="100" required value={progress} onChange={(event) => setProgress(Number(event.target.value))}/></label>
        <label className="full"><span>Descrição do que foi realizado</span><textarea required rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva serviços, locais, quantidades e observações..."/></label>
        <label><span>Efetivo em campo</span><input type="number" min="0" value={crew} onChange={(event) => setCrew(Number(event.target.value))}/></label>
        <label><span>Foto da execução</span><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) setImage(URL.createObjectURL(file)); }}/></label>
        {image && <div className="upload-preview full"><img src={image} alt="Prévia do anexo"/><span><Icon name="check"/> Foto pronta para anexar</span></div>}
        <div className="modal-actions full"><button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-btn"><Icon name="check"/> Salvar registro</button></div>
      </form>
    </Modal>}
  </div>;
}
