import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.ADMIN_DATABASE_URL ?? 'postgresql://aquageno:aquageno@localhost:5433/postgres',
});

await client.connect();
const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = 'aquageno_test'");
if (existing.rowCount === 0) {
  await client.query('CREATE DATABASE aquageno_test');
}
await client.end();
