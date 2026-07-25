import disposableDomains from 'disposable-email-domains';

// Free consumer webmail providers. Signups must use a company domain — this is
// the abuse gate on top of the per-IP register rate limit. Not exhaustive by
// design: it targets the high-volume consumer providers, and the disposable
// list below catches throwaway services.
const FREE_PROVIDERS = new Set<string>([
  // Google / Microsoft / Apple / AOL
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'outlook.co.uk',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'hotmail.it',
  'hotmail.de',
  'hotmail.es',
  'live.com',
  'live.co.uk',
  'live.fr',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'aim.com',
  // Yahoo family
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.fr',
  'yahoo.de',
  'yahoo.es',
  'yahoo.it',
  'yahoo.ca',
  'yahoo.com.au',
  'yahoo.com.br',
  'ymail.com',
  'rocketmail.com',
  // Privacy-first / independent webmail
  'protonmail.com',
  'proton.me',
  'pm.me',
  'tutanota.com',
  'tutanota.de',
  'tuta.io',
  'tutamail.com',
  'hushmail.com',
  'hey.com',
  'fastmail.com',
  'fastmail.fm',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'gmx.us',
  'mail.com',
  'email.com',
  'zoho.com',
  'zohomail.com',
  // Russia / CIS
  'yandex.com',
  'yandex.ru',
  'ya.ru',
  'mail.ru',
  'list.ru',
  'bk.ru',
  'inbox.ru',
  'rambler.ru',
  // China / Korea
  'qq.com',
  '163.com',
  '126.com',
  'sina.com',
  'sina.cn',
  'foxmail.com',
  'naver.com',
  'daum.net',
  'hanmail.net',
  // US ISPs
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'cox.net',
  'bellsouth.net',
  // UK / EU ISPs
  'btinternet.com',
  'virginmedia.com',
  'blueyonder.co.uk',
  'orange.fr',
  'wanadoo.fr',
  'free.fr',
  'laposte.net',
  'sfr.fr',
  'libero.it',
  'virgilio.it',
  'web.de',
  't-online.de',
  'freenet.de',
  'seznam.cz',
  'wp.pl',
  'o2.pl',
  'onet.pl',
]);

// 120k+ throwaway/temporary domains. Built lazily on first check so the large
// list never inflates cold start on the hot request paths (register is rare).
let disposableSet: Set<string> | null = null;
const isDisposable = (domain: string): boolean => {
  if (!disposableSet) {
    disposableSet = new Set(disposableDomains);
  }
  return disposableSet.has(domain);
};

const domainOf = (email: string): string =>
  email.slice(email.lastIndexOf('@') + 1).toLowerCase();

// A user-facing reason the address may not register, or null if it's allowed.
// Expects `email` already format-validated + lowercased (emailField).
export const businessEmailError = (email: string): string | null => {
  const domain = domainOf(email);
  if (!domain) {
    return 'enter a valid email address';
  }
  if (FREE_PROVIDERS.has(domain)) {
    return 'use your work email (personal email providers are not accepted)';
  }
  if (isDisposable(domain)) {
    return 'temporary or disposable email addresses are not accepted';
  }
  return null;
};
