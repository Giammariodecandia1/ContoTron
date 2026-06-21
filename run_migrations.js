import pg from 'pg';
import fs from 'fs';
import path from 'path';

const { Client } = pg;

const connectionString = process.env.SUPABASE_DB_URL;
const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');
const requestedFiles = process.argv.slice(2);

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL environment variable.');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  await client.connect();

  const files = requestedFiles.length > 0
    ? requestedFiles
    : fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .map(file => path.join(migrationsDir, file))
      .sort();

  for (const file of files) {
    const filePath = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`Running ${path.relative(process.cwd(), filePath)}...`);
    await client.query(sql);
  }

  await client.end();
  console.log('Migrations completed.');
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
