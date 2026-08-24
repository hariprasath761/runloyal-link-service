#!/usr/bin/env node

import fs from 'node:fs/promises';

import { query } from '../src/lib/database.js';

const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
const migrations = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();

for (const name of migrations) {
    await query(await fs.readFile(new URL(name, migrationsDir), 'utf8'));
}

console.log(`Applied ${migrations.length} Supabase migrations.`);
