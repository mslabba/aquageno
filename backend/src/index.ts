import 'dotenv/config';
import { app } from './app';
import { env } from './lib/env';
import { logger } from './lib/logger';

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'Aquageno API listening');
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
