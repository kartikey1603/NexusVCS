import app from './app.js';
import { connectDb } from './db.js';
import { config } from './config.js';

try {
  await connectDb();
  app.listen(config.port, () => console.log(`NexusVCS backend listening on ${config.port}`));
} catch (error) {
  console.error('Failed to start NexusVCS', error);
  process.exit(1);
}
