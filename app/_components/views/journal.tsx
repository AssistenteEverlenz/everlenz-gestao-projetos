"use client";
/* eslint-disable @next/next/no-img-element -- o diário exibe evidências selecionadas pelo usuário */

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { EmptyPhoto, Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; addEntry: (entry: JournalEntry) => void };
const isoToday = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
async function fileToDataUrl(file: File) {
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .68));
    if (blob) file = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    // Alguns navegadores não decodificam HEIC localmente; o arquivo original segue para prévia/upload.
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function Journal({ tasks, entries, navigate, addEntry }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(isoToday());
  const dayEntries = useMemo(() => entries.filter((entry) => entry.date === selectedDate), [entries, selectedDate]);
  const summary = useMemo(() => ({ activities: new Set(dayEntries.map((entry) => entry.taskId)).size, progress: dayEntries.reduce((sum, entry) => sum + entry.progressAdded, 0), photos: dayEntries.reduce((sum, entry) => sum + entry.photos.length, 0), crew: Math.max(0, ...dayEntries.map((entry) => entry.crew)) }), [dayEntries]);

  function moveDay(direction: number) { const date = new Date(`${selectedDate}T12:00:00`); date.setDate(date.getDate() + direction); setSelectedDate(date.toISOString().slice(0, 10)); }

  if (!tasks.length) return <section className="empty-schedule glass"><span className="empty-workspace-icon"><Icon name="journal" /></span><span className="overline">DIÁRIO AGUARDANDO O CRONOGRAMA</span><h2>Crie uma atividade antes do primeiro registro</h2><p>Todo lançamento de campo precisa estar vinculado a um item do Gantt. Isso garante que fotos, descrições e medições apareçam no histórico correto e no Status Report.</p><button className="primary-btn" onClick={() => navigate("schedule")}><Icon name="gantt"/> Montar cronograma</button></section>;

  return <div className="view-stack journal-view">
    <section className="journal-toolbar glass"><div className="date-navigator"><button className="icon-btn" onClick={() => moveDay(-1)} aria-label="Dia anterior"><Icon name="chevron" className="flip"/></button><button className="date-button" onClick={() => setSelectedDate(isoToday())}><span>{selectedDate === isoToday() ? "HOJE" : "DIA SELECIONADO"}</span><strong>{dateLabel(selectedDate)}</strong></button><button className="icon-btn" onClick={() => moveDay(1)} aria-label="Próximo dia"><Icon name="chevron"/></button></div><div className="day-context"><span><Icon name="camera"/> {summary.photos} evidências</span><span><Icon name="trend"/> +{summary.progress}% medidos</span></div><button className="primary-btn" onClick={() => setOpen(true)}><Icon name="plus"/> Novo registro</button></section>

    <div className="journal-layout">
      <section className="journal-feed">
        <div className="day-divider"><span>{dayEntries.length ? `${dayEntries.length} REGISTRO${dayEntries.length > 1 ? "S" : ""}` : "SEM REGISTROS NESTE DIA"}</span><i/></div>
        {!dayEntries.length && <button className="empty-journal glass" onClick={() => setOpen(true)}><span><Icon name="camera"/></span><strong>Registrar atividade executada</strong><small>Adicione fotos, descrição, equipe e percentual medido.</small></button>}
        {dayEntries.map((entry) => { const task = tasks.find((item) => item.id === entry.taskId); return <article key={entry.id} className="journal-card glass">
          <div className={`journal-photo ${entry.photos.length > 1 ? "photo-grid" : ""}`}>{entry.photos.length ? entry.photos.slice(0, 4).map((photo, index) => <img key={index} src={photo} alt={`${entry.title} · evidência ${index + 1}`}/>) : <EmptyPhoto>Sem foto</EmptyPhoto>}<span><Icon name="camera"/> {entry.photos.length} foto{entry.photos.length === 1 ? "" : "s"}</span></div>
          <div className="journal-content"><div className="journal-card-head"><span className="task-chip">{task?.code} · {task?.phase}</span><button className="icon-btn tiny"><Icon name="more"/></button></div><h3>{entry.title}</h3><p>{entry.description}</p><div className="progress-measure"><span><small>ANTES</small><strong>{entry.progressBefore}%</strong></span><Icon name="arrow"/><span className="daily-measure"><small>MEDIDO NO DIA</small><strong>+{entry.progressAdded}%</strong></span><Icon name="arrow"/><span><small>APÓS REGISTRO</small><strong>{entry.progressAfter}%</strong></span></div><div className="entry-progress"><span>Avanço acumulado</span><div><i style={{ width: `${entry.progressAfter}%` }}/></div><strong>{entry.progressAfter}%</strong></div><footer><span className="avatar small">{entry.author.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><span><strong>{entry.author}</strong><small>{entry.time}</small></span><em/><span><Icon name="users"/>{entry.crew} pessoas</span><span><Icon name="weather"/>{entry.weather}</span></footer></div>
        </article>; })}
      </section>

      <aside className="journal-aside"><section className="panel glass"><span className="overline">RESUMO DO DIA</span><h3>Execução em números</h3><div className="daily-stats"><div><strong>{summary.activities}</strong><span>atividades atualizadas</span></div><div><strong>+{summary.progress}%</strong><span>avanço registrado</span></div><div><strong>{summary.photos}</strong><span>fotos anexadas</span></div><div><strong>{summary.crew}</strong><span>pessoas em campo</span></div></div></section><section className="panel glass"><span className="overline">RASTREABILIDADE</span><div className="check-list"><span className={dayEntries.length ? "" : "pending"}><Icon name={dayEntries.length ? "check" : "clock"}/> Atividades vinculadas</span><span className={summary.photos ? "" : "pending"}><Icon name={summary.photos ? "check" : "clock"}/> Evidências fotográficas</span><span className={summary.progress ? "" : "pending"}><Icon name={summary.progress ? "check" : "clock"}/> Avanço medido</span><span className="pending"><Icon name="clock"/> Aprovação do responsável</span></div></section></aside>
    </div>

    {open && <JournalForm tasks={tasks} date={selectedDate} onClose={() => setOpen(false)} onSave={(entry) => { addEntry(entry); setOpen(false); }} />}
  </div>;
}

function JournalForm({ tasks, date, onClose, onSave }: { tasks: Task[]; date: string; onClose: () => void; onSave: (entry: JournalEntry) => void }) {
  const activeTasks = tasks.filter((task) => task.progress < 100);
  if (!activeTasks.length) activeTasks.push(...tasks);
  const [taskId, setTaskId] = useState(activeTasks[0]?.id ?? tasks[0].id);
  const task = tasks.find((item) => item.id === taskId) ?? tasks[0];
  const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [progress, setProgress] = useState(Math.min(5, 100 - task.progress));
  const [crew, setCrew] = useState(0); const [weather, setWeather] = useState("Não informado"); const [photos, setPhotos] = useState<string[]>([]); const [loadingPhotos, setLoadingPhotos] = useState(false);
  const maximum = Math.max(0, 100 - task.progress);
  async function selectPhotos(files: FileList | null) { if (!files) return; setLoadingPhotos(true); const selected = Array.from(files).slice(0, Math.max(0, 8 - photos.length)); const urls = await Promise.all(selected.map(fileToDataUrl)); setPhotos((current) => [...current, ...urls]); setLoadingPhotos(false); }
  function changeTask(value: string) { setTaskId(value); const next = tasks.find((item) => item.id === value)!; setProgress(Math.min(5, 100 - next.progress)); }
  function submit(event: React.FormEvent) { event.preventDefault(); const after = Math.min(100, task.progress + progress); onSave({ id: crypto.randomUUID(), date, time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }), taskId, title: title || task.name, description, progressBefore: task.progress, progressAdded: progress, progressAfter: after, author: "Gustavo Adriano", weather, crew, photos }); }
  return <Modal title="Novo registro de campo" subtitle="As fotos e a medição ficarão vinculadas à atividade selecionada." onClose={onClose} wide><form className="journal-form field-first" onSubmit={submit}>
    <label className="full activity-selector"><span>1 · Atividade do cronograma</span><select value={taskId} onChange={(event) => changeTask(event.target.value)}>{activeTasks.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.progress}%)</option>)}</select><small>{task.responsible || "Sem responsável"} · {task.phase}</small></label>
    <section className="measurement-card full"><div><span>2 · Medição do avanço</span><p>Informe apenas o percentual executado neste dia.</p></div><div className="measurement-equation"><span><small>ATUAL</small><strong>{task.progress}%</strong></span><b>+</b><label><small>HOJE</small><input aria-label="Percentual executado hoje" type="number" min="0" max={maximum} value={progress} onChange={(event) => setProgress(Math.min(maximum, Number(event.target.value)))}/></label><b>=</b><span className="measure-result"><small>NOVO TOTAL</small><strong>{task.progress + progress}%</strong></span></div><input className="measurement-range" type="range" min="0" max={maximum} value={progress} onChange={(event) => setProgress(Number(event.target.value))}/><small>Disponível para medir: {maximum}%</small></section>
    <label className="full"><span>3 · O que foi realizado</span><input required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Título objetivo do serviço executado"/></label><label className="full"><span>Descrição técnica</span><textarea required rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descreva local, quantidades, condições, intercorrências e próximos passos..."/></label>
    <label><span>Efetivo nesta frente</span><input type="number" min="0" required value={crew} onChange={(event) => setCrew(Number(event.target.value))}/></label><label><span>Condição do tempo</span><select value={weather} onChange={(event) => setWeather(event.target.value)}><option>Não informado</option><option>Ensolarado</option><option>Parcialmente nublado</option><option>Nublado</option><option>Chuva leve</option><option>Chuva intensa</option></select></label>
    <label className="photo-drop full"><input type="file" accept="image/*" capture="environment" multiple required={!photos.length} onChange={(event) => selectPhotos(event.target.files)}/><span className="photo-drop-icon"><Icon name="camera"/></span><strong>4 · Fotografar ou selecionar evidências</strong><small>Até 8 fotos deste serviço. No celular, a câmera será aberta diretamente.</small><em>{loadingPhotos ? "Processando fotos..." : photos.length ? `${photos.length} foto(s) selecionada(s)` : "Adicionar fotos"}</em></label>
    {photos.length > 0 && <div className="upload-grid full">{photos.map((photo, index) => <div key={index}><img src={photo} alt={`Prévia ${index + 1}`}/><button type="button" aria-label={`Remover foto ${index + 1}`} onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Icon name="close"/></button><span>{index + 1}</span></div>)}</div>}
    <div className="save-summary full"><Icon name="check"/><span><strong>Ao salvar</strong><small>A atividade passará de {task.progress}% para {task.progress + progress}% e este registro entrará automaticamente no Status Report de {dateLabel(date)}.</small></span></div>
    <div className="modal-actions full"><button type="button" className="secondary-btn" onClick={onClose}>Cancelar</button><button className="primary-btn" disabled={loadingPhotos}><Icon name="check"/> Salvar diário e atualizar Gantt</button></div>
  </form></Modal>;
}
