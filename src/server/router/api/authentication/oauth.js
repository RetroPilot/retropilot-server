import express from 'express';
import log4js from 'log4js';

import { getURL, getToken } from '../../../controllers/authentication/oauth/google';
import { isAuthenticated } from '../../../middlewares/authentication';

const router = express.Router();
const logger = log4js.getLogger('default');

router.get('/authentication/oauth/callback', async (req, res) => {
  logger.info(req.query);
  res.json(await getToken(req.query.code, req.query.scope));
});

router.get('/authentication/oauth/:provider', async (req, res) => {
  const { provider } = req.params;
  logger.info('provider', provider);
  let url;
  switch (provider) {
    case 'google':
      url = await getURL();
      break;
    default:
      url = false;
      break;
  }

  if (url) {
    res.redirect(url);
  } else {
    res.json({ error: true, msg: 'Invalid provider' });
  }
});

router.get('/authentication/oauth/pair/:provider', isAuthenticated, async (req, res) => {
  res.status(200);
});

export default router;
