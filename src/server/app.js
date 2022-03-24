import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import log4js from 'log4js';

import controllers from './controllers';
import router from './router';

function runAsyncWrapper(callback) {
  return function wrapper(req, res, next) {
    callback(req, res, next)
      .catch(next);
  };
}

export default async () => {
  const logger = log4js.getLogger();
  const app = express();

  app.use(cors({
    origin: ['http://localhost:3000', 'https://connect.retropilot.org'],
    credentials: true,
  }));
  app.use(cookieParser());

  app.use(router);

  app.use('/favicon.ico', express.static('static/favicon.ico'));
  app.use(process.env.BASE_DRIVE_DOWNLOAD_PATH_MAPPING, express.static(process.env.STORAGE_PATH));

  app.use('/.well-known', express.static('.well-known'));

  app.use('/cabana', express.static('cabana/'));

  app.get('/', async (req, res) => {
    res.redirect('/useradmin');
  });

  app.get('*', runAsyncWrapper(async (req, res) => {
    logger.error(`HTTP.GET unhandled request: ${controllers.helpers.simpleStringify(req)}, ${controllers.helpers.simpleStringify(res)}`);
    res.status(404);
    res.send('Not Implemented');
  }));

  app.post('*', runAsyncWrapper(async (req, res) => {
    logger.error(`HTTP.POST unhandled request: ${controllers.helpers.simpleStringify(req)}, ${controllers.helpers.simpleStringify(res)}`);
    res.status(404);
    res.send('Not Implemented');
  }));

  return app;
};
