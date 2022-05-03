import express from 'express';

import { requireAuthenticated } from '../../../middlewares/authentication';
import { SetResearchStatus, GetResearchStatus } from '../../../controllers/user/settings';

// /api/devices
const router = express.Router();

router.patch('/research/:enabled', requireAuthenticated, async (req, res) => {
  const { enabled } = req.params;
  if (!enabled) { res.json({ bad: true }); }
  const doEnable = enabled === 'true';

  await SetResearchStatus(req.account.id, doEnable);

  return res.json({ success: true });
});

router.get('/research/', requireAuthenticated, async (req, res) => {
  const update = await GetResearchStatus(req.account.id);

  return res.json({ success: true, data: update });
});

export default router;
