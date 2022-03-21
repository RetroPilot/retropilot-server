import log4js from 'log4js';

log4js.configure({
  appenders: { logfile: { type: 'file', filename: 'server.log' }, out: { type: 'console' } /* {type: "file", filename: "server1.log"} */ },
  categories: { default: { appenders: ['out', 'logfile'], level: 'info' } },
});

process.on('unhandledRejection', (error, p) => {
  console.log('=== UNHANDLED REJECTION ===');
  console.log(error.promise, p);
  console.dir(error.stack);
});

require('./server');
