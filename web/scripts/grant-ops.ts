// Grants a BeautyFind staff role to an existing user.
// Usage: npm run ops:grant -- someone@beautyfind.co.il verifier
import { PrismaClient, type OpsRole } from '@prisma/client';

const ROLES: OpsRole[] = ['moderator', 'verifier', 'ops', 'support', 'legal'];

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !ROLES.includes(role as OpsRole)) {
    console.error(`usage: npm run ops:grant -- <email> <${ROLES.join('|')}>`);
    process.exit(1);
  }
  const db = new PrismaClient();
  const user = await db.user.update({ where: { email: email.toLowerCase() }, data: { opsRole: role as OpsRole } }).catch(() => null);
  await db.$disconnect();
  if (!user) {
    console.error(`no user with email ${email}. Sign up at /login?role=biz first.`);
    process.exit(1);
  }
  console.log(`${email} is now ${role}`);
}

main();
