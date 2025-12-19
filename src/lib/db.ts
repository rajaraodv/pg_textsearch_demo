import { Pool } from 'pg';

// Connection string already includes credentials
// Remove sslmode from URL since we configure SSL separately in the Pool options
const rawUrl = process.env.DATABASE_URL || '';
const connectionString = rawUrl.replace(/\?sslmode=require$/, '');

// Create a connection pool
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export default pool;

