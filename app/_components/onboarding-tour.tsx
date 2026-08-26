"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ViewId } from "./types";

type Step = { title: string; text: string; target?: string; view?: ViewId };
const steps: Step[] = [
  { title: "Bem-vindo ao Em Dia", text: "Vamos conhecer a plataforma de acompanhamento da sua obra. Este guia leva menos de dois minutos." },
  { title: "Troque de projeto", text: "Aqui você seleciona a obra atual ou cria um novo projeto para começar do zero.", target: "projeto-atual" },
  { title: "Visão geral", text: "Veja o avanço físico, prazos, atividades em curso e pontos que precisam de atenção.", target: "nav-overview", view: "overview" },
  { title: "Cronograma e Gantt", text: "Estruture a EAP, dependências, responsáveis, datas e acompanhe o avanço planejado e realizado.", target: "nav-schedule", view: "schedule" },
  { title: "Diário de obra", text: "No celular, registre o serviço executado, as fotos e o percentual medido em cada atividade.", target: "nav-journal", view: "journal" },
  { title: "Status reports", text: "Consolide automaticamente os registros do dia, evidências e o Gantt completo para compartilhar.", target: "nav-reports", view: "reports" },
  { title: "Equipe e acessos", text: "Administradores e gestores adicionam pessoas, editam perfis e controlam senhas e acessos.", target: "nav-team", view: "team" },
  { title: "Tudo pronto", text: "Você pode rever esta apresentação a qualquer momento em Configurações. Vamos colocar a obra em dia!" },
];

export function OnboardingTour({ userId, enabled, navigate }: { userId: string; enabled: boolean; navigate: (view: ViewId) => void }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const key = `emdia:onboarding:v1:${userId}`;
  const step = steps[index];
  const stop = useCallback((complete = false) => {
    setActive(false); setRect(null);
    if (complete) localStorage.setItem(key, "done");
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    const start = () => { setIndex(0); setActive(true); };
    window.addEventListener("emdia:start-tour", start);
    if (!localStorage.getItem(key)) {
      const timer = window.setTimeout(start, 700);
      return () => { window.clearTimeout(timer); window.removeEventListener("emdia:start-tour", start); };
    }
    return () => window.removeEventListener("emdia:start-tour", start);
  }, [enabled, key]);

  useEffect(() => {
    if (!active || !step) return;
    if (step.view) navigate(step.view);
    const timer = window.setTimeout(() => {
      if (!step.target) return setRect(null);
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`));
      const target = candidates.find((element) => element.offsetParent !== null && element.getBoundingClientRect().width > 0);
      if (!target) return setRect(null);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setRect(target.getBoundingClientRect());
    }, 180);
    return () => window.clearTimeout(timer);
  }, [active, index, navigate, step]);

  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && stop(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [active, stop]);

  if (!active || !step || typeof document === "undefined") return null;
  const isLast = index === steps.length - 1;
  const cardStyle: React.CSSProperties = rect
    ? { top: Math.min(window.innerHeight - 250, rect.bottom + 14), left: Math.max(14, Math.min(window.innerWidth - 354, rect.left + rect.width / 2 - 170)) }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return createPortal(<div className="emdia-tour" role="dialog" aria-modal="true">
    <div className="tour-dim"/>
    {rect && <div className="tour-spotlight" style={{ top: rect.top - 7, left: rect.left - 7, width: rect.width + 14, height: rect.height + 14 }}/>} 
    <section className="tour-card" style={cardStyle}>
      <button className="tour-close" aria-label="Fechar apresentação" onClick={() => stop(false)}>×</button>
      <span>GUIA RÁPIDO · {index + 1} DE {steps.length}</span>
      <h2>{step.title}</h2><p>{step.text}</p>
      <div className="tour-progress">{steps.map((_, item) => <i className={item <= index ? "active" : ""} key={item}/>)}</div>
      <footer><button className="tour-skip" onClick={() => stop(true)}>Pular apresentação</button><div>{index > 0 && <button className="secondary-btn" onClick={() => setIndex((value) => value - 1)}>Voltar</button>}<button className="primary-btn" onClick={() => isLast ? stop(true) : setIndex((value) => value + 1)}>{isLast ? "Começar" : "Próximo"}</button></div></footer>
    </section>
  </div>, document.body);
}
