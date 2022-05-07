import express from 'express';
import bodyParser from 'body-parser';

import { requireAuthenticated } from '../../../middlewares/authentication';
import {
  SetResearchStatus, GetResearchStatus, GetUserSettings, SetUserSettings,
} from '../../../controllers/user/settings';

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

// TODO: error handling
router.get('/', requireAuthenticated, async (req, res) => {
  const update = await GetUserSettings(req.account.id);

  return res.json({ success: true, data: update });
});

router.put('/', [requireAuthenticated, bodyParser.urlencoded({ extended: true })], async (req, res) => {
  const { account, body: { settings } } = req;
  const settingsJson = JSON.parse(settings);

  return res.json(await SetUserSettings(account.id, settingsJson));
});

export default router;
