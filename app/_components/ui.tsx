"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

let openModalCount = 0;
let bodyOverflowBeforeModal = "";
const subscribeToClient = () => () => undefined;

export function ProgressRing({
  value,
  size = 64,
}: {
  value: number;
  size?: number;
}) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="progress-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 60 60">
        <circle className="ring-track" cx="30" cy="30" r={radius} />
        <circle
          className="ring-value"
          cx="30"
          cy="30"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - value / 100)}
        />
      </svg>
      <strong>{value}%</strong>
    </div>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const kind =
    value === "No prazo" ||
    value === "Concluído" ||
    value === "Enviado" ||
    value === "Aprovado"
      ? "success"
      : value === "Atenção" || value === "Em revisão"
        ? "warning"
        : "neutral";
  return (
    <span className={`status-badge ${kind}`}>
      <i />
      {value}
    </span>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  dismissible = true,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  dismissible?: boolean;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (openModalCount === 0) {
      bodyOverflowBeforeModal = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalCount += 1;

    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeModal;
      }
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      const modals = document.querySelectorAll(".modal-backdrop");
      if (
        event.key === "Escape" &&
        modals[modals.length - 1] === backdrop.current
      )
        if (dismissible) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dismissible, onClose]);
  const content = (
    <div
      ref={backdrop}
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`modal glass ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {dismissible && <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>}
        </header>
        {children}
      </section>
    </div>
  );

  return mounted ? createPortal(content, document.body) : null;
}

export function EmptyPhoto({ children }: { children: ReactNode }) {
  return (
    <div className="empty-photo">
      <span>
        <Icon name="camera" />
      </span>
      {children}
    </div>
  );
}
