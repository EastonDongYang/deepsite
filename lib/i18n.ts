// lib/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpApi from 'i18next-http-backend'; // To load translations from /public/locales
import LanguageDetector from 'i18next-browser-languagedetector'; // To detect user language

// Import your i18next config
// Note: next-i18next.config.js is CJS, so direct import might be tricky in ES module.
// We'll manually use parts of its config here for i18next instance.
const i18nextConfig = {
  defaultLocale: 'en',
  locales: ['en', 'zh'],
};

i18n
  .use(HttpApi) // Loads translations from backend (e.g., /public/locales)
  .use(LanguageDetector) // Detects user language
  .use(initReactI18next) // Passes i18n instance to react-i18next
  .init({
    // lng: i18nextConfig.defaultLocale, // explicit language, or let detector work
    supportedLngs: i18nextConfig.locales,
    fallbackLng: i18nextConfig.defaultLocale,
    // defaultNS: 'common', // if you have a default namespace
    // ns: ['common'], // namespaces to load
    debug: process.env.NODE_ENV === 'development',
    interpolation: {
      escapeValue: false, // React already safes from xss
    },
    backend: {
      loadPath: '/locales/{{lng}}/{{ns}}.json', // Path to translation files
    },
    // detection: { // Options for LanguageDetector
    //   order: ['querystring', 'cookie', 'localStorage', 'sessionStorage', 'navigator', 'htmlTag'],
    //   caches: ['localStorage', 'cookie'],
    //   lookupQuerystring: 'lng', // example: /?lng=zh
    //   lookupCookie: 'i18next',
    //   lookupLocalStorage: 'i18nextLng',
    // }
  });

export default i18n;
