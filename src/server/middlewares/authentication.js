import authenticationController from '../controllers/authentication';

export const isAuthenticated = async (req, res, next) => {
  const account = await authenticationController.getAuthenticatedAccount(req);

  if (!account) {
    res.status(401).json({
      success: false,
      code: 'NOT_AUTHENTICATED',
    });
    return;
  }

  req.account = account;
  next();
};

export default null;
