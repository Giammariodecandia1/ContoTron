import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL environment variable.');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();

  const files = fs
    .readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running ${file}...`);
    await client.query(sql);
  }

  await client.end();
  console.log('Migrations completed.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
