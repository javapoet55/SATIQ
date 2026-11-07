import {PostgresStore} from './database.mjs';
import {createApp} from './app.mjs';
const database = new PostgresStore(process.env.DATABASE_URL);
await database.initialize();
const server = createApp({database});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Waypoint listening on port ${port}; PostgreSQL connected.`));
async function shutdown() {
  server.close(async () => { await database.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
