const { createClient } = require('@supabase/supabase-js');
const { Paynow } = require('paynow');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  try {
    const paynow = new Paynow(
      process.env.PAYNOW_INTEGRATION_ID,
      process.env.PAYNOW_INTEGRATION_KEY
    );

    // Parse Paynow webhook callback payload
    const status = paynow.parse(event.body);

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
        return { statusCode: 404, body: 'Payment record not found.' };
      }

      // 1. Grant subject access using the SQL function created in Step 1
      const { error: grantError } = await supabase.rpc('grant_subject_access', {
        p_user_id: paymentRecord.user_id,
        p_level: paymentRecord.level,
        p_subjects: paymentRecord.subjects
      });

      if (grantError) {
        console.error('Error granting subject access:', grantError);
        return { statusCode: 500, body: 'Error granting access.' };
      }

      // 2. Mark payment as completed
      await supabase
        .from('payments')
        .update({ status: 'completed' })
        .eq('id', paymentRecord.id);

      return { statusCode: 200, body: 'Access Granted Successfully' };
    }

    return { statusCode: 200, body: 'Payment not successful yet' };
  } catch (err) {
    console.error('Paynow Webhook Error:', err);
    return { statusCode: 500, body: err.message };
  }
};
