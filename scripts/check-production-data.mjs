import pg from 'pg';

const { Client } = pg;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
  console.error('Missing SUPABASE_DB_URL environment variable.');
  process.exit(1);
}

const trackedTables = [
  'households',
  'household_members',
  'transactions',
  'transaction_items',
  'budget_targets',
  'documents',
  'categories',
  'subcategories',
  'recurring_rules',
];

const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });

try {
  await client.connect();
  const counts = {};
  for (const table of trackedTables) {
    const result = await client.query(`select count(*)::int as count from public.${table}`);
    counts[table] = result.rows[0].count;
  }
  console.log(JSON.stringify(counts));
} finally {
  await client.end();
}
