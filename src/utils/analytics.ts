const UMAMI_SCRIPT_URL = "https://cloud.umami.is/script.js";
const WEBSITE_ID =
  import.meta.env.VITE_UMAMI_WEBSITE_ID?.trim() ||
  "025c76e5-9a1a-40a2-aefb-3bf4c478b98a";
const TRACKED_DOMAINS =
  import.meta.env.VITE_UMAMI_DOMAINS?.trim() || "deziikuoo.github.io";

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: Record<string, string | number | boolean>) => void;
    };
  }
}

export function initAnalytics(): void {
  if (!WEBSITE_ID || import.meta.env.DEV) return;
  if (document.querySelector(`script[data-website-id="${WEBSITE_ID}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = UMAMI_SCRIPT_URL;
  script.dataset.websiteId = WEBSITE_ID;
  script.dataset.domains = TRACKED_DOMAINS;
  script.dataset.excludeSearch = "true";
  script.dataset.excludeHash = "true";
  document.head.appendChild(script);
}

export function trackEvent(name: string): void {
  if (!WEBSITE_ID || import.meta.env.DEV) return;
  window.umami?.track(name);
}
