// api/checkout.js
// POST {} with Authorization → returns Stripe checkout URL
// GET /api/checkout?session_id=xxx → confirms payment, upgrades user

import Stripe from 'stripe';
import { supabase } from '../lib/supabase.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const PRICE_ID = process.env.STRIPE_PRICE_ID; // set in Vercel env vars
const APP_URL = process.env.APP_URL || 'https://promptforge-web-cyan.vercel.app';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── CREATE CHECKOUT SESSION ───────────────────────────────
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Ej inloggad' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Ogiltig session' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      customer_email: user.email,
      metadata: { user_id: user.id },
      success_url: `${APP_URL}?upgrade=success`,
      cancel_url: `${APP_URL}?upgrade=cancelled`,
      locale: 'sv'
    });

    return res.status(200).json({ url: session.url });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
