import type { MetadataRoute } from "next";
import { APP_NAME, APP_TITLE } from "@/lib/app-name";

// The name comes from .env at runtime, not at build time
export const dynamic = "force-dynamic";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_TITLE,
    short_name: APP_NAME,
    start_url: "/",
    display: "standalone",
    background_color: "#faf6f2",
    theme_color: "#5c3a24",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Lets the installed app appear in Android's share sheet, e.g. from the Funda app
    share_target: {
      action: "/nieuw",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  };
}
