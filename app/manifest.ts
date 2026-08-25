import type { MetadataRoute } from "next";

// Served at /manifest.webmanifest; Next injects the <link rel="manifest"> tag.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "shh. — share a secret",
    short_name: "shh.",
    description: "Self-destructing secret sharing.",
    // Installed app always opens on the create form, never on a secret link.
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["utilities", "productivity", "security"],
    icons: [
      {
        src: "/icons/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        type: "image/png",
        sizes: "192x192",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        type: "image/png",
        sizes: "192x192",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
  };
}
