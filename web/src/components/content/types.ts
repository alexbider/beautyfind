// Typed content for the About, Standards and Legal pages.
// Strings may use `[label](/href)` links; numbers and latin words are isolated LTR automatically (see Rich.tsx).

export interface Note {
  title: string;
  body: string;
}

export interface Rule {
  ok: boolean;
  tag: string;
  body: string;
}

export interface NamedItem {
  name: string;
  body: string;
}

export interface Requirement extends NamedItem {
  tag: string;
}

export interface TeamMember {
  /** null until the real person is confirmed: rendered as a placeholder, never invented. */
  name: string | null;
  role: string;
  bio: string;
  img?: string;
}

export interface Plan {
  tag: string;
  name: string;
  price: string;
  unit: string;
  sponsored?: boolean;
  items: string[];
}

export interface Table {
  head: [string, string, string];
  rows: Array<{ label: string; what: string; last: string; state?: 'ok' | 'pending' }>;
  caption?: string;
  /** 'status' renders the middle column as a ✓ / ⋯ status chip (accessibility statement). */
  kind?: 'plain' | 'status';
  minWidth?: number;
}

export interface Faq {
  q: string;
  a: string;
}

export type Block =
  | { kind: 'paras'; paras: string[] }
  | { kind: 'steps'; steps: NamedItem[] }
  | { kind: 'rules'; rules: Rule[] }
  | { kind: 'reqs'; reqs: Requirement[] }
  | { kind: 'items'; items: NamedItem[] }
  | { kind: 'note'; note: Note }
  | { kind: 'team'; team: TeamMember[] }
  | { kind: 'plans'; plans: Plan[] }
  | { kind: 'sponsoredLabel' }
  | { kind: 'table'; table: Table }
  | { kind: 'faq'; faqs: Faq[] }
  | { kind: 'cookiePrefs' }
  | { kind: 'fine'; text: string };

export interface Section {
  /** Stable anchor, e.g. "cookies" → /privacy#cookies. */
  id: string;
  head: string;
  blocks: Block[];
}

export interface Cta {
  title: string;
  body: string;
  primary: { label: string; href: string; ltr?: boolean; arrow?: boolean };
  secondary: { label: string; href: string };
}

export interface Aside {
  title: string;
  body: string;
  label: string;
  href: string;
  ltr?: boolean;
  arrow?: boolean;
}

export interface Stat {
  label: string;
  value: string;
}

export interface ContentView<K extends string = string> {
  key: K;
  name: string;
  href: string;
  kicker: string;
  title: string;
  dek: string;
  metaTitle: string;
  description: string;
  stats: Stat[];
  aside: Aside;
  cta: Cta;
  sections: Section[];
}
