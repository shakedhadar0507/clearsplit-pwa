import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import he from './he';
import en from './en';

export type Lang = 'he' | 'en';

function storedLang(): Lang {
  try {
    return localStorage.getItem('cs-lang') === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

export function applyDocumentLang(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: storedLang(),
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
  returnNull: false,
  showSupportNotice: false,
});
applyDocumentLang(i18n.language as Lang);

export function setLanguage(lang: Lang) {
  try {
    localStorage.setItem('cs-lang', lang);
  } catch {
    /* ignore */
  }
  applyDocumentLang(lang);
  void i18n.changeLanguage(lang);
}

export const localeFor = (lang: string) => (lang === 'en' ? 'en-US' : 'he-IL');
export default i18n;
