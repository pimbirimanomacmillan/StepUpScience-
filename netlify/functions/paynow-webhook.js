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

    // 1. Fetch subscription matching the Paynow reference
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("id, student_id, tier")
      .eq("paynow_ref", reference)
      .maybeSingle();

    if (error || !subscription) return textResponse(404, "Subscription record not found.");

    // 2. Update subscription status log
    await supabase.from("subscriptions").update({
      status: paid ? "active" : (status || "failed"),
      activated_at: paid ? new Date().toISOString() : null,
      raw_callback: data
    }).eq("id", subscription.id);

    // 3. Grant access upon successful payment
    if (paid) {
      const subjectKey = subscription.tier; // Contains level + subject (e.g. "O-Level Physics")

      // Fetch existing profile to preserve other unlocked subjects
      const { data: profile } = await supabase
        .from("profiles")
        .select("subscribed_subjects")
        .eq("id", subscription.student_id)
        .maybeSingle();

      const currentSubs = profile?.subscribed_subjects || [];

      // Append subject if not already in array
      if (!currentSubs.includes(subjectKey)) {
        const updatedSubs = [...currentSubs, subjectKey];

        await supabase.from("profiles").update({
          subscribed_subjects: updatedSubs,
          access_tier: "Subscriber"
        }).eq("id", subscription.student_id);
      }
    }

    return textResponse(200, "OK");
  } catch (error) {
    return textResponse(500, error.message || "Webhook error.");
  }
};
