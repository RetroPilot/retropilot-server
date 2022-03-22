import bodyParser from 'body-parser';
import express from 'express';

import authenticationController from '../../controllers/authentication';
import { isAuthenticated } from '../../middlewares/authentication';

const router = express.Router();

router.get('/session', isAuthenticated, async (req, res) => {
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

  const account = await authenticationController.getAccountFromJWT(signIn.jwt, true);

  return res.status(200).cookie('jwt', signIn.jwt).json({
    success: true,
    data: {
      jwt: signIn.jwt,
      user: account.dataValues,
    },
  });
});

router.get('/logout', async (req, res) => {
  res.clearCookie('session');
  return res.json({ success: true });
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
