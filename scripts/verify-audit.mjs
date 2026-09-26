// AQ Beds audit verification suite (Phase 1 + Phase 2)
// Run: node scripts/verify-audit.mjs   (dev server must be up on PORT, default 5199)
// Playwright is resolved from the local install or the omniroute global install.
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } =
    await import("file:///C:/Users/abdulraheem%20bulbul/AppData/Roaming/npm/node_modules/omniroute/node_modules/playwright/index.mjs"));
}

const BASE = process.env.AQ_BASE || "http://localhost:5199";
const results = [];
const check = (page, name, ok, extra = "") => {
  results.push({ page, name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"} [${page}] ${name}${extra ? " :: " + extra : ""}`);
};

const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

async function go(path) {
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
}

// ── HOME ──
await go("/");
const homeTitle = await page.title();
check("/", "title has no 50% OFF", !/50%/.test(homeTitle), homeTitle);
const homeBody = await page.locator("body").innerText();
// §4.2 intends ONE site-level aggregate on the homepage testimonials block, derived from
// the shared testimonial data (WP-G: no invented "128 reviews"); per-product badges stay gone
const aggMatches = homeBody.match(/[\d.]+\/5 from \d+ reviews/g) || [];
check(
  "/",
  "§4.2 aggregate in testimonials block",
  aggMatches.length >= 1,
  JSON.stringify(aggMatches),
);
check("/", "aggregate appears exactly once", aggMatches.length === 1, `count=${aggMatches.length}`);
check("/", "no invented '128 reviews'", !/128 reviews/.test(homeBody), "");
check("/", "no 'In stock (24)'", !homeBody.includes("In stock (24)"), "");
check("/", "no fabricated sales ticker", !/just\s+bought a/i.test(homeBody), "");
check(
  "/",
  "H1 present",
  (await page.locator("h1").count()) > 0,
  await page.locator("h1").first().innerText(),
);
check("/", "no 50% OFF in body", !homeBody.includes("50% OFF"), "");
check("/", "announces trust bar", homeBody.includes("30-Day Returns"), "");
const homeCanonical = await page
  .locator('link[rel="canonical"]')
  .getAttribute("href")
  .catch(() => null);
check("/", "canonical set", !!homeCanonical, String(homeCanonical));
const ld = await page.locator('script[type="application/ld+json"]').allInnerTexts();
check("/", "JSON-LD has no aqbeds.vercel.app", !ld.join("").includes("aqbeds.vercel.app"), "");

// ── CATEGORY ──
await go("/category/ottoman-beds");
const catBody = await page.locator("body").innerText();
check("/category/ottoman-beds", "pluralisation '1 bed'", !catBody.includes("1 products"), "");
const catH1 = await page.locator("h1").first().innerText();
check("/category/ottoman-beds", "H1 = category name", catH1.trim() === "Ottoman Beds", catH1);
const catDesc = await page
  .locator('meta[name="description"]')
  .getAttribute("content")
  .catch(() => "");
check(
  "/category/ottoman-beds",
  "long meta description",
  catDesc.length > 80,
  `${catDesc.length}ch`,
);

// empty category must be noindexed
await go("/category/mattresses");
const robots = await page
  .locator('meta[name="robots"]')
  .getAttribute("content")
  .catch(() => null);
check(
  "/category/mattresses",
  "noindex on empty category",
  /noindex/.test(robots || ""),
  String(robots),
);

// ── PDP ──
await go("/product/divan-ottoman-bed");
const pdpBody = await page.locator("body").innerText();
check(
  "/product/divan-ottoman-bed",
  "no fake rating badge",
  !/4\.7\s*[★⭐]|128 reviews/i.test(pdpBody),
  "",
);
check("/product/divan-ottoman-bed", "honest stock copy", pdpBody.includes("dispatches"), "");
check("/product/divan-ottoman-bed", "no '(Included) +£'", !/\(Included\)\s*\+£/i.test(pdpBody), "");
const pdpLd = await page.locator('script[type="application/ld+json"]').allInnerTexts();
check(
  "/product/divan-ottoman-bed",
  "Product JSON-LD domain",
  !pdpLd.join("").includes("aqbeds.vercel.app"),
  "",
);
const pdpCanonical = await page
  .locator('link[rel="canonical"]')
  .getAttribute("href")
  .catch(() => null);
check(
  "/product/divan-ottoman-bed",
  "PDP canonical",
  String(pdpCanonical).includes("/product/"),
  String(pdpCanonical),
);
const productLd = pdpLd
  .map((t) => {
    try {
      return JSON.parse(t);
    } catch {
      return null;
    }
  })
  .find((j) => j && j["@type"] === "Product");
check(
  "/product/divan-ottoman-bed",
  "Product schema has NO fake aggregateRating",
  !(productLd && productLd.aggregateRating),
  JSON.stringify(productLd?.aggregateRating || null),
);

// sticky mobile bar (mobile viewport)
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(BASE + "/product/divan-ottoman-bed", { waitUntil: "networkidle" });
await m.waitForTimeout(1500);
const sticky = await m.locator('button:has-text("Add To Basket")').count();
check("mobile-pdp", "sticky Add To Basket exists", sticky >= 1, `count=${sticky}`);

// ── SHOP CARDS ──
await go("/shop");
const shopBody = await page.locator("body").innerText();
check("/shop", "no per-card review badge", !/4\.7\s*[★⭐]|128 reviews/i.test(shopBody), "");
check("/shop", "no 'In stock (24)'", !shopBody.includes("In stock (24)"), "");

// ── NEW PAGES ──
for (const p of ["/privacy", "/terms", "/delivery", "/returns", "/faqs", "/shop"]) {
  const r = await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
  const body = await page.locator("body").innerText();
  check(
    p,
    "status 200 + rendered",
    r.status() === 200 && body.length > 200,
    `status=${r.status()} len=${body.length}`,
  );
}
await go("/returns");
const ret = await page.locator("body").innerText();
// refund may be processed in 14 days; the *notify* window must be 30 days (audit 3.6)
check("/returns", "notify window is 30 days", /within 30 days of delivery/i.test(ret), "");
check(
  "/returns",
  "no 14-day notify rule",
  !/contact[^.]{0,60}within 14 days|within 14 days of delivery/i.test(ret),
  "",
);
await go("/delivery");
const dlv = await page.locator("body").innerText();
check("/delivery", "no curbside contradiction", !/curbside/i.test(dlv), "");
await go("/faqs");
const faq = await page.locator("body").innerText();
check("/faqs", "no 14-day contradiction", !/within 14 days/i.test(faq), "");

// ── FOOTER LINKS ──
await go("/");
const privHref = await page
  .locator('footer a:has-text("Privacy Policy")')
  .getAttribute("href")
  .catch(() => null);
const termsHref = await page
  .locator('footer a:has-text("Terms of Service")')
  .getAttribute("href")
  .catch(() => null);
check("/", "footer -> /privacy", privHref === "/privacy", String(privHref));
check("/", "footer -> /terms", termsHref === "/terms", String(termsHref));
const deadSocial = await page.locator('footer a[href="#"]').count();
check("/", "no dead # social links", deadSocial === 0, `count=${deadSocial}`);

// ── NAV ──
const navText = await page
  .locator("nav")
  .first()
  .innerText()
  .catch(() => "");
check("/", "nav has Sofas", /Sofas/i.test(navText), navText.replace(/\n/g, " | ").slice(0, 160));
check("/", "nav has no empty Storage Beds", !/Storage Beds/i.test(navText), "");

// ── H1 uniqueness ──
const h1count = await page.locator("h1").count();
check("/", "exactly one H1", h1count === 1, `count=${h1count}`);

// ==================== PHASE 2 CHECKS ====================
await go("/");
const p2Home = await page.locator("body").innerText();
check("/", "dynamic 'Shop All 7 Categories'", /Shop All 7 Categories/.test(p2Home), "");
const skipLink = await page.locator('a[href="#main-content"]').count();
check("/", "skip link present", skipLink >= 1, `count=${skipLink}`);
const srcsets = await page.locator("img[srcset]").count();
check("/", "srcset images on home", srcsets >= 3, `count=${srcsets}`);
const revHref = await page
  .locator('footer a:has-text("Customer Reviews")')
  .getAttribute("href")
  .catch(() => null);
check("/", "footer -> /reviews", revHref === "/reviews", String(revHref));

await go("/faqs");
const faqLd2 = await page.locator('script[type="application/ld+json"]').allInnerTexts();
let faqPageOk = false;
for (const raw of faqLd2) {
  try {
    const j = JSON.parse(raw);
    if (j && j["@type"] === "FAQPage") faqPageOk = true;
  } catch {}
}
check("/faqs", "FAQPage JSON-LD present", faqPageOk, "");

await go("/category/wardrobes");
const wBody = await page.locator("body").innerText();
check(
  "/category/wardrobes",
  "noun count '1 wardrobe'",
  /1 wardrobe/.test(wBody) && !/1 products/.test(wBody),
  "",
);

await go("/category/sofas");
const sBody = await page.locator("body").innerText();
check(
  "/category/sofas",
  "noun count '15 sofas'",
  /15 sofas/.test(sBody) && !/15 products/.test(sBody),
  "",
);

await go("/shop");
const shopTitle2 = await page.title();
check("/shop", "shop title", /Shop Beds, Sofas/.test(shopTitle2), shopTitle2);
const shopLinks = await page.locator('a[href^="/product/"]').count();
check("/shop", "shop shows 32 products", shopLinks === 32, `count=${shopLinks}`);
const shopBody2 = await page.locator("body").innerText();
check(
  "/shop",
  "sentence-case facet counts",
  /Sofas \(15\)/.test(shopBody2) && /Luxury beds \(12\)/.test(shopBody2),
  "",
);
check(
  "/shop",
  "Size facet split from Mattress",
  /Mattress/i.test(shopBody2) && /No mattress/.test(shopBody2),
  "",
);
check(
  "/shop",
  "size facet has no wardrobe door names",
  !/Door Plain Wardrobe|Sliding Wardrobe$/.test(shopBody2),
  "",
);
const sizeGuideLink = await page.locator('a[href="/size-guide"]').count();
check("/shop", "size guide link on shop", sizeGuideLink >= 1, `count=${sizeGuideLink}`);

for (const p of ["/size-guide", "/reviews", "/about"]) {
  const r = await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  const h = await page
    .locator("h1")
    .first()
    .innerText()
    .catch(() => "");
  check(
    p,
    "200 + H1",
    r.status() === 200 && h.trim().length > 0,
    `status=${r.status()} h1=${h.slice(0, 60)}`,
  );
}
await go("/reviews");
const revBody = await page.locator("body").innerText();
check(
  "/reviews",
  "reviews page honest (no verified-purchase claim)",
  !/verified purchase/i.test(revBody),
  "",
);

await go("/");
const emptyAnchors = await page.locator('a[href="#"]').count();
check("/", "no dead # anchors anywhere", emptyAnchors === 0, `count=${emptyAnchors}`);

// ==================== BUYING GUIDE (7.3) ====================
await go("/guides/ottoman-vs-divan");
const gH1 = await page
  .locator("h1")
  .first()
  .innerText()
  .catch(() => "");
check("/guides/ottoman-vs-divan", "200 + H1", gH1.trim().length > 0, gH1.slice(0, 60));
const gLd = await page.locator('script[type="application/ld+json"]').allInnerTexts();
let gFaq = false;
for (const raw of gLd) {
  try {
    const j = JSON.parse(raw);
    if (j && j["@type"] === "FAQPage") gFaq = true;
  } catch {}
}
check("/guides/ottoman-vs-divan", "FAQPage schema", gFaq, "");
const gBody = await page.locator("body").innerText();
check(
  "/guides/ottoman-vs-divan",
  "comparison table rows",
  /Gas-lift|gas struts/i.test(gBody) && /Drawers/i.test(gBody),
  "",
);
const gCats = await page
  .locator('a[href="/category/ottoman-beds"], a[href="/category/divan-beds"]')
  .count();
check("/guides/ottoman-vs-divan", "links to both categories", gCats >= 2, `count=${gCats}`);

await go("/category/ottoman-beds");
const gLink = await page.locator('a[href="/guides/ottoman-vs-divan"]').count();
check("/category/ottoman-beds", "interlink to guide", gLink >= 1, `count=${gLink}`);
await go("/category/divan-beds");
const gLink2 = await page.locator('a[href="/guides/ottoman-vs-divan"]').count();
check("/category/divan-beds", "interlink to guide", gLink2 >= 1, `count=${gLink2}`);

// ==================== PHASE 2 EXTRA CHECKS ====================
// ---- §6.8.2 search quality ----
for (const q of ["velvet", "king size", "sofa"]) {
  await page.goto(`${BASE}/shop?q=${encodeURIComponent(q)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const cards = await page.locator('a[href^="/product/"]').count();
  const body = await page.locator("body").innerText();
  const noResults = /No products found/i.test(body);
  check(
    "/shop",
    `search "${q}" returns results`,
    cards > 0,
    `cards=${cards} noResults=${noResults}`,
  );
}

// empty state
await page.goto(`${BASE}/shop?q=zzzznotarealproduct`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const emptyBody = await page.locator("body").innerText();
check(
  "/shop",
  "empty state wording",
  /No products found/i.test(emptyBody) && /Show all products/i.test(emptyBody),
  "",
);

// ---- §6.8.4 budget slider floor must include the £185 bed ----
await page.goto(`${BASE}/shop`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const shopBodyX = await page.locator("body").innerText();
check(
  "/shop",
  "budget floor <= £185",
  /£150/.test(shopBodyX),
  shopBodyX.match(/£\d+/g)?.slice(0, 6).join(","),
);

// ---- §6.6 alt text sweep ----
const PAGES = [
  "/",
  "/shop",
  "/category/ottoman-beds",
  "/product/divan-ottoman-bed",
  "/about",
  "/size-guide",
  "/guides/ottoman-vs-divan",
];
for (const p of PAGES) {
  await page.goto(BASE + p, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const noAlt = await page.locator("img:not([alt])").count();
  const imgs = await page.locator("img").count();
  const emptyAlt = await page.locator('img[alt=""]').count();
  check(
    p,
    "every img has alt attribute",
    noAlt === 0,
    `no-alt=${noAlt} total=${imgs} decorative-empty=${emptyAlt}`,
  );
}

// ---- keyboard: skip link reachable as first Tab ----
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.keyboard.press("Tab");
const focused = await page.evaluate(() => {
  const el = document.activeElement;
  return {
    tag: el?.tagName,
    text: el?.textContent?.trim(),
    visible: !!el && el.getBoundingClientRect().width > 0,
  };
});
check(
  "/",
  "first Tab = visible skip link",
  focused.text === "Skip to main content" && focused.visible,
  JSON.stringify(focused),
);

console.log("\n--- console errors ---");
console.log(errors.length ? errors.slice(0, 12).join("\n") : "(none)");
const fails = results.filter((r) => !r.ok);
console.log(
  `\n=== ${results.length - fails.length}/${results.length} PASS, ${fails.length} FAIL ===`,
);
if (fails.length)
  console.log("FAILURES:\n" + fails.map((f) => ` - [${f.page}] ${f.name} ${f.extra}`).join("\n"));

await browser.close();
process.exit(fails.length ? 1 : 0);
