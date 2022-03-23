import log4js from 'log4js';

import worker from './worker';

log4js.configure({
  appenders: { logfile: { type: 'file', filename: 'worker.log' }, out: { type: 'console' } },
  categories: { default: { appenders: ['out', 'logfile'], level: 'info' } },
});

process.on('unhandledRejection', (error, p) => {
  console.log('=== UNHANDLED REJECTION ===');
  console.log(error.promise, p);
  console.dir(error.stack);
});

const logger = log4js.getLogger();

// make sure bunzip2 is available
try {
  // execSync('bunzip2 --help');
} catch (exception) {
  logger.error('bunzip2 is not installed or not available in environment path');
  process.exit();
}

worker();
