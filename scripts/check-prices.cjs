const fs = require("fs");
const path = require("path");
const root = process.argv[2] || process.cwd();
const esbuild = require(path.join(root, "node_modules", "esbuild"));

const file = path.join(root, "src/features/products/data/products.ts");
const src = fs.readFileSync(file, "utf8");
const js = esbuild.transformSync(src, { loader: "ts", format: "cjs" }).code;

const dir = path.dirname(file);
const req = (spec) => {
  if (spec.startsWith(".")) {
    const full = require.resolve(path.resolve(dir, spec));
    return require(full);
  }
  return require(spec);
};

const mod = { exports: {} };
new Function("module", "exports", "require", "__dirname", "__filename", js)(
  mod,
  mod.exports,
  req,
  dir,
  file,
);

const PRODUCTS = mod.exports.PRODUCTS || [];
console.log("products:", PRODUCTS.length);

const SIZE_ORDER = [
  "2ft",
  "3ft",
  "4ft",
  "4'6ft",
  "5ft",
  "6ft",
  "Single",
  "Small Double",
  "Double",
  "King",
  "Super King",
];

let issues = 0;
for (const p of PRODUCTS) {
  const groups = { with: [], no: [], plain: [] };
  for (const s of p.sizes || []) {
    const n = s.name;
    if (/–\s*With Mattress$/i.test(n)) groups.with.push([n, s.extraPrice]);
    else if (/–\s*No Mattress$/i.test(n)) groups.no.push([n, s.extraPrice]);
    else groups.plain.push([n, s.extraPrice]);
  }
  for (const [gname, g] of Object.entries(groups)) {
    if (g.length < 2) continue;
    // extras must be non-decreasing along the size ladder
    for (let i = 1; i < g.length; i++) {
      if (g[i][1] < g[i - 1][1]) {
        console.log(
          `LADDER ${p.slug} [${gname}] ${g[i - 1][0]}(${g[i - 1][1]}) -> ${g[i][0]}(${g[i][1]})`,
        );
        issues++;
      }
    }
  }
  // every size total must be positive
  for (const s of p.sizes || []) {
    if (p.basePrice + s.extraPrice <= 0) {
      console.log(`PRICE<=0 ${p.slug} ${s.name} -> ${p.basePrice + s.extraPrice}`);
      issues++;
    }
  }
  // original price must be strictly above base (or absent)
  if (p.originalPrice != null && p.originalPrice <= p.basePrice) {
    console.log(`WASPRICE ${p.slug} base=${p.basePrice} was=${p.originalPrice}`);
    issues++;
  }
  // discount percent <= 32
  if (p.originalPrice) {
    const pct = Math.round((1 - p.basePrice / p.originalPrice) * 100);
    if (pct > 32) {
      console.log(`DISCOUNT>32 ${p.slug} ${pct}%`);
      issues++;
    }
  }
}
console.log(`\nissues: ${issues}`);
