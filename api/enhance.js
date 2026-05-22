import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FREE_LIMIT = 20;

const META_PROMPTS = {
  simple: `Du är en prompt-förbättrare. Ta användarens prompt och gör den tydligare och mer specifik. Behåll samma språk. Svara ENBART med den förbättrade prompten, ingen förklaring.

Användarens prompt:
{{PROMPT}}`,

  advanced: `Du är en expert på prompt engineering. Förbättra användarens prompt med roll, kontext, format och constraints. Behåll samma språk. Svara ENBART med den förbättrade prompten.

Användarens prompt:
{{PROMPT}}`,

  expert: `Du är en världsledande expert på prompt engineering. Förbättra prompten med roll, kontext, delsteg, format, längd och constraints. Behåll samma språk. Svara ENBART med den förbättrade prompten.

Användarens prompt:
{{PROMPT}}`,

  auto: `Du är en expert på prompt engineering. Analysera och välj rätt strategi: kreativt=stil+ton, logik=steg-för-steg, komplex=roll+kontext+format, enkel=förtydliga. Behåll samma språk. Svara ENBART med den förbättrade prompten.

Användarens prompt:
{{PROMPT}}`
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Ej inloggad', code: 'NOT_LOGGED_IN' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  );
  if (authError || !user) return res.status(401).json({ error: 'Ogiltig session', code: 'INVALID_SESSION' });

  let { data: userData } = await supabase
    .from('users')
    .select('is_pro, prompts_used, prompts_reset_at')
    .eq('id', user.id)
    .single();

  if (!userData) {
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        id: user.id,
        email: user.email,
        is_pro: false,
        prompts_used: 0,
        prompts_reset_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError) return res.status(500).json({ error: 'Kunde inte skapa användare' });
    userData = newUser;
  }

  if (!userData.is_pro) {
    const resetDate = new Date(userData.prompts_reset_at);
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    if (resetDate < monthAgo) {
      await supabase.from('users').update({
        prompts_used: 0,
        prompts_reset_at: new Date().toISOString()
      }).eq('id', user.id);
      userData.prompts_used = 0;
    }

    if (userData.prompts_used >= FREE_LIMIT) {
      return res.status(403).json({
        error: `Du har använt alla ${FREE_LIMIT} gratis prompts. Uppgradera till Pro!`,
        code: 'LIMIT_REACHED',
        upgrade: true
      });
    }
  }

  const { prompt, mode = 'advanced' } = req.body;
  if (!prompt || prompt.trim().length < 3) {
    return res.status(400).json({ error: 'Prompten är för kort' });
  }

  const metaPrompt = (META_PROMPTS[mode] || META_PROMPTS.advanced)
    .replace('{{PROMPT}}', prompt.trim());

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: metaPrompt }]
    });

    const enhanced = message.content[0].text.trim();
    const newCount = userData.prompts_used + 1;

    await supabase.from('users').update({ prompts_used: newCount }).eq('id', user.id);

    return res.status(200).json({
      ok: true,
      enhanced,
      prompts_used: newCount,
      prompts_remaining: userData.is_pro ? 999 : Math.max(0, FREE_LIMIT - newCount)
    });

  } catch (err) {
    console.error('Claude error:', err);
    return res.status(500).json({ error: 'AI-tjänsten svarade inte. Försök igen.' });
  }
}
