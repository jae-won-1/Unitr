import { LEGAL } from "@/lib/legal";

// The shared frame for /privacy and /terms: a title, the date, and readable
// prose. Server-rendered and public — no session needed — because the stores
// and anyone deciding whether to sign up must be able to read them.

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="max-w-2xl mx-auto px-4 pt-8 pb-16 text-sm leading-relaxed text-text-primary">
      <a href="/" className="text-xs text-accent-ink font-semibold">← Uniter</a>
      <h1 className="text-2xl font-extrabold mt-4">{title}</h1>
      <p className="text-xs text-text-secondary mt-1">Last updated {LEGAL.updated}</p>
      <div className="mt-6 flex flex-col gap-4">{children}</div>
    </article>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold mt-4">{children}</h2>;
}

export function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 flex flex-col gap-1.5">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}
