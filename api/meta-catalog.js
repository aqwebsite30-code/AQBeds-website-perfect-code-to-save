import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BASE_URL = "https://www.aqbeds.com";

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function formatPrice(price) {
  return price.toFixed(2) + " GBP";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method !== "GET") {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    // Query active products from database (stock > 0)
    const products = await prisma.product.findMany({
      where: {
        stock: { gt: 0 },
      },
      orderBy: { createdAt: "desc" },
      include: {
        images: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    // CSV header matching Meta Commerce Manager spec
    const headers = [
      "id",
      "title",
      "description",
      "availability",
      "condition",
      "price",
      "link",
      "image_link",
      "additional_image_link",
      "brand",
    ];

    const rows = products.map((p) => {
      const images = p.images.map((img) => {
        // Ensure absolute URL
        if (img.imageUrl.startsWith("http")) return img.imageUrl;
        return `${BASE_URL}${img.imageUrl}`;
      });

      const mainImage = images[0] || "";
      const additionalImages = images.slice(1, 11).join(","); // up to 10 additional

      const price = p.salePrice !== null && p.salePrice !== undefined ? p.salePrice : p.price;
      const availability = p.stock > 0 ? "in stock" : "out of stock";

      return [
        escapeCsv(p.slug),                    // id (slug matches content_ids in pixel events)
        escapeCsv(p.name),                    // title
        escapeCsv(p.description || ""),       // description
        escapeCsv(availability),              // availability
        escapeCsv("new"),                     // condition
        escapeCsv(formatPrice(price)),        // price
        escapeCsv(`${BASE_URL}/product/${p.slug}`), // link
        escapeCsv(mainImage),                 // image_link
        escapeCsv(additionalImages),          // additional_image_link
        escapeCsv("AQBeds"),                  // brand
      ];
    });

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800");
    res.statusCode = 200;
    return res.end(csv);
  } catch (err) {
    console.error("[meta-catalog] error:", err);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: "Failed to generate catalog" }));
  } finally {
    await prisma.$disconnect();
  }
}