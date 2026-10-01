const { createClient } = require("@supabase/supabase-js");
const { Paynow } = require("paynow");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const { userId, subjectKey, slotId, slotTitle, amount, phone, studentEmail, studentName, method = "ecocash" } = payload;

    if (!userId || !phone || !amount) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields." }) };
    }

    const paynow = new Paynow(
      process.env.PAYNOW_INTEGRATION_ID,
      process.env.PAYNOW_INTEGRATION_KEY
    );

    paynow.resultUrl = `${process.env.URL}/.netlify/functions/paynow-webhook`;
    paynow.returnUrl = process.env.URL;

    // Distinguish between Slot Booking and Subject Subscription
    const isBooking = Boolean(slotId);
    const itemDescription = isBooking 
      ? `StepUp Booking: ${slotTitle || 'Tutoring Session'}`
      : `StepUp Sub: ${subjectKey}`;

    const referenceTag = isBooking ? 'BOOK' : String(subjectKey).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const reference = `STEPUP-${referenceTag}-${Date.now()}`;

    const payment = paynow.createPayment(reference, studentEmail || "student@stepupscience.com");
    payment.add(itemDescription, Number(amount));

    const response = await paynow.sendMobile(payment, phone.trim(), String(method).toLowerCase());

    if (!response.success) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: response.error }) };
    }

    // Insert pending transaction record
    if (isBooking) {
      await supabase.from("bookings").insert({
        slot_id: slotId,
        student_id: userId,
        student_name: studentName || "Student",
        phone: phone.trim(),
        amount: Number(amount),
        status: "pending",
        paynow_ref: reference
      });
    } else {
      await supabase.from("subscriptions").insert({
        student_id: userId,
        student_name: studentName || "Student",
        student_email: studentEmail,
        phone: phone.trim(),
        plan_code: subjectKey,
        tier: subjectKey,
        amount: Number(amount),
        status: "pending",
        paynow_ref: reference,
        poll_url: response.pollUrl || null
      });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, reference, pollUrl: response.pollUrl })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
