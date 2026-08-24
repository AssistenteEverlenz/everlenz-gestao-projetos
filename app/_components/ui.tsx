"use client";

import type { ReactNode } from "react";
import { Icon } from "./icons";

export function ProgressRing({ value, size = 64 }: { value: number; size?: number }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  return <div className="progress-ring" style={{ width: size, height: size }}><svg viewBox="0 0 60 60"><circle className="ring-track" cx="30" cy="30" r={radius}/><circle className="ring-value" cx="30" cy="30" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)}/></svg><strong>{value}%</strong></div>;
}

export function StatusBadge({ value }: { value: string }) {
  const kind = value === "No prazo" || value === "Concluído" || value === "Enviado" ? "success" : value === "Atenção" || value === "Em revisão" ? "warning" : "neutral";
  return <span className={`status-badge ${kind}`}><i />{value}</span>;
}

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal glass ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button></header>{children}</section></div>;
}

export function EmptyPhoto({ children }: { children: ReactNode }) {
  return <div className="empty-photo"><span><Icon name="camera" /></span>{children}</div>;
}
