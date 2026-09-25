// Deletes visitbookings rows created in OTP_DEV_MODE (is_test = true). Touches nothing else.
// Run: npm run db:cleanup-test
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
const before = await sql`select status, is_test, count(*)::int as n from visitbookings group by 1, 2 order by 1, 2`;
console.log('rows by status/is_test before:', JSON.stringify(before));
const del = await sql`delete from visitbookings where is_test = true returning id`;
console.log('deleted test rows:', del.length);
const after = await sql`select count(*)::int as n from visitbookings`;
console.log('rows remaining:', after[0].n);
