const { Paynow } = require("paynow");
const { createClient } = require("@supabase/supabase-js");

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type"
  },
  body: JSON.stringify(body)
});

const plans = {
  tier1: { amount: 5, tier: "Tier 1" },
  tier2: { amount: 10, tier: "Tier 2" }
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });

  try {
    const payload = JSON.parse(event.body || "{}");
    const selectedPlan = plans[payload.plan];
    if (!selectedPlan) return json(400, { success: false, error: "Invalid plan." });
    if (!payload.userId) return json(400, { success: false, error: "Missing student user id." });
    if (!payload.phone) return json(400, { success: false, error: "Phone number is required." });
    if (!process.env.PAYNOW_INTEGRATION_ID || !process.env.PAYNOW_INTEGRATION_KEY) {
      return json(500, { success: false, error: "Missing Paynow environment variables." });
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: "Missing Supabase environment variables." });
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const siteUrl = process.env.SITE_URL || "https://stepupscience.netlify.app";
    const paynow = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
    paynow.resultUrl = `${siteUrl}/.netlify/functions/paynow-webhook`;
    paynow.returnUrl = `${siteUrl}/index.html`;

    const reference = `STEPUP-${payload.plan.toUpperCase()}-${Date.now()}`;
    const payment = paynow.createPayment(reference, payload.studentEmail || "student@stepupscience.com");
    payment.add(`StepUp Science ${selectedPlan.tier} Subscription`, selectedPlan.amount);

    const method = String(payload.method || "ecocash").toLowerCase();
    const response = await paynow.sendMobile(payment, payload.phone, method);

    if (!response.success) {
      return json(400, { success: false, error: response.error || "Payment request failed." });
    }

    await supabase.from("subscriptions").insert({
      student_id: payload.userId,
      student_name: payload.studentName || null,
      student_email: payload.studentEmail || null,
      phone: payload.phone,
      plan_code: payload.plan,
      tier: selectedPlan.tier,
      amount: selectedPlan.amount,
      status: "pending",
      paynow_ref: reference,
      poll_url: response.pollUrl || null
    });

    await supabase.from("profiles").upsert({
      id: payload.userId,
      full_name: payload.studentName || null,
      phone: payload.phone,
      access_tier: "Free",
      role: "student"
    });

    return json(200, { success: true, reference, pollUrl: response.pollUrl, tier: selectedPlan.tier });
  } catch (error) {
    return json(500, { success: false, error: error.message || "Unexpected payment error." });
  }
};
