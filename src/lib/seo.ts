import type { Page } from '../types';
import type { Lang } from '../types';
import { pathFromPage } from './pageRoute';

export const SITE_URL = 'https://tahanote.com';
export const SITE_NAME = 'Taha Note';
export const SITE_AUTHOR = 'Abdullah Taha';
export const OG_IMAGE = `${SITE_URL}/logo.png`;

const DEFAULT = {
  sv: {
    title: 'Taha Note – Anteckningar, Quiz & AI-chatt',
    description:
      'Taha Note är en molnbaserad app för anteckningar, studier och produktivitet. Skriv, organisera, skapa quiz, chatta med AI och ladda upp filer – på svenska och engelska.',
    keywords:
      'Taha Note, anteckningar, studieapp, quiz, AI chatt, molnsynk, produktivitet, anteckningsapp, studera, Sverige',
  },
  en: {
    title: 'Taha Note – Notes, Quiz & AI Chat',
    description:
      'Taha Note is a cloud-based app for notes, studying, and productivity. Write, organize, create quizzes, chat with AI, and upload files – in Swedish and English.',
    keywords:
      'Taha Note, notes app, study app, quiz, AI chat, cloud sync, productivity, note taking, Sweden',
  },
} as const;

const PAGE_META: Partial<Record<Page, { sv: { title: string; description: string }; en: { title: string; description: string }; noindex?: boolean }>> = {
  home: {
    sv: {
      title: 'Taha Note – Skriv, organisera och studera dina anteckningar',
      description:
        'Skapa anteckningar med rich text, favoriter, arkiv och molnsynk. Taha Note hjälper dig att skriva, organisera och studera effektivt.',
    },
    en: {
      title: 'Taha Note – Write, organize, and study your notes',
      description:
        'Create rich-text notes with favourites, archive, and cloud sync. Taha Note helps you write, organize, and study efficiently.',
    },
  },
  library: {
    sv: { title: 'Anteckningsbibliotek – Taha Note', description: 'Bläddra och hantera alla dina aktiva anteckningar i Taha Note.' },
    en: { title: 'Notes Library – Taha Note', description: 'Browse and manage all your active notes in Taha Note.' },
  },
  files: {
    sv: { title: 'Ladda upp filer – Taha Note', description: 'Ladda upp och spara filer säkert i ditt Taha Note-molnkonto. Max 20 MB per fil.' },
    en: { title: 'File Uploads – Taha Note', description: 'Upload and store files securely in your Taha Note cloud account. Up to 20 MB per file.' },
  },
  quiz: {
    sv: { title: 'Quiz – Taha Note', description: 'Skapa och träna med quiz från dina anteckningar i Taha Note.' },
    en: { title: 'Quiz – Taha Note', description: 'Create and practice quizzes from your notes in Taha Note.' },
  },
  chat: {
    sv: { title: 'AI Chat – Taha Note', description: 'Chatta med AI om dina anteckningar och filer i Taha Note.' },
    en: { title: 'AI Chat – Taha Note', description: 'Chat with AI about your notes and files in Taha Note.' },
  },
  unread: {
    sv: { title: 'Att studera – Taha Note', description: 'Anteckningar du ännu inte studerat – organiserade i Taha Note.' },
    en: { title: 'Notes to Study – Taha Note', description: 'Notes you have not studied yet – organized in Taha Note.' },
  },
  read: {
    sv: { title: 'Studerade anteckningar – Taha Note', description: 'Dina lästa och studerade anteckningar i Taha Note.' },
    en: { title: 'Studied Notes – Taha Note', description: 'Your read and studied notes in Taha Note.' },
  },
  fav: {
    sv: { title: 'Favoriter – Taha Note', description: 'Dina favoritmarkerade anteckningar i Taha Note.' },
    en: { title: 'Favourites – Taha Note', description: 'Your favourite notes in Taha Note.' },
  },
  archive: {
    sv: { title: 'Arkiv – Taha Note', description: 'Arkiverade anteckningar sparade i Taha Note.' },
    en: { title: 'Archive – Taha Note', description: 'Archived notes stored in Taha Note.' },
  },
  trash: {
    sv: { title: 'Papperskorg – Taha Note', description: 'Raderade anteckningar och quiz i Taha Note.' },
    en: { title: 'Trash – Taha Note', description: 'Deleted notes and quizzes in Taha Note.' },
  },
  settings: {
    sv: { title: 'Inställningar – Taha Note', description: 'Hantera ditt Taha Note-konto och lagring.' },
    en: { title: 'Settings – Taha Note', description: 'Manage your Taha Note account and storage.' },
  },
  admin: {
    sv: { title: 'Admin – Taha Note', description: 'Administratörspanel för Taha Note.' },
    en: { title: 'Admin – Taha Note', description: 'Administrator panel for Taha Note.' },
    noindex: true,
  },
};

export function getPageSeo(page: Page, lang: Lang) {
  const fallback = DEFAULT[lang];
  const pageMeta = PAGE_META[page]?.[lang];
  return {
    title: pageMeta?.title ?? fallback.title,
    description: pageMeta?.description ?? fallback.description,
    keywords: fallback.keywords,
    noindex: PAGE_META[page]?.noindex ?? false,
    canonical: `${SITE_URL}${pathFromPage(page)}`,
  };
}

function upsertMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}

export function applySeo(page: Page, lang: Lang) {
  const seo = getPageSeo(page, lang);
  document.documentElement.lang = lang === 'sv' ? 'sv' : 'en';
  document.title = seo.title;

  upsertMeta('description', seo.description);
  upsertMeta('keywords', seo.keywords);
  upsertMeta('author', SITE_AUTHOR);
  upsertMeta('robots', seo.noindex ? 'noindex, nofollow' : 'index, follow');
  upsertMeta('googlebot', seo.noindex ? 'noindex, nofollow' : 'index, follow');

  upsertMeta('og:title', seo.title, 'property');
  upsertMeta('og:description', seo.description, 'property');
  upsertMeta('og:type', 'website', 'property');
  upsertMeta('og:url', seo.canonical, 'property');
  upsertMeta('og:site_name', SITE_NAME, 'property');
  upsertMeta('og:image', OG_IMAGE, 'property');
  upsertMeta('og:locale', lang === 'sv' ? 'sv_SE' : 'en_US', 'property');
  upsertMeta('og:locale:alternate', lang === 'sv' ? 'en_US' : 'sv_SE', 'property');

  upsertMeta('twitter:card', 'summary_large_image');
  upsertMeta('twitter:title', seo.title);
  upsertMeta('twitter:description', seo.description);
  upsertMeta('twitter:image', OG_IMAGE);

  upsertLink('canonical', seo.canonical);
}

export function injectJsonLd() {
  const id = 'taha-note-jsonld';
  if (document.getElementById(id)) return;

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: SITE_NAME,
        description: DEFAULT.sv.description,
        inLanguage: ['sv-SE', 'en-US'],
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: { '@type': 'ImageObject', url: OG_IMAGE },
        founder: { '@type': 'Person', name: SITE_AUTHOR },
      },
      {
        '@type': 'WebApplication',
        '@id': `${SITE_URL}/#app`,
        name: SITE_NAME,
        url: SITE_URL,
        applicationCategory: 'ProductivityApplication',
        operatingSystem: 'Web',
        browserRequirements: 'Requires JavaScript',
        description: DEFAULT.en.description,
        inLanguage: ['sv', 'en'],
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'SEK' },
        featureList: [
          'Rich-text notes',
          'Cloud sync',
          'Quiz generation',
          'AI chat',
          'File uploads',
          'Favourites and archive',
          'Swedish and English',
        ],
        author: { '@type': 'Person', name: SITE_AUTHOR },
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
    ],
  };

  const script = document.createElement('script');
  script.id = id;
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}
