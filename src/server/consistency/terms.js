export const API_VERSION_NOT_PROVIDED = 'API VERSION MUST BE INCLUDED';

export const AUTH_OAUTH_ERR_GOOGLE = { code: 'ATH_GOO_001', msg: 'AUTH OAUTH ERROR GOOGLE' };
export const AUTH_OAUTH_ERR_GOOGLE_FAILED_TOKEN_FETCH = { code: 'ATH_GOO_002', msg: 'FAILED TO FETCH TOKEN' };

export const AUTH_REGISTER_OAUTH_NO_EMAIL = { code: 'ATHR_REG_OTH_001', msg: 'MISSING EMAIL' };

export const AUTH_REGISTER_ALREADY_REGISTERED = { code: 'ATHR_REG_001', msg: 'ACCOUNT WITH EMAIL ALREADY EXISTS' };

export const AUTH_2FA_BAD_ACCOUNT = { code: 'AUTH_2FA_001', msg: 'AUTHENTICATION 2FA BAD ACCOUNT' };
export const AUTH_2FA_ONBOARD_ALREADY_ENROLLED = { code: 'AUTH_2FA_002', msg: 'AUTHENTICATION 2FA USER ALREADY ENROLLED' };
export const AUTH_2FA_NOT_ENROLLED = { code: 'AUTH_2FA_003', msg: 'AUTHENTICATION 2FA NOT ENROLLED' };
export const AUTH_2FA_BAD_TOKEN = { code: 'AUTH_2FA_004', msg: 'AUTHENTICATION 2FA BAD TOKEN' };
export const AUTH_2FA_ENROLLED = { code: 'AUTH_2FA_005', msg: 'AUTHENTICATION 2FA SUCCESSFULLY ENROLLED' };

export default '';
