import type { ReactNode } from "react";
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="form-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Stat({
  title,
  value,
  icon,
  note,
}: {
  title: string;
  value?: number | string | null;
  icon: ReactNode;
  note: string;
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className={typeof value === "string" ? "stat-text" : ""}>
        {value == null ? "—" : value.toLocaleString("uz-UZ")}
      </strong>
      <p>{note}</p>
    </section>
  );
}

/** Native table semantics; all row actions and server state remain caller-owned. */
export function DataTable({caption,headings,children}:{caption:string;headings:string[];children:ReactNode}) {
 return <div className="table-scroll" tabIndex={0} aria-label={caption}><table><caption className="saas-sr-only">{caption}</caption><thead><tr>{headings.map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
export function StatusBadge({children}:{children:ReactNode}) {return <span className="status-pill">{children}</span>}
export function EmptyState({title,children}:{title:string;children?:ReactNode}) {return <div className="empty-state"><h3>{title}</h3>{children}</div>}
export function ErrorState({message,onRetry}:{message:string;onRetry:()=>void}) {return <div className="notice" role="alert">{message}<button type="button" className="text-button" onClick={onRetry}>Qayta urinish</button></div>}
export function LoadingSkeleton({label='Ma’lumotlar yuklanmoqda…'}:{label?:string}) {return <div className="loading-panel" role="status"><span className="loading-skeleton" aria-hidden="true"/>{label}</div>}
export function ChartContainer({label,children}:{label:string;children:ReactNode}) {return <div className="chart-container" role="img" aria-label={label}>{children}</div>}
