import type { Metadata } from 'next';
import { AdminShell } from '@/components/ops/AdminShell';
import { areaLevel, requireArea } from '@/components/ops/guard';
import { AREAS, AREA_NAMES, LEVEL_NAMES, MATRIX_GROUPS, OPS_ROLES, OPS_ROLE_NAMES, atLeast, permissionMatrix, type Level } from '@/components/ops/roles';
import { Card, Chip, PageHead, dateIL, relIL, ui } from '@/components/ops/ui';
import { permissionOverrides } from '@/lib/server/platformSettings';
import { staff } from './data';
import { InviteForm, PermissionCell, RoleSelect } from './TeamForms';
import styles from './team.module.css';

export const metadata: Metadata = { title: 'צוות והרשאות · ניהול', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const user = await requireArea('team', 'view', '/ops/team');
  const [level, people, overrides] = await Promise.all([areaLevel(user, 'team'), staff(), permissionOverrides()]);
  const canManage = atLeast(level, 'full');
  const matrix = permissionMatrix(overrides);
  const groupLevel = (role: string, areas: string[]): { level: Level; mixed: boolean } => {
    const levels = areas.map(a => matrix[role as keyof typeof matrix][a as keyof typeof AREA_NAMES]);
    const first = levels[0];
    return { level: first, mixed: levels.some(l => l !== first) };
  };

  return (
    <AdminShell user={user}>
      <PageHead eyebrow="מערכת" title="צוות והרשאות" lead="מי רואה מה ומי משנה מה. כניסת צוות בסיסמה; אימות דו־שלבי עוד לא קיים במערכת ולכן מסומן כך לכל חשבון." />
      <Card title="צוות BeautyFind" sub={`${people.length} חשבונות עם תפקיד`} aside={canManage ? <InviteForm /> : null} flush>
        {people.map(p => (
          <div key={p.id} className={styles.person}>
            <div className={styles.personText}>
              <div className={styles.personName}>{p.name || p.email} <span className={styles.personRole}>· {OPS_ROLE_NAMES[p.role] ?? p.role}</span></div>
              <div className={ui.sub} dir="ltr" style={{ textAlign: 'end' }}>{p.email}</div>
            </div>
            <div className={styles.personMeta}>
              <span>{p.lastLogin ? `כניסה אחרונה ${relIL(p.lastLogin)}` : 'עוד לא נכנס/ה'}</span>
              {!p.hasPassword ? <Chip tone="warn">{p.inviteExpires ? `הזמנה פתוחה עד ${dateIL(p.inviteExpires)}` : 'ללא סיסמה · נדרשת הזמנה חדשה'}</Chip> : null}
              {p.blockedAt ? <Chip tone="bad">חשבון חסום</Chip> : null}
              <Chip tone="neutral">אימות דו־שלבי · לא זמין</Chip>
            </div>
            {canManage ? <RoleSelect userId={p.id} role={p.role} self={p.id === user.id} /> : null}
          </div>
        ))}
      </Card>

      <Card title="הרשאות לפי תפקיד" sub={canManage ? 'לחיצה על תא מחליפה רמה: אין ← צפייה ← עריכה ← מלא. הרשאות שרת MCP ייגזרו מכאן.' : 'צפייה בלבד'} className={ui.stack}>
        <div className={styles.matrixWrap}>
          <table className={styles.matrix}>
            <thead><tr><th>תפקיד</th>{MATRIX_GROUPS.map(g => <th key={g.name} title={g.areas.map(a => AREA_NAMES[a]).join(', ')}>{g.name}</th>)}</tr></thead>
            <tbody>
              {OPS_ROLES.map(r => (
                <tr key={r}>
                  <td>{OPS_ROLE_NAMES[r]}</td>
                  {MATRIX_GROUPS.map(g => {
                    const gl = groupLevel(r, g.areas);
                    return <td key={g.name}>{canManage ? <PermissionCell role={r} areas={g.areas} level={gl.level} mixed={gl.mixed} locked={r === 'ops'} /> : <span className={styles.cell} data-level={gl.mixed ? 'mixed' : gl.level}>{gl.mixed ? 'מעורב' : LEVEL_NAMES[gl.level]}</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details>
          <summary className={ui.note} style={{ cursor: 'pointer' }}>פירוט לפי אזור ({AREAS.length} אזורים)</summary>
          <div className={styles.matrixWrap} style={{ marginTop: 10 }}>
            <table className={styles.matrix}>
              <thead><tr><th>אזור</th>{OPS_ROLES.map(r => <th key={r}>{OPS_ROLE_NAMES[r]}</th>)}</tr></thead>
              <tbody>
                {AREAS.map(a => (
                  <tr key={a}>
                    <td>{AREA_NAMES[a]}</td>
                    {OPS_ROLES.map(r => <td key={r}>{canManage ? <PermissionCell role={r} areas={[a]} level={matrix[r][a]} locked={r === 'ops'} /> : <span className={styles.cell} data-level={matrix[r][a]}>{LEVEL_NAMES[matrix[r][a]]}</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className={ui.hint}>״אין״ מסתיר את הפריט בתפריט. ״צפייה״ קוראת בלבד. ״עריכה״ מאפשרת פעולות. ״מלא״ מאפשר גם הגדרות של האזור, ובצוות גם שינוי תפקידים. ההגדרות נשמרות בהגדרות הפלטפורמה ונרשמות ביומן.</p>
      </Card>
    </AdminShell>
  );
}
