import bodyParser from 'body-parser';
import crypto from 'crypto';
import dirTree from 'directory-tree';
import express from 'express';
import log4js from 'log4js';

import { requireAuthenticated } from '../../../middlewares/authentication';
import { SetResearchStatus, GetResearchStatus } from '../../../controllers/user/settings';

const logger = log4js.getLogger();

// /api/devices
const router = express.Router();

router.patch('/research/:enabled', requireAuthenticated, async (req, res) => {
    const { enabled } = req.params;
    if (!enabled) { res.json({ bad: true }); }
    const doEnable = enabled === 'true';
    const accountId = req.account.id;
  
    const update = await SetResearchStatus(req.account.id, doEnable);
  
    return res.json({ success: true, data: req.account });
  });

  router.get('/research/', requireAuthenticated, async (req, res) => {
    const accountId = req.account.id;
  
    const update = await GetResearchStatus(req.account.id);
  
    return res.json({ success: true, data: update });
  });

export default router;
