const { createClient } = require('@supabase/supabase-js');
const { Paynow } = require('paynow');

// Initialize Supabase admin client using service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Price calculation helper for server-side verification
function calculateExpectedPrice(level, subjects) {
  const isDual = subjects.includes('physics') && subjects.includes('chemistry');
  if (level === 'O-Level') return isDual ? 5 : 3;
  if (level === 'A-Level') return isDual ? 8 : 5;
  return 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { userId, email, level, subjects, amount } = JSON.parse(event.body);

    if (!userId || !email || !level || !subjects || subjects.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required parameters.' }) };
    }

    // Server-side price check to prevent tampering
    const expectedPrice = calculateExpectedPrice(level, subjects);
    if (Number(amount) !== expectedPrice) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid price calculation.' }) };
    }

    // Initialize Paynow SDK
    const paynow = new Paynow(
      process.env.PAYNOW_INTEGRATION_ID,
      process.env.PAYNOW_INTEGRATION_KEY
    );

    paynow.resultUrl = `${process.env.URL}/.netlify/functions/paynow-webhook`;
    paynow.returnUrl = `${process.env.URL}/#dashboard`;

    const title = `${level} ${subjects.join(' + ')} Access`;
    const payment = paynow.createPayment(title, email);
    payment.add(title, expectedPrice);

    const response = await paynow.send(payment);

    if (response.success) {
      // Record pending payment in Supabase
      const { error: dbError } = await supabase.from('payments').insert({
        user_id: userId,
        email: email,
        amount: expectedPrice,
        level: level,
        subjects: subjects,
        paynow_reference: response.pollUrl,
        status: 'pending'
      });

      if (dbError) throw dbError;

      return {
        statusCode: 200,
        body: JSON.stringify({ redirectUrl: response.redirectUrl })
      };
    } else {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Failed to create Paynow transaction.' })
      };
    }
  } catch (err) {
    console.error('Paynow Init Error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Server error initiating payment.' })
    };
  }
};
