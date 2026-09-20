import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "crypto";

const PIXEL_ID = process.env.META_PIXEL_ID || "1109711544904339";
const CAPI_URL = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`;
const CAPI_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

/**
 * SHA-256 hash for PII fields. Normalizes: trim → lowercase → SHA-256.
 * Meta requires this for all user data parameters.
 */
function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

/**
 * Build the user_data object with all available PII hashed.
 * Includes external_id for cross-device matching.
 * All fields: em, ph, fn, ln, ct, zp, external_id, fbp, fbc.
 */
function hashUserData(data: {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  city?: string;
  postcode?: string;
  external_id?: string;
  fbp?: string;
  fbc?: string;
}) {
  const user_data: Record<string, string> = {};
  if (data.email) user_data.em = sha256(data.email);
  if (data.phone) user_data.ph = sha256(data.phone);
  if (data.first_name) user_data.fn = sha256(data.first_name);
  if (data.last_name) user_data.ln = sha256(data.last_name);
  if (data.city) user_data.ct = sha256(data.city);
  if (data.postcode) user_data.zp = sha256(data.postcode);
  if (data.external_id) user_data.external_id = sha256(data.external_id);
  // fbp and fbc are NOT hashed — sent raw per Meta spec
  if (data.fbp) user_data.fbp = data.fbp;
  if (data.fbc) user_data.fbc = data.fbc;
  return user_data;
}

/**
 * Extract client IP from multiple sources (Vercel/serverless).
 * Tries x-forwarded-for first, then x-real-ip, then falls back to undefined.
 */
function getClientIp(): string | undefined {
  try {
    // Method 1: TanStack Start request context
    const headers = (globalThis as any).__TANSTACK_START_REQUEST__?.headers;
    if (headers) {
      const forwarded = headers.get("x-forwarded-for");
      if (forwarded) return forwarded.split(",")[0].trim();
      const realIp = headers.get("x-real-ip");
      if (realIp) return realIp;
    }
  } catch {}

  try {
    // Method 2: Check common serverless env headers
    const req = (globalThis as any).__SERVER_REQUEST__;
    if (req?.headers) {
      const forwarded = req.headers["x-forwarded-for"];
      if (forwarded) return String(forwarded).split(",")[0].trim();
      const realIp = req.headers["x-real-ip"];
      if (realIp) return String(realIp);
    }
  } catch {}

  return undefined;
}

/**
 * Send event to Meta Conversions API (Graph API v21.0).
 * Silently fails — never crashes order processing.
 */
async function sendCAPIEvent(payload: {
  event_name: string;
  event_time: number;
  event_id?: string;
  user_data: Record<string, string>;
  client_ip_address?: string;
  client_user_agent?: string;
  custom_data?: Record<string, any>;
  action_source: string;
}) {
  if (!CAPI_TOKEN) {
    console.error("[CAPI] META_CAPI_ACCESS_TOKEN is not set — event dropped:", payload.event_name);
    return;
  }

  const body = {
    data: [
      {
        event_name: payload.event_name,
        event_time: payload.event_time,
        event_id: payload.event_id,
        user_data: {
          ...payload.user_data,
          ...(payload.client_ip_address && { client_ip_address: payload.client_ip_address }),
          ...(payload.client_user_agent && { client_user_agent: payload.client_user_agent }),
        },
        custom_data: payload.custom_data,
        action_source: payload.action_source,
      },
    ],
  };

  try {
    const url = `${CAPI_URL}?access_token=${CAPI_TOKEN}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) {
      console.error(`[CAPI] ${payload.event_name} failed:`, JSON.stringify(result));
    } else {
      console.log(`[CAPI] ${payload.event_name} sent successfully`);
    }
    return result;
  } catch (err: any) {
    console.error(`[CAPI] ${payload.event_name} request failed:`, err?.message || err);
  }
}

// ─── Server Functions ────────────────────────────────────────────────────────

export const sendAddToCartEvent = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    try {
      const schema = z.object({
        event_id: z.string().optional(),
        content_ids: z.array(z.string()),
        content_name: z.string(),
        content_type: z.string(),
        value: z.number(),
        currency: z.literal("GBP"),
        client_user_agent: z.string().optional(),
        customer_email: z.string().optional(),
        customer_phone: z.string().optional(),
        customer_first_name: z.string().optional(),
        customer_last_name: z.string().optional(),
        customer_city: z.string().optional(),
        customer_postcode: z.string().optional(),
        external_id: z.string().optional(),
        fbp: z.string().optional(),
        fbc: z.string().optional(),
      });

      const parsed = schema.parse(data);

      const user_data = hashUserData({
        email: parsed.customer_email,
        phone: parsed.customer_phone,
        first_name: parsed.customer_first_name,
        last_name: parsed.customer_last_name,
        city: parsed.customer_city,
        postcode: parsed.customer_postcode,
        external_id: parsed.external_id,
        fbp: parsed.fbp,
        fbc: parsed.fbc,
      });

      await sendCAPIEvent({
        event_name: "AddToCart",
        event_time: Math.floor(Date.now() / 1000),
        event_id: parsed.event_id,
        user_data,
        client_ip_address: getClientIp(),
        client_user_agent: parsed.client_user_agent,
        action_source: "website",
        custom_data: {
          content_ids: parsed.content_ids,
          content_name: parsed.content_name,
          content_type: parsed.content_type,
          value: parsed.value,
          currency: parsed.currency,
        },
      });

      return { success: true };
    } catch (err: any) {
      console.error("sendAddToCartEvent error:", err?.message || err);
      return { success: false, error: err?.message };
    }
  },
);

export const sendInitiateCheckoutEvent = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    try {
      const schema = z.object({
        event_id: z.string().optional(),
        value: z.number(),
        currency: z.literal("GBP"),
        num_items: z.number(),
        client_user_agent: z.string().optional(),
        customer_email: z.string().optional(),
        customer_phone: z.string().optional(),
        customer_first_name: z.string().optional(),
        customer_last_name: z.string().optional(),
        customer_city: z.string().optional(),
        customer_postcode: z.string().optional(),
        external_id: z.string().optional(),
        fbp: z.string().optional(),
        fbc: z.string().optional(),
      });

      const parsed = schema.parse(data);

      const user_data = hashUserData({
        email: parsed.customer_email,
        phone: parsed.customer_phone,
        first_name: parsed.customer_first_name,
        last_name: parsed.customer_last_name,
        city: parsed.customer_city,
        postcode: parsed.customer_postcode,
        external_id: parsed.external_id,
        fbp: parsed.fbp,
        fbc: parsed.fbc,
      });

      await sendCAPIEvent({
        event_name: "InitiateCheckout",
        event_time: Math.floor(Date.now() / 1000),
        event_id: parsed.event_id,
        user_data,
        client_ip_address: getClientIp(),
        client_user_agent: parsed.client_user_agent,
        action_source: "website",
        custom_data: {
          value: parsed.value,
          currency: parsed.currency,
          num_items: parsed.num_items,
        },
      });

      return { success: true };
    } catch (err: any) {
      console.error("sendInitiateCheckoutEvent error:", err?.message || err);
      return { success: false, error: err?.message };
    }
  },
);

export const sendPurchaseEvent = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: any }) => {
    try {
      const schema = z.object({
        event_id: z.string().optional(),
        value: z.number(),
        currency: z.literal("GBP"),
        content_ids: z.array(z.string()),
        content_type: z.string(),
        order_id: z.string(),
        client_user_agent: z.string().optional(),
        customer_email: z.string().optional(),
        customer_phone: z.string().optional(),
        customer_first_name: z.string().optional(),
        customer_last_name: z.string().optional(),
        customer_city: z.string().optional(),
        customer_postcode: z.string().optional(),
        external_id: z.string().optional(),
        fbp: z.string().optional(),
        fbc: z.string().optional(),
      });

      const parsed = schema.parse(data);

      const user_data = hashUserData({
        email: parsed.customer_email,
        phone: parsed.customer_phone,
        first_name: parsed.customer_first_name,
        last_name: parsed.customer_last_name,
        city: parsed.customer_city,
        postcode: parsed.customer_postcode,
        external_id: parsed.external_id,
        fbp: parsed.fbp,
        fbc: parsed.fbc,
      });

      await sendCAPIEvent({
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: parsed.event_id,
        user_data,
        client_ip_address: getClientIp(),
        client_user_agent: parsed.client_user_agent,
        action_source: "website",
        custom_data: {
          content_ids: parsed.content_ids,
          content_type: parsed.content_type,
          value: parsed.value,
          currency: parsed.currency,
          order_id: parsed.order_id,
        },
      });

      return { success: true };
    } catch (err: any) {
      console.error("sendPurchaseEvent error:", err?.message || err);
      return { success: false, error: err?.message };
    }
  },
);
