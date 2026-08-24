export async function registerEarth777ServiceWorker() {
  if (!("serviceWorker" in navigator) || !globalThis.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
  } catch (error) {
    console.info("Earth 777 repeat-visit cache unavailable.", error);
    return null;
  }
}
