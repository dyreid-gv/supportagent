import { storage } from "./storage";

const ARTICLE_URLS: { url: string; categoryPath: string; websiteCategory: string }[] = [
  // ID-søk (3)
  { url: "https://www.dyreid.no/hjelp-id-sok/35-hvorfor-bor-jeg-id-merke", categoryPath: "hjelp-id-sok", websiteCategory: "ID-søk" },
  { url: "https://www.dyreid.no/hjelp-id-sok/38-hvordan-kontrollere-kontaktdata-pa-mitt-chip-nr", categoryPath: "hjelp-id-sok", websiteCategory: "ID-søk" },
  { url: "https://www.dyreid.no/hjelp-id-sok/22-kjaeledyret-mitt-er-ikke-sokbart", categoryPath: "hjelp-id-sok", websiteCategory: "ID-søk" },

  // DyreID-appen (7)
  { url: "https://www.dyreid.no/dyreid-app/81-hvordan-far-jeg-tilgang-til-appen", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/82-innlogging-app", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/77-hvorfor-app", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/76-hvem-passer-appen-for", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/79-hva-er-forskjellen-pa-basis-og-dyreid-plus-abonnement", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/78-koster-appen-noe", categoryPath: "dyreid-app", websiteCategory: "App" },
  { url: "https://www.dyreid.no/dyreid-app/83-dyreid-app-min-side", categoryPath: "dyreid-app", websiteCategory: "App" },

  // Min side (12)
  { url: "https://www.dyreid.no/hjelp-min-side/53-logg-inn-pa-min-side", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/23-hvorfor-har-jeg-fatt-sms-e-post", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/24-har-jeg-en-min-side", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/17-hvorfor-far-jeg-ikke-logget-meg-inn-pa-min-side", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/25-feilmelding-e-postadresse", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/26-feilmelding-telefonnummer", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/27-legge-til-flere-telefonnumre-eller-e-postadresser", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/28-det-er-registrert-feil-pa-min-side", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/29-det-mangler-et-dyr-pa-min-side", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/90-dyret-er-dodt-hva-gjor-jeg", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/36-slett-meg", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },
  { url: "https://www.dyreid.no/hjelp-min-side/74-eksporter-mine-data", categoryPath: "hjelp-min-side", websiteCategory: "Min side" },

  // Eierskifte (5)
  { url: "https://www.dyreid.no/hjelp-eierskifte/92-eierskifte-app", categoryPath: "hjelp-eierskifte", websiteCategory: "Eierskifte" },
  { url: "https://www.dyreid.no/hjelp-eierskifte/31-hva-koster-eierskifte", categoryPath: "hjelp-eierskifte", websiteCategory: "Eierskifte" },
  { url: "https://www.dyreid.no/hjelp-eierskifte/32-hvordan-foreta-eierskifte-av-et-kjaeledyr", categoryPath: "hjelp-eierskifte", websiteCategory: "Eierskifte" },
  { url: "https://www.dyreid.no/hjelp-eierskifte/97-eierskifte-nar-eier-er-dod", categoryPath: "hjelp-eierskifte", websiteCategory: "Eierskifte" },
  { url: "https://www.dyreid.no/hjelp-eierskifte/41-eierskifte-av-nkk-registrert-hund", categoryPath: "hjelp-eierskifte", websiteCategory: "Eierskifte" },

  // Smart Tag (11)
  { url: "https://www.dyreid.no/smart-tag-help/134-kan-ikke-koble-til-eller-legge-til-taggen-ios", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/133-taggen-var-lagt-til-for-men-jeg-finner-den-ikke-ios", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/132-posisjonen-har-ikke-oppdatert-seg-pa-lenge-ios", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/131-taggen-lager-lyder-av-seg-selv-ios", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/130-jeg-har-flere-tagger-men-far-bare-koblet-til-den-ene-ios", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/129-kan-ikke-koble-til-eller-legge-til-taggen-android", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/125-taggen-var-lagt-til-for-men-jeg-finner-den-ikke-android", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/128-posisjonen-har-ikke-oppdatert-seg-pa-lenge-android", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/127-taggen-lager-lyder-av-seg-selv-android", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smart-tag-help/126-jeg-har-flere-tagger-men-far-bare-koblet-til-den-ene-android", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },
  { url: "https://www.dyreid.no/smarttag/help", categoryPath: "smart-tag-help", websiteCategory: "Produkter - Smart Tag" },

  // QR-brikke (10)
  { url: "https://www.dyreid.no/qr-brikke/109-passer-dyreids-qr-brikke-for-bade-hunder-og-katter", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/108-ma-kjaeledyret-mitt-vaere-id-merket-for-a-bruke-tag-en", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/107-er-det-et-abonnement-jeg-ma-kjope-eller-er-det-kun-en-engangskostnad", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/106-hvordan-aktivere-qr-brikken", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/105-er-kontaktinformasjonen-min-tilgjengelig-for-alle-som-skanner-tag-en", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/104-hva-skjer-nar-qr-koden-skannes", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/103-jeg-har-endret-min-kontaktinformasjon-hvordan-oppdaterer-jeg-det", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/102-mitt-dyr-er-id-merket-hva-er-fordelen-med-dyreids-qr-brikke", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/100-jeg-har-mistet-tag-en-hva-gjor-jeg", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },
  { url: "https://www.dyreid.no/qr-brikke/99-hva-skjer-hvis-abonnementet-mitt-utloper", categoryPath: "qr-brikke", websiteCategory: "Produkter - QR Tag" },

  // Utenlandsregistrering (3)
  { url: "https://www.dyreid.no/hjelp-utenlandsregistrering/33-hvordan-fa-dyret-registrert-i-norge", categoryPath: "hjelp-utenlandsregistrering", websiteCategory: "Registrering" },
  { url: "https://www.dyreid.no/hjelp-utenlandsregistrering/34-hva-koster-det-a-registrere-et-dyr-i-norge", categoryPath: "hjelp-utenlandsregistrering", websiteCategory: "Registrering" },
  { url: "https://www.dyreid.no/hjelp-utenlandsregistrering/40-utenlandsk-hund-med-stamtavle", categoryPath: "hjelp-utenlandsregistrering", websiteCategory: "Registrering" },

  // Savnet & Funnet (5)
  { url: "https://www.dyreid.no/help-savnet-og-funnet/93-hvordan-melde-mitt-kjaeledyr-savnet", categoryPath: "help-savnet-og-funnet", websiteCategory: "Savnet/Funnet" },
  { url: "https://www.dyreid.no/help-savnet-og-funnet/96-kjaeledyret-mitt-har-kommet-til-rette-hva-gjor-jeg", categoryPath: "help-savnet-og-funnet", websiteCategory: "Savnet/Funnet" },
  { url: "https://www.dyreid.no/help-savnet-og-funnet/58-hvordan-fungerer-savnet-og-funnet-fra-dyreid", categoryPath: "help-savnet-og-funnet", websiteCategory: "Savnet/Funnet" },
  { url: "https://www.dyreid.no/help-savnet-og-funnet/59-hvordan-fungerer-sokbar-pa-1-2-3", categoryPath: "help-savnet-og-funnet", websiteCategory: "Savnet/Funnet" },
  { url: "https://www.dyreid.no/help-savnet-og-funnet/61-sokbar-pa-1-2-3-kan-den-misbrukes", categoryPath: "help-savnet-og-funnet", websiteCategory: "Savnet/Funnet" },

  // Familiedeling (8)
  { url: "https://www.dyreid.no/familiedeling/110-hvorfor-burde-jeg-ha-familiedeling", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/111-kan-jeg-dele-tilgang-med-andre-enn-familien", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/112-trenger-jeg-dyreid-for-a-bruke-familiedeling", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/113-jeg-har-sendt-en-foresporsel-til-et-familiemedlem-men-den-har-ikke-blitt-akseptert-hva-gjor-jeg", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/114-hvordan-deler-jeg-tilgang-til-mine-kjaeledyr-med-andre-familiemedlemmer", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/115-kan-de-jeg-deler-kjaeledyret-mitt-med-gjore-endringer", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/116-jeg-ser-ikke-lenger-kjaeledyret-som-har-blitt-delt-med-meg", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
  { url: "https://www.dyreid.no/familiedeling/117-kan-jeg-bruke-familiedeling-med-noen-som-allerede-har-et-kjaeledyr", categoryPath: "familiedeling", websiteCategory: "Familiedeling" },
];

function extractArticleId(url: string): number | null {
  const match = url.match(/\/(\d+)-/);
  return match ? parseInt(match[1], 10) : null;
}

function extractSlug(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] || "";
}

function extractArticleContent(html: string): { title: string; bodyText: string; bodyHtml: string; relatedUrls: string[] } {
  let title = "";
  const titleMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i)
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/<[^>]+>/g, "").trim();
  }

  let bodyHtml = "";
  let bodyText = "";

  const articleBodyMatch = html.match(/<div[^>]*itemprop="articleBody"[^>]*>([\s\S]*?)<\/div>/i);

  if (articleBodyMatch) {
    bodyHtml = articleBodyMatch[1];
    const endMarker = bodyHtml.indexOf("Løste dette problemet ditt");
    if (endMarker > -1) {
      bodyHtml = bodyHtml.substring(0, endMarker);
    }
  } else {
    const h1End = html.indexOf("</h1>");
    if (h1End > -1) {
      const afterH1 = html.substring(h1End + 5);
      const footerPos = afterH1.indexOf("Løste dette problemet ditt");
      const endPos = footerPos > -1 ? footerPos : Math.min(afterH1.length, 5000);
      bodyHtml = afterH1.substring(0, endPos);
    }
  }

  bodyText = bodyHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const relatedUrls: string[] = [];
  const linkRegex = /href="(https:\/\/www\.dyreid\.no\/(?:hjelp-|dyreid-app|smart-tag|qr-brikke|familiedeling|help-savnet)[^"]*?)"/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const cleanUrl = linkMatch[1].replace(/\.html$/, "");
    if (!relatedUrls.includes(cleanUrl)) {
      relatedUrls.push(cleanUrl);
    }
  }

  return { title, bodyText, bodyHtml, relatedUrls };
}

function mapToSubcategory(title: string, categoryPath: string): string {
  return title;
}

export async function scrapeHjelpesenter(
  onProgress?: (msg: string, pct: number) => void
): Promise<{ total: number; scraped: number; errors: number; byCategory: Record<string, number> }> {
  const total = ARTICLE_URLS.length;
  let scraped = 0;
  let errors = 0;
  const byCategory: Record<string, number> = {};
  const CONCURRENCY = 5;

  onProgress?.(`Starter scraping av ${total} hjelpesenter-artikler...`, 0);

  for (let i = 0; i < ARTICLE_URLS.length; i += CONCURRENCY) {
    const batch = ARTICLE_URLS.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (article) => {
        try {
          const response = await fetch(article.url, {
            headers: {
              "User-Agent": "DyreID-Support-Agent/1.0",
              "Accept": "text/html",
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const html = await response.text();
          const { title, bodyText, bodyHtml, relatedUrls } = extractArticleContent(html);

          if (!title) {
            throw new Error("Could not extract title");
          }

          const articleId = extractArticleId(article.url);
          const urlSlug = extractSlug(article.url);

          await storage.upsertHelpCenterArticle({
            articleId,
            url: article.url,
            urlSlug,
            title,
            bodyHtml,
            bodyText,
            hjelpesenterCategory: article.websiteCategory,
            hjelpesenterSubcategory: mapToSubcategory(title, article.categoryPath),
            categoryPath: article.categoryPath,
            relatedArticleUrls: relatedUrls,
          });

          byCategory[article.websiteCategory] = (byCategory[article.websiteCategory] || 0) + 1;
          scraped++;
        } catch (err: any) {
          errors++;
          console.error(`[scraper] Error fetching ${article.url}: ${err.message}`);
        }
      })
    );

    const pct = Math.round(((i + batch.length) / total) * 100);
    onProgress?.(`Scrapet ${scraped}/${total} artikler (${errors} feil)`, pct);
  }

  onProgress?.(`Ferdig! ${scraped} artikler scrapet, ${errors} feil`, 100);
  return { total, scraped, errors, byCategory };
}
