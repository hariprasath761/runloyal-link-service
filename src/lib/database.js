import pg from 'pg';

import {
    SUPABASE_DB_HOST,
    SUPABASE_DB_NAME,
    SUPABASE_DB_PASSWORD,
    SUPABASE_DB_PORT,
    SUPABASE_DB_USER,
} from '../config.js';

const { Pool } = pg;

export const databaseEnabled = Boolean(
    SUPABASE_DB_HOST && SUPABASE_DB_USER && SUPABASE_DB_PASSWORD,
);

export const pool = databaseEnabled
    ? new Pool({
        host: SUPABASE_DB_HOST,
        port: SUPABASE_DB_PORT,
        database: SUPABASE_DB_NAME,
        user: SUPABASE_DB_USER,
        password: SUPABASE_DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 10_000,
    })
    : null;

export async function query(text, values = []) {
    if (!pool) throw new Error('Supabase database is not configured');
    return pool.query(text, values);
}