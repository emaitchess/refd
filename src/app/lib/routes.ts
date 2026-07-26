export const APP_BASE_PATH = '/app';

export const SIGN_IN_PATH = '/sign-in';
export const CREATE_ACCOUNT_PATH = '/create-account';

export const appUrl = (path: `/${string}`) =>
  path === '/' ? APP_BASE_PATH : `${APP_BASE_PATH}${path}`;

export const SIGN_IN_URL = appUrl(SIGN_IN_PATH);
export const CREATE_ACCOUNT_URL = appUrl(CREATE_ACCOUNT_PATH);
