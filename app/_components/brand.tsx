/* eslint-disable @next/next/no-img-element -- marcas configuráveis vêm do storage */

export function BrandSymbols({
  organizationLogoUrl,
  className = "",
}: {
  organizationLogoUrl?: string;
  className?: string;
}) {
  return (
    <span
      className={`brand-symbols ${className}`.trim()}
      aria-label="Everlenz em parceria com Natreb"
    >
      <span className="brand-symbol organization-brand">
        <img src={organizationLogoUrl || "/everlenz-mark.png"} alt="Everlenz" />
      </span>
      <span className="brand-symbol partner-brand">
        <img src="/natreb-mark.png" alt="Natreb" />
      </span>
    </span>
  );
}
