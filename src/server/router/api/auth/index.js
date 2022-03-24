import bodyParser from 'body-parser';
import express from 'express';

import authenticationController from '../../../controllers/authentication';
import { requireAuthenticated } from '../../../middlewares/authentication';
import { createAccount, verifyEmailToken } from '../../../controllers/users';

// /api/auth
const router = express.Router();

router.get('/session', requireAuthenticated, async (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      user: req.account.dataValues,
    },
  });
});

router.post('/login', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  const signIn = await authenticationController.signIn(req.body.email, req.body.password);
  if (!signIn.success) {
    return res.status(401).json(signIn);
  }

  const account = await authenticationController.getAccountFromJWT(signIn.jwt);

  return res.status(200).cookie('jwt', signIn.jwt).json({
    success: true,
    data: {
      jwt: signIn.jwt,
      user: account.dataValues,
    },
  });
});

router.post('/logout', async (req, res) => {
  res.clearCookie('session');
  return res.json({ success: true });
});

router.post('/register', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    // FIXME: use logger.warn
    console.error('/useradmin/register/token - Malformed Request!');
    return res.status(400).json({ success: false, msg: 'malformed request' });
  }

  const accountStatus = await createAccount(req.body.email, req.body.password);
  if (accountStatus && accountStatus.status) {
    return res.status(accountStatus.status).json(accountStatus);
  }
  return res.status(500).json({ success: false, msg: 'contact server admin' });
});

router.post('/register/verify', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({
      success: false,
      data: { missingToken: true },
    });
  }

  const verified = await verifyEmailToken(req.params.token);

  if (verified && verified.status) {
    return res.status(verified.status).json(verified);
  }
  return res.status(500).json({ success: false, msg: 'contact server admin' });
});

// router.get('/session/get', async (req, res) => {
//   const account = await authenticationController.getAuthenticatedAccount(req);
//
//   if (!account) {
//     res.json({ success: true, hasSession: false, session: {} });
//   } else {
//     res.json({ success: true, hasSession: false, session: account });
//   }
// });

export default router;
