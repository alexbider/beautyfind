import type { Metadata } from 'next';
import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { atLeast } from '@/components/ops/roles';
import { Bars, Card, Chip, Columns, Empty, Kpis, PageHead, Pills, Table, dateTimeIL, dayMonthIL, int, pct, relIL, ui } from '@/components/ops/ui';
import { db } from '@/lib/server/db';
import { AUDIENCE_LABEL, replyOnly, type Audience } from '@/lib/server/emailRecipients';
import { emailBy, emailDaily, emailState, emailTotals, rate, type RateRow } from '@/lib/server/emailTracking';
import { platformSettings } from '@/lib/server/platformSettings';
import { AUDIENCES, RANGES, STATE_FILTERS, businessNames, rangeOf, templateName } from './data';
import { ReplySettingsForm, ReplyStatusButton, TrackingSetup } from './EmailForms';

export const metadata: Metadata = { title: 'מעקב מיילים · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const TABS = ['overview', 'sent', 'replies', 'setup'] as const;
type Tab = (typeof TABS)[number];

/** Rates over delivered emails; before delivery reports exist, over sent. */
const base = (r: RateRow) => (r.delivered > 0 ? r.delivered : r.sent);
const pctOf = (part: number, r: RateRow) => {
  const v = rate(part, base(r));
  return v == null ? '—' : pct(v);
};

function qs(cur: Record<string, string>, over: Record<string, string>) {
  const p = new URLSearchParams({ ...cur, ...over });
  for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
  const s = p.toString();
  return `/ops/emails${s ? `?${s}` : ''}`;
}

export default async function EmailsAdminPage({ searchParams }: { searchParams: SP }) {
  const user = await requireArea('emails', 'view', '/ops/emails');
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(one(sp.tab)) ? (one(sp.tab) as Tab) : 'overview';
  const days = rangeOf(one(sp.days));
  const audience = AUDIENCES.some(a => a.key === one(sp.audience)) ? one(sp.audience) : '';
  const level = await areaLevel(user, 'emails');
  const cur = { tab: tab === 'overview' ? '' : tab, days: days === 30 ? '' : String(days), audience };
  const [newReplies, settings] = await Promise.all([db.emailReply.count({ where: { status: 'new' } }), platformSettings()]);

  const head = (
    <>
      <PageHead
        eyebrow="צמיחה"
        title="מעקב מיילים"
        lead="כל מייל שהמערכת שולחת לעסקים וללקוחות: נמסר, נפתח, הקליקו, ענו או חזר. הנתונים מגיעים מ־Resend בזמן אמת. שיעורי הפתיחה הם הערכה, כי חלק מתוכנות הדואר פותחות את המייל אוטומטית; הקלקות ותשובות הן הסימן האמין יותר."
      />
      <Pills
        current={tab}
        items={[
          { key: 'overview', name: 'סקירה', href: qs(cur, { tab: '' }) },
          { key: 'sent', name: 'מיילים שנשלחו', href: qs(cur, { tab: 'sent' }) },
          { key: 'replies', name: 'תשובות', count: newReplies || undefined, href: qs({ ...cur, audience: '' }, { tab: 'replies' }) },
          { key: 'setup', name: 'הגדרה', href: '/ops/emails?tab=setup' },
        ]}
      />
    </>
  );

  const rangePills = (
    <div className={ui.toolbar}>
      <Pills current={String(days)} items={RANGES.map(d => ({ key: String(d), name: `${d} ימים`, href: qs(cur, { days: d === 30 ? '' : String(d) }) }))} />
      <Pills current={audience || 'all'} items={AUDIENCES.map(a => ({ key: a.key || 'all', name: a.name, href: qs(cur, { audience: a.key }) }))} />
    </div>
  );

  // ---------- setup ----------
  if (tab === 'setup') {
    const [events7, lastEvent] = await Promise.all([
      db.emailEvent.groupBy({ by: ['type'], where: { at: { gte: new Date(Date.now() - 7 * 86_400_000) } }, _count: true }),
      db.emailEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true, type: true } }),
    ]);
    const seen = new Map(events7.map(e => [e.type, e._count]));
    return (
      <AdminShell user={user}>
        {head}
        <div className={ui.grid}>
          <Card title="הפעלת המעקב ב־Resend" sub="פתיחות, הקלקות, תשובות ו־Webhook">
            <TrackingSetup canRun={atLeast(level, 'full')} />
          </Card>
          <Card title="תשובות" sub={settings.email.replyDomain ? `כל מייל יוצא עם כתובת תשובה ייחודית ב־${settings.email.replyDomain}` : 'מעקב תשובות כבוי'}>
            <ReplySettingsForm forwardTo={settings.email.forwardTo} replyDomain={settings.email.replyDomain} canEdit={atLeast(level, 'full')} />
          </Card>
          <Card title="אירועים שהתקבלו, 7 ימים" sub={lastEvent ? `אחרון: ${relIL(lastEvent.createdAt)}` : 'עוד לא התקבל אירוע'}>
            <ul className={ui.list}>
              {['email.sent', 'email.delivered', 'email.opened', 'email.clicked', 'email.received', 'email.bounced', 'email.complained', 'email.failed'].map(t => (
                <li key={t} className={ui.listItem}><span className="ltr">{t}</span> <b>{int(seen.get(t) ?? 0)}</b></li>
              ))}
            </ul>
            <p className={ui.note}>אם פתיחות או הקלקות נשארות 0 אחרי שליחות, המעקב עוד לא מאומת בדומיין או שה־Webhook לא מנוי לאירועים האלה. הריצו את ההגדרה שוב.</p>
          </Card>
        </div>
      </AdminShell>
    );
  }

  // ---------- replies ----------
  if (tab === 'replies') {
    const filter = one(sp.filter) === 'handled' ? 'handled' : one(sp.filter) === 'all' ? 'all' : 'new';
    const replies = await db.emailReply.findMany({
      where: filter === 'all' ? {} : { status: filter },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      include: { send: { select: { id: true, template: true, createdAt: true } } },
    });
    const names = await businessNames(replies.map(r => r.businessId));
    return (
      <AdminShell user={user}>
        {head}
        <div className={ui.stack}>
          <Pills
            current={filter}
            items={[
              { key: 'new', name: 'לטיפול', count: newReplies || undefined, href: '/ops/emails?tab=replies' },
              { key: 'handled', name: 'טופלו', href: '/ops/emails?tab=replies&filter=handled' },
              { key: 'all', name: 'הכול', href: '/ops/emails?tab=replies&filter=all' },
            ]}
          />
          {replies.length ? (
            <Card flush>
              <Table head={['התקבל', 'מאת', 'עסק', 'בתשובה ל', 'תוכן', 'הועבר', '']}>
                {replies.map(r => (
                  <tr key={r.id}>
                    <td className="ltr">{dateTimeIL(r.receivedAt)}</td>
                    <td>{r.fromName ?? ''}<div className={`${ui.note} ltr`}>{r.fromEmail}</div></td>
                    <td>{r.businessId ? <Link href={`/ops/businesses/${r.businessId}`} className={ui.rowLink}>{names.get(r.businessId) ?? 'עסק'}</Link> : '—'}</td>
                    <td>{r.send ? <Link href={`/ops/emails/${r.send.id}`} className={ui.rowLink}>{templateName(r.send.template)}</Link> : <Chip tone="warn">לא שויך</Chip>}</td>
                    <td style={{ maxWidth: 360 }}>
                      <Link href={`/ops/emails/replies/${r.id}`} className={ui.rowLink}>{r.subject ?? 'ללא נושא'}</Link>
                      <div className={ui.note}>{replyOnly(r.text ?? '').slice(0, 160)}</div>
                    </td>
                    <td>{r.forwardedAt ? <Chip tone="ok">הועבר</Chip> : r.forwardError ? <Chip tone="bad">נכשל</Chip> : <Chip>לא</Chip>}</td>
                    <td><ReplyStatusButton id={r.id} status={r.status} canEdit={atLeast(level, 'edit')} /></td>
                  </tr>
                ))}
              </Table>
            </Card>
          ) : (
            <Card>
              <Empty title={filter === 'new' ? 'אין תשובות שמחכות לטיפול' : 'אין תשובות בתצוגה הזו'} text={settings.email.replyDomain ? `תשובות למיילים של המערכת מגיעות לכאן ומועברות גם ל־${settings.email.forwardTo}.` : 'מעקב התשובות עוד לא פעיל. הפעילו אותו בלשונית ההגדרה.'} />
            </Card>
          )}
        </div>
      </AdminShell>
    );
  }

  // ---------- sent list ----------
  if (tab === 'sent') {
    const state = one(sp.state) in STATE_FILTERS ? one(sp.state) : 'all';
    const template = one(sp.template);
    const business = /^[0-9a-f-]{36}$/i.test(one(sp.business)) ? one(sp.business) : '';
    const where: Prisma.MessageSendWhereInput = {
      provider: 'resend', test: false, createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
      ...(audience ? { audience } : {}), ...(template ? { template } : {}), ...(business ? { businessId: business } : {}),
      ...STATE_FILTERS[state].where,
    };
    const [rows, total] = await Promise.all([db.messageSend.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }), db.messageSend.count({ where })]);
    const names = await businessNames(rows.map(r => r.businessId));
    const curSent = { ...cur, state: state === 'all' ? '' : state, template, business };
    return (
      <AdminShell user={user}>
        {head}
        <div className={ui.stack}>
          {rangePills}
          <Pills current={state} items={Object.entries(STATE_FILTERS).map(([k, f]) => ({ key: k, name: f.name, href: qs(curSent, { state: k === 'all' ? '' : k }) }))} />
          {(template || business) && (
            <p className={ui.note}>
              מסונן: {template ? templateName(template) : ''}{template && business ? ' · ' : ''}{business ? names.get(business) ?? 'עסק' : ''} · <Link href={qs({ ...curSent, template: '', business: '' }, {})} className={ui.rowLink}>ניקוי</Link>
            </p>
          )}
          {rows.length ? (
            <Card flush sub={total > rows.length ? `מוצגים ${int(rows.length)} מתוך ${int(total)}` : `${int(total)} מיילים`}>
              <Table head={['נשלח', 'תבנית', 'אל', 'מצב', 'פתיחות', 'הקלקות', 'תשובות']}>
                {rows.map(m => {
                  const st = emailState(m);
                  return (
                    <tr key={m.id}>
                      <td className="ltr"><Link href={`/ops/emails/${m.id}`} className={ui.rowLink}>{dateTimeIL(m.createdAt)}</Link></td>
                      <td><Link href={qs(curSent, { template: m.template })} className={ui.rowLink}>{templateName(m.template)}</Link></td>
                      <td>
                        {m.businessId ? <Link href={qs(curSent, { business: m.businessId })} className={ui.rowLink}>{names.get(m.businessId) ?? 'עסק'}</Link> : AUDIENCE_LABEL[(m.audience ?? 'other') as Audience]}
                        <div className={`${ui.note} ltr`}>{m.toMasked}</div>
                      </td>
                      <td><Chip tone={st.tone}>{st.label}</Chip></td>
                      <td>{m.openCount ? <>{int(m.openCount)}<div className={ui.note}>{relIL(m.lastOpenedAt)}</div></> : '—'}</td>
                      <td>{m.clickCount ? <>{int(m.clickCount)}<div className={`${ui.note} ltr`}>{m.lastClickUrl?.replace(/^https?:\/\//, '').slice(0, 40)}</div></> : '—'}</td>
                      <td>{m.replyCount ? int(m.replyCount) : '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            </Card>
          ) : (
            <Card><Empty title="אין מיילים בתצוגה הזו" text="שנו את הטווח או את הסינון." /></Card>
          )}
        </div>
      </AdminShell>
    );
  }

  // ---------- overview ----------
  const filt = audience ? { audience } : {};
  const [t, byTemplate, byAudience, byBusiness, daily, latestReplies] = await Promise.all([
    emailTotals(days, filt),
    emailBy('template', days, filt, 30),
    emailBy('audience', days, {}, 10),
    emailBy('business', days, filt, 15),
    emailDaily(days),
    db.emailReply.findMany({ orderBy: { receivedAt: 'desc' }, take: 5, select: { id: true, fromName: true, fromEmail: true, subject: true, receivedAt: true, status: true } }),
  ]);
  const names = await businessNames(byBusiness.map(b => b.key));
  const rateCells = (r: RateRow) => (
    <>
      <td>{int(r.sent)}</td>
      <td>{pctOf(r.delivered, { ...r, delivered: r.sent })}</td>
      <td>{pctOf(r.opened, r)}</td>
      <td>{pctOf(r.clicked, r)}</td>
      <td>{pctOf(r.replied, r)}</td>
      <td>{r.bounced + r.failed ? <Chip tone="bad">{int(r.bounced + r.failed)}</Chip> : '0'}</td>
    </>
  );
  const rateHead = ['נשלחו', 'נמסרו', 'נפתחו', 'הקליקו', 'ענו', 'חזרו/נכשלו'];

  return (
    <AdminShell user={user}>
      {head}
      <div className={ui.stack}>
        {rangePills}
        <Kpis
          items={[
            { label: 'נשלחו', value: int(t.sent), note: `${days} ימים אחרונים` },
            { label: 'שיעור מסירה', value: pctOf(t.delivered, { ...t, delivered: t.sent }), note: `${int(t.delivered)} נמסרו` },
            { label: 'שיעור פתיחה', value: pctOf(t.opened, t), note: `${int(t.opened)} נפתחו (הערכה)` },
            { label: 'שיעור הקלקה', value: pctOf(t.clicked, t), note: `${int(t.clicked)} הקליקו` },
            { label: 'שיעור תשובה', value: pctOf(t.replied, t), note: settings.email.replyDomain ? `${int(t.replied)} ענו` : 'מעקב תשובות כבוי' },
            { label: 'חזרו או נכשלו', value: int(t.bounced + t.failed), tone: t.bounced + t.failed ? 'bad' : undefined, note: t.sent ? pct(((t.bounced + t.failed) / t.sent) * 100) : undefined },
          ]}
        />
        {daily.length > 1 && (
          <Card title="שליחות לפי יום" sub="גובה העמודה: נשלחו. במעבר עכבר: נפתחו וענו">
            <Columns items={daily.map((d, i) => ({ label: dayMonthIL(d.day), value: d.sent, now: i === daily.length - 1, title: `${int(d.sent)} נשלחו · ${int(d.opened)} נפתחו · ${int(d.replied)} ענו` }))} />
          </Card>
        )}
        <div className={ui.grid}>
          <Card title="לפי סוג נמען" flush>
            <Table head={['נמען', ...rateHead]}>
              {byAudience.map(r => (
                <tr key={r.key}><td><Link href={qs(cur, { audience: r.key })} className={ui.rowLink}>{AUDIENCE_LABEL[(r.key || 'other') as Audience] ?? r.key}</Link></td>{rateCells(r)}</tr>
              ))}
            </Table>
          </Card>
          <Card title="תשובות אחרונות" aside={<Link href="/ops/emails?tab=replies" className={ui.rowLink}>לכל התשובות</Link>}>
            {latestReplies.length ? (
              <ul className={ui.list}>
                {latestReplies.map(r => (
                  <li key={r.id} className={ui.listItem}>
                    <div className={ui.listText}>
                      <Link href={`/ops/emails/replies/${r.id}`} className={ui.listTitle}>{r.subject ?? 'ללא נושא'}</Link>
                      <span className={ui.listSub}>{r.fromName ?? r.fromEmail} · {relIL(r.receivedAt)}</span>
                    </div>
                    {r.status === 'new' && <Chip tone="warn">חדש</Chip>}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="עוד אין תשובות" text={settings.email.replyDomain ? 'תשובות למיילים יופיעו כאן.' : 'הפעילו את מעקב התשובות בלשונית ההגדרה.'} />
            )}
          </Card>
        </div>
        <Card title="לפי תבנית" sub="איזה מייל עובד: מסירה, פתיחה, הקלקה ותשובה לכל סוג הודעה" flush>
          {byTemplate.length ? (
            <Table head={['תבנית', ...rateHead]}>
              {byTemplate.map(r => (
                <tr key={r.key}><td><Link href={qs({ ...cur, tab: 'sent' }, { template: r.key })} className={ui.rowLink}>{templateName(r.key)}</Link></td>{rateCells(r)}</tr>
              ))}
            </Table>
          ) : (
            <Empty title="לא נשלחו מיילים בטווח הזה" />
          )}
        </Card>
        <Card title="עסקים שקיבלו הכי הרבה מיילים" flush>
          {byBusiness.length ? (
            <Table head={['עסק', ...rateHead]}>
              {byBusiness.map(r => (
                <tr key={r.key}><td><Link href={qs({ ...cur, tab: 'sent' }, { business: r.key })} className={ui.rowLink}>{names.get(r.key) ?? 'עסק'}</Link></td>{rateCells(r)}</tr>
              ))}
            </Table>
          ) : (
            <Empty title="עוד אין מיילים משויכים לעסקים" text="מיילים חדשים משויכים לעסק לפי הכתובת: בעלים, צוות, מייל הסניף או איש קשר בהזמנת שירות." />
          )}
        </Card>
        {t.sent > 0 && (
          <Card title="המשפך">
            <Bars
              items={[
                { name: 'נשלחו', value: t.sent, display: int(t.sent) },
                { name: 'נמסרו', value: t.delivered, display: int(t.delivered) },
                { name: 'נפתחו', value: t.opened, display: int(t.opened) },
                { name: 'הקליקו', value: t.clicked, display: int(t.clicked) },
                { name: 'ענו', value: t.replied, display: int(t.replied) },
              ]}
            />
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
