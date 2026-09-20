import { createServerFn } from "@tanstack/react-start";
import { db } from "./db";
import { z } from "zod";
import { sendPurchaseEvent } from "./meta-capi";

export const saveOrder = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    try {
      const schema = z.object({
        customerName: z.string().min(1),
        customerEmail: z.string().min(1),
        customerPhone: z.string().min(1),
        customerAddress: z.string().min(1),
        items: z.string().min(1),
        total: z.number(),
        instructions: z.string().optional().or(z.literal("")),
        trackingToken: z.string().optional().or(z.literal("")),
        event_id: z.string().optional().or(z.literal("")),
        client_user_agent: z.string().optional().or(z.literal("")),
        external_id: z.string().optional().or(z.literal("")),
        fbp: z.string().optional().or(z.literal("")),
        fbc: z.string().optional().or(z.literal("")),
      });

      const parsed = schema.parse(data);

      let salespersonId: string | null = null;
      if (parsed.trackingToken && parsed.trackingToken.trim().length > 0) {
        const sp = await db.salesperson.findFirst({
          where: { token: parsed.trackingToken, status: "active" },
          select: { id: true },
        });
        if (sp) salespersonId = sp.id;
      }

      const order = await db.order.create({
        data: {
          customerName: parsed.customerName,
          customerEmail: parsed.customerEmail,
          customerPhone: parsed.customerPhone,
          customerAddress: parsed.customerAddress,
          items: parsed.items,
          instructions: parsed.instructions || null,
          total: parsed.total,
          status: "pending",
          salespersonId,
          trackingToken: parsed.trackingToken || null,
        },
      });

      let orderItems: any[] = [];
      try {
        orderItems = JSON.parse(parsed.items);
      } catch {}

      const nameParts = parsed.customerName.trim().split(/\s+/);
      const firstName = nameParts[0] || "";
      const lastName = nameParts.slice(1).join(" ") || "";

      // Extract city from address: "123 Street, Leeds, LS1 1AA, UK" → "Leeds"
      const addressParts = parsed.customerAddress.split(",").map((s: string) => s.trim());
      // City is typically the second part (after street, before postcode)
      const city = addressParts.length >= 3 ? addressParts[1] : addressParts[1] || "";

      const postcodeMatch = parsed.customerAddress.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);

      // Fire Purchase CAPI event with full user data for maximum EMQ
      sendPurchaseEvent({
        data: {
          event_id: parsed.event_id || undefined,
          value: parsed.total,
          currency: "GBP",
          content_ids: orderItems.map((i: any) => i.id).filter(Boolean),
          content_type: "product",
          order_id: order.id,
          client_user_agent: parsed.client_user_agent || undefined,
          customer_email: parsed.customerEmail,
          customer_phone: parsed.customerPhone,
          customer_first_name: firstName,
          customer_last_name: lastName,
          customer_city: city || undefined,
          customer_postcode: postcodeMatch?.[1] || undefined,
          external_id: parsed.external_id || undefined,
          fbp: parsed.fbp || undefined,
          fbc: parsed.fbc || undefined,
        } as any,
      }).catch(() => {});

      return { success: true, orderId: order.id };
    } catch (err: any) {
      console.error("saveOrder error:", err?.message || err);
      return { success: false, error: err?.message || "unknown error" };
    }
  },
);

export const trackVisit = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    try {
      const schema = z.object({
        token: z.string().min(1),
        pageUrl: z.string().optional().or(z.literal("")),
        referrer: z.string().optional().or(z.literal("")),
      });

      const parsed = schema.parse(data);

      const sp = await db.salesperson.findFirst({
        where: { token: parsed.token, status: "active" },
        select: { id: true, token: true },
      });

      if (sp) {
        await db.siteVisit.create({
          data: {
            salespersonId: sp.id,
            token: sp.token,
            pageUrl: parsed.pageUrl || null,
            referrer: parsed.referrer || null,
            userAgent: null,
          },
        });
      }

      return { success: true, found: !!sp };
    } catch (err: any) {
      console.error("trackVisit error:", err?.message || err);
      return { success: false, error: err?.message || "unknown" };
    }
  },
);
