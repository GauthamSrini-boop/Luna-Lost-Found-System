import { makeConfig } from './config.js';
import { Db, driverName } from './lib/db.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

const config = makeConfig();
const db = new Db(config.databasePath);
migrate(db, undefined, (m) => console.log(`[migrate] ${m}`));
const app = createApp({ config, db });

const server = app.listen(config.port, () => {
  console.log(`LUNA listening on http://localhost:${config.port} (${config.nodeEnv}, SQLite driver: ${driverName})`);
  if (config.usingDevSecret) console.warn('WARNING: using the insecure development SESSION_SECRET. Set SESSION_SECRET in .env.');
});
const shutdown = () => { server.close(() => { db.close(); process.exit(0); }); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
