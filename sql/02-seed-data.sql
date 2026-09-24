-- ═══════════════════════════════════════════════════════════════════════════
-- AI Registry — Seed Data (5 sample AI systems across risk tiers)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO ai_registry.ai_systems
  (system_name, description, risk_tier, data_sensitivity, business_owner,
   business_unit, model_name, litellm_team_id, status, approved_at, review_due_at)
VALUES
  ('Customer Support Bot',
   'Automated support agent handling tickets and FAQs. Processes customer names, emails, and order info.',
   'limited', 'confidential', 'Sarah Chen', 'Support Operations',
   'gemini-flash', 'team-dev', 'active',
   NOW() - INTERVAL '30 days', NOW() + INTERVAL '150 days'),

  ('Code Review Agent',
   'AI code review assistant analyzing PRs for bugs and security vulnerabilities.',
   'minimal', 'internal', 'James Rodriguez', 'Engineering',
   'gemini-flash', 'team-dev', 'active',
   NOW() - INTERVAL '45 days', NOW() + INTERVAL '320 days'),

  ('Financial Analyst Agent',
   'Analyzes quarterly reports, generates earnings forecasts, and produces risk assessments.',
   'high', 'restricted', 'Michael Park', 'Finance',
   'gpt-4o', 'team-standard', 'active',
   NOW() - INTERVAL '15 days', NOW() + INTERVAL '75 days'),

  ('HR Policy Assistant',
   'Assists HR with policy interpretation and employee onboarding. Accesses compensation data.',
   'high', 'confidential', 'Priya Sharma', 'Human Resources',
   'gpt-4o', 'team-admin', 'active',
   NOW() - INTERVAL '20 days', NOW() + INTERVAL '70 days'),

  ('Marketing Content Generator',
   'Generates marketing copy and social media posts. Works only with public brand materials.',
   'limited', 'public', 'Alex Thompson', 'Marketing',
   'gpt-4o-mini', 'team-standard', 'active',
   NOW() - INTERVAL '10 days', NOW() + INTERVAL '170 days')
ON CONFLICT DO NOTHING;

-- ── Sample governance review for Financial Analyst (high-risk) ────────────
INSERT INTO ai_registry.risk_reviews
  (ai_system_id, reviewer, risk_tier_before, risk_tier_after, findings,
   next_review_at, reviewed_at)
SELECT id,
  'Dr. Emily Watson (Chief AI Ethics Officer)', 'high', 'high',
  'Financial Analyst Agent reviewed for Q3 compliance. Model outputs are advisory only. '
  'Guardrail triggers within acceptable range. Recommend maintaining HIGH classification.',
  NOW() + INTERVAL '75 days', NOW() - INTERVAL '5 days'
FROM ai_registry.ai_systems WHERE system_name = 'Financial Analyst Agent' LIMIT 1;

