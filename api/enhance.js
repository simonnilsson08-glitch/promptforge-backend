// api/enhance.js
// POST { prompt, mode } with Authorization: Bearer <token>
// Returns { enhanced } or { error, upgrade: true } when limit reached

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../lib/supabase.js';

const FREE_LIMIT = 20;

const META_PROMPTS = {
  simple: `Du är en prompt-förbättrare. Ta användarens prompt och gör den tydligare och mer specifik. Behåll samma språk som användaren skrev på. Svara ENBART med den förbättrade prompten, ingen förklaring, inga citationstecken.

Användarens prompt:
{{PROMPT}}`,

  advanced: `Du är en expert på prompt engineering. Förbättra användarens prompt med:
- En tydlig roll för AI:n
- Specifik kontext
- Önskat format
- Constraints

Behåll samma språk. Svara ENBART med den förbättrade prompten, ingen förklaring.

Användarens prompt:
{{PROMPT}}`,

  expert: `Du är en världsledande expert på prompt engineering. Förbättra prompten med:
1. Tydlig roll och expertis
2. Specifik kontext och bakgrund
3. Exakta delsteg
4. Önskat format och längd
5. Constraints och tonalitet

Behåll samma språk. Svara ENBART med den förbättrade prompten.

Användarens prompt:
{{PROMPT}}`,

  auto: `Du är en expert på prompt engineering. Analysera prompten och välj rätt strategi automatiskt:
- Om det är en kreativ uppgift: lägg till stil, ton, format
- Om det är logik/matte: lägg till "tänk steg för steg"
- Om det är en komplex arbetsuppgift: lägg till roll, kontext, format, constraints
- Om det är en enkel fråga: förtydliga bara vad som efterfrågas

Behåll samma språk. Svara ENBART med den förbättrade prompten.

Användarens prompt:
{{PROMPT}}`
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── AUTH ─────────────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Ej inloggad', code: 'NOT_LOGGED_IN' });

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Ogiltig session', code: 'INVALID_SESSION' });

  // ── FETCH USER DATA ───────────────────────────────────────
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('is_pro, prompts_used, prompts_reset_at')
    .eq('id', user.id)
    .single();

  if (userError || !userData) return res.status(500).json({ error: 'Kunde inte hämta användare' });

  // ── USAGE CHECK ───────────────────────────────────────────
  if (!userData.is_pro) {
    // Reset monthly counter if needed
    const resetDate = new Date(userData.prompts_reset_at);
    const now = new Date();
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

    if (resetDate < monthAgo) {
      await supabase.from('users').update({
        prompts_used: 0,
        prompts_reset_at: now.toISOString()
      }).eq('id', user.id);
      userData.prompts_used = 0;
    }

    if (userData.prompts_used >= FREE_LIMIT) {
      return res.status(403).json({
        error: `Du har använt alla ${FREE_LIMIT} gratis prompts. Uppgradera till Pro för obegränsat!`,
        code: 'LIMIT_REACHED',
        upgrade: true,
        prompts_used: userData.prompts_used,
        limit: FREE_LIMIT
      });
    }
  }

  // ── VALIDATE INPUT ────────────────────────────────────────
  const { prompt, mode = 'advanced' } = req.body;
  if (!prompt || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'Prompten är för kort' });
  }

  const metaPrompt = (META_PROMPTS[mode] || META_PROMPTS.advanced)
    .replace('{{PROMPT}}', prompt.trim());

  // ── CALL CLAUDE ───────────────────────────────────────────
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: metaPrompt }]
    });

    const enhanced = message.content[0].text.trim();

    // ── INCREMENT USAGE ───────────────────────────────────────
    await supabase.from('users')
      .update({ prompts_used: userData.prompts_used + 1 })
      .eq('id', user.id);

    // Log to usage_logs for analytics
    await supabase.from('usage_logs').insert({
      user_id: user.id,
      mode,
      prompt_length: prompt.length,
      enhanced_length: enhanced.length
    });

    return res.status(200).json({
      ok: true,
      enhanced,
      prompts_used: userData.prompts_used + 1,
      prompts_remaining: userData.is_pro
        ? 999
        : Math.max(0, FREE_LIMIT - userData.prompts_used - 1)
    });

  } catch (err) {
    console.error('Claude error:', err);
    return res.status(500).json({ error: 'AI-tjänsten svarade inte. Försök igen.' });
  }
}
