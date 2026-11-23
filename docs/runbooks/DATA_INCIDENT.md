# Runbook: personal data incident (RA 10173, NPC Circular 16-03)

**When:** personal data may have been seen, changed, lost or taken by someone who shouldn't have
it: a leaked key, a phone with the admin console stolen, a wrong person seeing someone's order
or ID document, a bug that shows other customers' data, a lost laptop with exports.
**Who:** the owner and the Data Protection Officer (DPO, Q36). Start the clock when you first
know: **notify the NPC and affected people within 72 hours** when the breach involves sensitive
personal information (e.g. government IDs) or information that could enable identity fraud, and
is likely to give rise to a real risk of serious harm.

**Hour 0–2: contain**
1. Write down the time you learned of it and what you know.
2. Stop it:
   - Leaked secret → rotate it now (Supabase service-role key, PayMongo, Semaphore, Gemini,
     `CRON_SECRET`, webhook secrets) in Supabase/Vercel/GitHub, then redeploy.
   - Stolen device → **Console → Staff**: remove the person's roles; in Supabase Auth sign them
     out (delete sessions) and reset their password/TOTP.
   - Bug exposing data → turn the feature off (settings flag) or roll back the deployment in
     Vercel (Instant Rollback).
3. Keep evidence: don't delete logs; export `audit_logs` for the period (who viewed which KYC
   document, who exported what).

**Hour 2–24: assess**
4. What data, whose, how many people, since when (audit log, Vercel logs by `requestId`,
   Supabase logs). Is it sensitive (government IDs, financial account numbers)?
5. Decide with the DPO whether it is a notifiable breach (above).

**Within 72 hours: notify (if notifiable)**
6. NPC: the breach notification form (privacy.gov.ph) — nature of the breach, data and people
   involved, measures taken, DPO contact.
7. Affected people: a text and email in plain language — what happened, what data, what we did,
   what they can do (e.g. watch for fraud), and the DPO contact.
8. Partners if their data is involved (stores, PayMongo).

**After**
9. Fix the cause, add a test that would have caught it, and write the incident up in
   docs/LAUNCH.md §9 and docs/SECURITY.md (open item or fixed item).
10. Keep the incident file (timeline, decisions, notices) for NPC follow-up and the annual
    security incident report.
