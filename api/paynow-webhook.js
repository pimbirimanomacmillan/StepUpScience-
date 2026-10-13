import { createClient } from '@supabase/supabase-js';
import { Paynow } from 'paynow';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const paynow = new Paynow(
      process.env.PAYNOW_INTEGRATION_ID,
      process.env.PAYNOW_INTEGRATION_KEY
    );

    // Parse Paynow webhook callback payload (req.body or raw body depending on Vercel parsing)
    // Note: Vercel automatically parses JSON bodies, but Paynow's parse method accepts a query string or object.
    // If req.body is already an object, convert it or pass it correctly:
    const rawBody = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body).toString();
    const status = paynow.parse(rawBody);

    if (status.paid) {
      const pollUrl = status.pollUrl;

      // Find the pending transaction matching this poll URL
      const { data: paymentRecord, error: findError } = await supabase
        .from('payments')
        .select('*')
        .eq('paynow_reference', pollUrl)
        .single();

      if (findError || !paymentRecord) {
        console.error('Payment record not found for poll URL:', pollUrl);
        return res.status(404).send('Payment record not found.');
      }

      // 1. Grant subject access using the SQL function
      const { error: grantError } = await supabase.rpc('grant_subject_access', {
        p_user_id: paymentRecord.user_id,
        p_level: paymentRecord.level,
        p_subjects: paymentRecord.subjects
      });

      if (grantError) {
        console.error('Error granting subject access:', grantError);
        return res.status(500).send('Error granting access.');
      }

      // 2. Mark payment as completed
      await supabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', paymentRecord.id);

      return res.status(200).send('Access Granted Successfully');
    }

    return res.status(200).send('Payment not successful yet');
  } catch (err) {
    console.error('Paynow Webhook Error:', err);
    return res.status(500).send(err.message);
  }
}
