import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FREE_PROMPTS = 20;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, token } = req.body || {};

  if (action === 'login') {
    if (!email) return res.status(400).json({ error: 'Email krävs' });
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true }
    });
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (action === 'verify') {
    if (!email || !token) return res.status(400).json({ error: 'Email och kod krävs' });
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: 'email'
    });
    if (error) return res.status(401).json({ error: 'Ogiltig eller utgången kod. Försök igen.' });

    const user = data.user;
    const { data: existing } = await supabase
      .from('users')
      .select('id, is_pro, prompts_used')
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

    const promptsUsed = existing?.prompts_used || 0;
    const isPro = existing?.is_pro || false;

    return res.status(200).json({
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        is_pro: isPro,
        prompts_used: promptsUsed,
        prompts_remaining: isPro ? 999 : Math.max(0, FREE_PROMPTS - promptsUsed)
      }
    });
  }

  if (action === 'status') {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Ej inloggad' });
    const { data: { user }, error } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (error || !user) return res.status(401).json({ error: 'Ogiltig session' });

    const { data: userData } = await supabase
      .from('users')
      .select('is_pro, prompts_used')
      .eq('id', user.id)
      .single();

    const promptsUsed = userData?.prompts_used || 0;
    const isPro = userData?.is_pro || false;

    return res.status(200).json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        is_pro: isPro,
        prompts_used: promptsUsed,
        prompts_remaining: isPro ? 999 : Math.max(0, FREE_PROMPTS - promptsUsed)
      }
    });
  }

  return res.status(400).json({ error: 'Okänd action' });
}
