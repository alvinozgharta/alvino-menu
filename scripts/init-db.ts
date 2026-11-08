import { initDb, getAdmin } from '../lib/db';

async function main() {
  console.log('Initializing database schema and singleton admin...');
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    console.log(`Connecting to database at: ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);
  } else {
    console.log('DATABASE_URL not set in environment. Initializing local storage fallback.');
  }

  await initDb();
  const admin = await getAdmin();

  if (admin) {
    console.log(`✓ Database successfully initialized!`);
    console.log(`  - Admin email: ${admin.email}`);
    console.log(`  - Admin ID: ${admin.id}`);
    console.log(`  - Updated at: ${admin.updatedAt.toISOString()}`);
  } else {
    console.error('Failed to verify admin record.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
