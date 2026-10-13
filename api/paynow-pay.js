import { createClient } from '@supabase/supabase-js';
import { Paynow } from 'paynow';

// Initialize Supabase admin client using service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Price calculation helper for server-side verification
function calculateExpectedPrice(level, subjects) {
  const isDual = subjects.includes('Physics') && subjects.includes('Chemistry');
  if (level === 'O-Level') return isDual ? 5 : 3;
  if (level === 'A-Level') return isDual ? 8 : 5;
  return 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { userId, email, level, subjects, amount, phone, method } = req.body;

    if (!userId || !email || !level || !subjects || subjects.length === 0) {
      return res.status(400).json({ error: 'Missing required parameters.' });
    }

    // Server-side price check to prevent tampering
    const expectedPrice = calculateExpectedPrice(level, subjects);
    if (Number(amount) !== expectedPrice) {
      return res.status(400).json({ error: 'Invalid price calculation.' });
    }

    // Initialize Paynow SDK
    const paynow = new Paynow(
      process.env.PAYNOW_INTEGRATION_ID,
      process.env.PAYNOW_INTEGRATION_KEY
    );

    // Vercel webhook and return URLs
    const baseUrl = `https://${req.headers.host}`;
    paynow.resultUrl = `${baseUrl}/api/paynow-webhook`;
    paynow.returnUrl = `${baseUrl}/`;

    const title = `${level} ${subjects.join(' + ')} Access`;
    const payment = paynow.createPayment(title, email);
    payment.add(title, expectedPrice);

    // Use sendMobile for EcoCash/OneMoney USSD push prompts, or regular send for web redirects
    let response;
    if (phone) {
      response = await paynow.sendMobile(payment, phone, method || 'ecocash');
    } else {
      response = await paynow.send(payment);
    }

    if (response.success) {
      // Record pending payment in Supabase
      const { error: dbError } = await supabase.from('subscriptions').insert({
        student_id: userId,
        level: level,
        subjects: subjects,
        amount_paid: expectedPrice,
        paynow_reference: response.pollUrl || response.notarizedReference || title,
        status: 'pending'
      });

      if (dbError) throw dbError;

      return res.status(200).json({
        success: true,
        redirectUrl: response.redirectUrl,
        pollUrl: response.pollUrl,
        instructions: response.instructions
      });
    } else {
      return res.status(400).json({ error: response.error || 'Failed to create Paynow transaction.' });
    }
  } catch (err) {
    console.error('Paynow Init Error:', err);
    return res.status(500).json({ error: err.message || 'Server error initiating payment.' });
  }
}
