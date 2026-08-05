#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RecordingDaemon } from './lib/agent-record-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, values) => {
    if (value.startsWith('--') && index + 1 < values.length) {
      pairs.push([value.slice(2), values[index + 1]]);
    }
    return pairs;
  }, []),
);

if (!options.session || !options.output) {
  throw new Error('录制服务缺少 --session 或 --output');
}

const daemon = new RecordingDaemon({
  root,
  sessionId: options.session,
  sessionDirectory: path.resolve(options.output),
  owner: options.owner || 'Google Chrome',
  title: options.title || '',
});

const shutdown = async () => {
  await daemon.fail('DAEMON_TERMINATED', '本地录制服务被终止');
  await daemon.close();
  process.exit(1);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', async (error) => {
  await daemon.fail('DAEMON_CRASHED', error?.message || '本地录制服务异常');
  await daemon.close();
  process.exit(1);
});

await daemon.startServer();
