// Aplica o schema.sql no banco configurado. Uso: npm run db:migrate
import 'dotenv/config';
import { closeDb, initDb } from './dbClient.js';

const db = await initDb();
console.log(`[db] schema aplicado (${db.kind}).`);
await closeDb();
