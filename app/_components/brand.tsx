/* eslint-disable @next/next/no-img-element -- marcas configuráveis vêm do storage */

export function BrandSymbols({
  organizationLogoUrl,
  organizationLogoBackground = "#FFFFFF",
  className = "",
}: {
  organizationLogoUrl?: string;
  organizationLogoBackground?: string;
  className?: string;
}) {
  return (
    <span
      className={`brand-symbols ${className}`.trim()}
      aria-label="Marca da empresa"
    >
      <span
        className="brand-symbol organization-brand"
        style={{ backgroundColor: organizationLogoBackground }}
      >
        <img
          src={organizationLogoUrl || "/brand/simbolo-everlenz-azul.svg"}
          alt="Logo da empresa"
        />
      </span>
    </span>
  );
}

/** Nome EVERLENZ: lettering vetorial da marca (nunca digitado com fonte). Troca de cor com o tema. */
export function EverlenzLettering({ className = "" }: { className?: string }) {
  return (
    <span className={`everlenz-lettering ${className}`.trim()} role="img" aria-label="Everlenz">
      <img className="on-light" src="/brand/lettering-everlenz-escuro.svg" alt="" />
      <img className="on-dark" src="/brand/lettering-everlenz.svg" alt="" />
    </span>
  );
}

/** Assinatura "by EVERLENZ" ao lado do nome do produto. */
export function ByEverlenz({ className = "" }: { className?: string }) {
  return (
    <span className={`by-everlenz ${className}`.trim()}>
      by <EverlenzLettering />
    </span>
  );
}
