const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  try {
    const params = new URLSearchParams(event.body || "");
    const reference = params.get("reference");
    const status = params.get("status");

    if (!reference) {
      return { statusCode: 400, body: "Missing reference" };
    }

    const isPaid = status && (status.toLowerCase() === "paid" || status.toLowerCase() === "awaiting delivery");

    if (isPaid) {
      // 1. Check if reference belongs to a Session Booking
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, slot_id")
        .eq("paynow_ref", reference)
        .maybeSingle();

      if (booking) {
        // Mark booking as confirmed
        await supabase.from("bookings").update({ status: "confirmed" }).eq("id", booking.id);

        // Fetch current slot capacity & increment count
        const { data: slot } = await supabase
          .from("booking_slots")
          .select("booked_count")
          .eq("id", booking.slot_id)
          .single();

        if (slot) {
          await supabase.from("booking_slots")
            .update({ booked_count: (slot.booked_count || 0) + 1 })
            .eq("id", booking.slot_id);
        }

        return { statusCode: 200, body: "Booking confirmed" };
      }

      // 2. Otherwise handle Subject Subscription fulfillment
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("student_id, plan_code")
        .eq("paynow_ref", reference)
        .maybeSingle();

      if (sub) {
        await supabase.from("subscriptions").update({ status: "active" }).eq("paynow_ref", reference);

        const { data: profile } = await supabase
          .from("profiles")
          .select("subscribed_subjects")
          .eq("id", sub.student_id)
          .single();

        let currentSubjects = profile?.subscribed_subjects || [];
        if (!Array.isArray(currentSubjects)) currentSubjects = [];

        if (!currentSubjects.includes(sub.plan_code)) {
          currentSubjects.push(sub.plan_code);
          await supabase
            .from("profiles")
            .update({ subscribed_subjects: currentSubjects })
            .eq("id", sub.student_id);
        }

        return { statusCode: 200, body: "Subscription active" };
      }
    }

    return { statusCode: 200, body: "Webhook processed" };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
