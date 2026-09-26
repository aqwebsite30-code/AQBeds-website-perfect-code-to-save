import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = "67893aa8cdc24e918a97e93a1f5c7256";
const host = "https://www.aqbeds.com";

const here = path.dirname(fileURLToPath(import.meta.url));

function urlsFromSitemap() {
  try {
    const xml = fs.readFileSync(path.join(here, "..", "public", "sitemap.xml"), "utf8");
    const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (found.length) return found;
    console.error("IndexNow: no <loc> entries found in sitemap.xml");
  } catch (err) {
    console.error("IndexNow: could not read sitemap.xml:", err.message);
  }
  // fallback: the pages that must always be submitted
  return [`${host}/`, `${host}/shop`, `${host}/faqs`, `${host}/contact`];
}

async function submitIndexNow() {
  const urlList = urlsFromSitemap();
  const body = {
    host: host.replace("https://", ""),
    key: apiKey,
    keyLocation: `${host}/${apiKey}.txt`,
    urlList,
  };

  console.log(`IndexNow: submitting ${urlList.length} URLs from sitemap`);

  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    console.log(`IndexNow response: ${res.status} ${res.statusText}`);
    if (!res.ok) {
      const text = await res.text();
      console.error(`IndexNow error body: ${text}`);
    }
  } catch (err) {
    console.error("IndexNow submission failed:", err);
  }
}

submitIndexNow();
