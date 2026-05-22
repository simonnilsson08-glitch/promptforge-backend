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

  advanced: `Du är en expert på prompt engineering. Förbättra användarens prompt med roll, kontext, format och constraints. Behåll samma språk. Svara
