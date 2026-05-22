// api/webhook.js
// Stripe sends events here when payments succeed/fail
// This is how we know to upgrade a user to Pro

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── PAYMENT SUCCEEDED → upgrade to Pro ───────────────────
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;

    if (userId) {
      await supabase.from('users').update({
        is_pro: true,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', userId);

      console.log(`✅ User ${userId} upgraded to Pro`);
    }
  }

  // ── SUBSCRIPTION CANCELLED → downgrade ───────────────────
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    const customerId = subscription.customer;

    const { data: userData } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();

    if (userData) {
      await supabase.from('users').update({
        is_pro: false,
        stripe_subscription_id: null
      }).eq('id', userData.id);

      console.log(`⬇️ User ${userData.id} downgraded from Pro`);
    }
  }

  return res.status(200).json({ received: true });
}
