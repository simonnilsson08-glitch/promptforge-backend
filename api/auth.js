// api/auth.js
// POST { email } → sends magic link to user's email
// POST { token } → verifies token, returns session

import { supabase } from '../lib/supabase.js';

const FREE_PROMPTS = 20;

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, token } = req.body || {};

  // ── SEND MAGIC LINK ──────────────────────────────────────
  if (action === 'login') {
    if (!email) return res.status(400).json({ error: 'Email krävs' });

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: null // we verify via token, not redirect
      }
    });

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true, message: 'Kolla din email för inloggningslänk!' });
  }

  // ── VERIFY OTP TOKEN ─────────────────────────────────────
  if (action === 'verify') {
    if (!email || !token) return res.status(400).json({ error: 'Email och token krävs' });

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });

    if (error) return res.status(401).json({ error: 'Ogiltig eller utgången kod' });

    const user = data.user;

    // Ensure user row exists in our users table
    const { data: existing } = await supabase
      .from('users')
      .select('id, is_pro, prompts_used, prompts_reset_at')
      .eq('id', user.id)
      .single();

    if (!existing) {
      await supabase.from('users').insert({
        id: user.id,
        email: user.email,
        is_pro: false,
        prompts_used: 0,
        prompts_reset_at: new Date().toISOString()
      });
    }

    return res.status(200).json({
      ok: true,
      access_token: data.session.access_token,
      user: {
        id: user.id,
        email: user.email,
        is_pro: existing?.is_pro || false,
        prompts_used: existing?.prompts_used || 0,
        prompts_remaining: existing?.is_pro
          ? 999
          : Math.max(0, FREE_PROMPTS - (existing?.prompts_used || 0))
      }
    });
  }

  // ── GET STATUS (check token) ──────────────────────────────
  if (action === 'status') {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Ej inloggad' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Ogiltig session' });

    const { data: userData } = await supabase
      .from('users')
      .select('is_pro, prompts_used')
      .eq('id', user.id)
      .single();

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        is_pro: userData?.is_pro || false,
        prompts_used: userData?.prompts_used || 0,
        prompts_remaining: userData?.is_pro
          ? 999
          : Math.max(0, FREE_PROMPTS - (userData?.prompts_used || 0))
      }
    });
  }

  return res.status(400).json({ error: 'Okänd action' });
}
