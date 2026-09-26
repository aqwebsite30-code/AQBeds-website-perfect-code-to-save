import { createServerFn } from "@tanstack/react-start";
import { db } from "./db";
import { PRODUCTS } from "../features/products/data/products";
import { verifyAuth, unauthorized } from "./auth";

type FnOpts = { data?: { token?: string } };

export const seedDatabase = createServerFn({ method: "POST" }).handler(async (opts?: FnOpts) => {
  try {
    // 1. Create Admin User
    const adminEmail = process.env.ADMIN_EMAIL || "admin@aqbeds.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "123";

    const existingAdmin = await db.adminUser.findUnique({ where: { email: adminEmail } });

    // Seeding an existing install is an admin-only action; a fresh database may
    // bootstrap its first admin without one (otherwise the door locks forever).
    if (existingAdmin && !(await verifyAuth(opts?.data?.token))) return unauthorized;

    if (!existingAdmin) {
      // dynamic import bcrypt
      const bcrypt = await import("bcryptjs");
      const salt = await bcrypt.default.genSalt(10);
      const hashed = await bcrypt.default.hash(adminPassword, salt);

      await db.adminUser.create({
        data: {
          email: adminEmail,
          password: hashed,
          role: "admin",
        },
      });
    }

    // 2. Transfer hardcoded PRODUCTS to Database if Product table is empty
    const productCount = await db.product.count();
    if (productCount === 0) {
      for (const p of PRODUCTS) {
        const createdProduct = await db.product.create({
          data: {
            name: p.name,
            slug: p.slug,
            description: p.description,
            price: p.basePrice,
            salePrice: p.onSale ? p.originalPrice : null,
            category: p.category,
            stock: p.stock,
            rating: p.rating,
            featured: p.onSale, // quick mapping
            sku: `AQ-${p.id.toUpperCase()}`,
          },
        });

        // Images
        await db.productImage.createMany({
          data: p.images.map((img, idx) => ({
            productId: createdProduct.id,
            imageUrl: img,
            sortOrder: idx,
          })),
        });

        // Variants (Simplified for demo)
        await db.productVariant.createMany({
          data: p.sizes.map((s) => ({
            productId: createdProduct.id,
            size: s.name,
            priceModifier: s.extraPrice,
          })),
        });
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error(err);
    return { success: false, error: err.message };
  }
});
