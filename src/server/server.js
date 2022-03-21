import 'dotenv/config';
import http from 'http';
import log4js from 'log4js';

import app from './app';

app.then((server) => {
  const logger = log4js.getLogger('default');
  const httpServer = http.createServer(server);

  httpServer.listen(process.env.HTTP_PORT, () => {
    logger.info(`RetroPilot Server listening at ${process.env.BASE_URL}`);
  });
});
