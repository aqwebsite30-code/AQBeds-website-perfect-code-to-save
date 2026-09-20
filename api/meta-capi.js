import { createHash } from "crypto";

function sha256(value) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { event_name, event_time, event_id, user_data, custom_data, action_source, client_ip_address, client_user_agent } = req.body;

  if (!event_name) {
    return res.status(400).json({ error: "event_name is required" });
  }

  const PIXEL_ID = process.env.META_PIXEL_ID || "1109711544904339";
  const CAPI_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;

  if (!CAPI_TOKEN) {
    console.error("[CAPI] META_CAPI_ACCESS_TOKEN is not set — event dropped:", event_name);
    return res.status(500).json({ error: "CAPI token not configured" });
  }

  // Hash PII fields server-side
  const hashedUserData = {};
  if (user_data) {
    if (user_data.em) hashedUserData.em = sha256(user_data.em);
    if (user_data.ph) hashedUserData.ph = sha256(user_data.ph);
    if (user_data.fn) hashedUserData.fn = sha256(user_data.fn);
    if (user_data.ln) hashedUserData.ln = sha256(user_data.ln);
    if (user_data.ct) hashedUserData.ct = sha256(user_data.ct);
    if (user_data.zp) hashedUserData.zp = sha256(user_data.zp);
    if (user_data.external_id) hashedUserData.external_id = sha256(user_data.external_id);
    // fbp and fbc are NOT hashed — sent raw per Meta spec
    if (user_data.fbp) hashedUserData.fbp = user_data.fbp;
    if (user_data.fbc) hashedUserData.fbc = user_data.fbc;
  }

  // Append network params (unhashed)
  if (client_ip_address) hashedUserData.client_ip_address = client_ip_address;
  if (client_user_agent) hashedUserData.client_user_agent = client_user_agent;

  const body = {
    data: [
      {
        event_name,
        event_time: event_time || Math.floor(Date.now() / 1000),
        event_id: event_id || undefined,
        user_data: hashedUserData,
        custom_data: custom_data || {},
        action_source: action_source || "website",
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok) {
      console.error(`[CAPI] ${event_name} FAILED (${response.status}):`, JSON.stringify(result));
      return res.status(response.status).json({ error: result });
    }

    console.log(`[CAPI] ${event_name} sent OK — events_received: ${result.events_received}`);
    return res.status(200).json({ success: true, events_received: result.events_received });
  } catch (err) {
    console.error(`[CAPI] ${event_name} fetch error:`, err.message || err);
    return res.status(500).json({ error: err.message });
  }
}
