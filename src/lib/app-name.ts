// The app's name, from .env so a fork can call it whatever it likes. Read at runtime (all pages are dynamic).
// APP_NAME is short (navigation bar, home screen, "Stuur naar …"), APP_TITLE the full name (browser tab).
export const APP_NAME = process.env.APP_NAME?.trim() || "Huizenjacht";
export const APP_TITLE = process.env.APP_TITLE?.trim() || APP_NAME;
