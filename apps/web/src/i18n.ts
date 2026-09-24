import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enCommon from './locales/en/common.json';
import bnCommon from './locales/bn/common.json';
import enNav from './locales/en/nav.json';
import bnNav from './locales/bn/nav.json';
import enHome from './locales/en/home.json';
import bnHome from './locales/bn/home.json';
import enBooking from './locales/en/booking.json';
import bnBooking from './locales/bn/booking.json';
import enDashboard from './locales/en/dashboard.json';
import bnDashboard from './locales/bn/dashboard.json';
import enErrors from './locales/en/errors.json';
import bnErrors from './locales/bn/errors.json';
import enAuth from './locales/en/auth.json';
import bnAuth from './locales/bn/auth.json';

const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('medinova-locale') : null;

void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: enCommon,
      nav: enNav,
      home: enHome,
      booking: enBooking,
      dashboard: enDashboard,
      errors: enErrors,
      auth: enAuth,
    },
    bn: {
      common: bnCommon,
      nav: bnNav,
      home: bnHome,
      booking: bnBooking,
      dashboard: bnDashboard,
      errors: bnErrors,
      auth: bnAuth,
    },
  },
  lng: stored === 'bn' ? 'bn' : 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language ?? 'en';
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng;
    try {
      localStorage.setItem('medinova-locale', lng);
    } catch {
      /* ignore */
    }
  });
}

export default i18n;
