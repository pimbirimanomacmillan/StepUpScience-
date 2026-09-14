const { createClient } = require("@supabase/supabase-js");

const textResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "text/plain" },
  body
});

function parseBody(raw, headers = {}) {
  const contentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return JSON.parse(raw || "{}");
  }
  const params = new URLSearchParams(raw || "");
  return Object.fromEntries(params.entries());
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return textResponse(405, "Method Not Allowed");

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return textResponse(500, "Missing Supabase environment variables.");
    }

    const data = parseBody(event.body, event.headers);
    const reference = data.reference || data.merchantreference || data.merchantReference;
    const status = String(data.status || data.paynowstatus || "").toLowerCase();
    const paid = status.includes("paid") || status.includes("awaiting delivery") || status === "ok";

    if (!reference) return textResponse(400, "Missing reference.");

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("id, student_id, tier")
      .eq("paynow_ref", reference)
      .maybeSingle();

    if (error || !subscription) return textResponse(404, "Subscription not found.");

    await supabase.from("subscriptions").update({
      status: paid ? "active" : (status || "failed"),
      activated_at: paid ? new Date().toISOString() : null,
      raw_callback: data
    }).eq("id", subscription.id);

    if (paid) {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await supabase.from("profiles").upsert({
        id: subscription.student_id,
        access_tier: subscription.tier,
        access_expires_at: expiresAt,
        role: "student"
      });
    }

    return textResponse(200, "OK");
  } catch (error) {
    return textResponse(500, error.message || "Webhook error.");
  }
};
