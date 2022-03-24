import log4js from 'log4js';

import server from './server';

log4js.configure({
  appenders: { logfile: { type: 'file', filename: 'server.log' }, out: { type: 'console' } },
  categories: { default: { appenders: ['out', 'logfile'], level: process.env.LOG_LEVEL || 'info' } },
});

process.on('unhandledRejection', (error, p) => {
  console.log('=== UNHANDLED REJECTION ===');
  console.log(error.promise, p);
  console.dir(error.stack);
});

server();
