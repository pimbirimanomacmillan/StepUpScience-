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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method Not Allowed" });

  try {
    const payload = JSON.parse(event.body || "{}");
    const { userId, subjectKey, amount, phone, studentEmail, studentName, method = "ecocash" } = payload;

    // Validation
    if (!userId) return json(400, { success: false, error: "Missing student user id." });
    if (!subjectKey) return json(400, { success: false, error: "Missing subject information." });
    if (!amount) return json(400, { success: false, error: "Missing subscription amount." });
    if (!phone) return json(400, { success: false, error: "Phone number is required." });

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
    paynow.returnUrl = `${siteUrl}/index.html?status=success&subject=${encodeURIComponent(subjectKey)}`;

    // Generate unique reference string based on subject key
    const cleanSubjectTag = subjectKey.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const reference = `STEPUP-${cleanSubjectTag}-${Date.now()}`;

    const payment = paynow.createPayment(reference, studentEmail || "student@stepupscience.com");
    payment.add(`StepUp Science Sub: ${subjectKey}`, Number(amount));

    // Send mobile payment prompt (EcoCash / OneMoney)
    const response = await paynow.sendMobile(payment, phone, String(method).toLowerCase());

    if (!response.success) {
      return json(400, { success: false, error: response.error || "Payment request failed." });
    }

    // Log pending purchase in subscriptions table
    await supabase.from("subscriptions").insert({
      student_id: userId,
      student_name: studentName || null,
      student_email: studentEmail || null,
      phone: phone,
      plan_code: subjectKey,
      tier: subjectKey,
      amount: Number(amount),
      status: "pending",
      paynow_ref: reference,
      poll_url: response.pollUrl || null
    });

    return json(200, {
      success: true,
      reference,
      pollUrl: response.pollUrl,
      subjectKey,
      amount
    });
  } catch (error) {
    return json(500, { success: false, error: error.message || "Unexpected payment error." });
  }
};
