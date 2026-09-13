# Task 3 — Communicate

## Reply to the customer

Hello,

Thanks for flagging this, and for checking the Further dashboard before reaching out. Since the leads are visible in Further, inbound capture appears to be working, so I’d focus first on the delivery path from Further to your CRM.

I don’t want to give you a cause before I’ve traced an affected record. Two things would give me what I need to start:

1. One or two leads that you can see in Further but not in the CRM. A name or email address and roughly when each came in is enough.
2. The last lead you know successfully reached the CRM, if you can identify one.

With those examples I can trace the affected records and compare them with the last known successful delivery. The first things I’ll be looking for are an authentication failure on the CRM connection, a payload the CRM has started rejecting, or a failure in an intermediate automation step.

I’ll start with those records and follow up with what I find or with the next step if the failure isn’t immediately clear.

Best,
Andrew

---

## Notes for the team

**Why those two questions.** The affected records give me something specific to trace instead of a symptom to theorize about. I can compare the Further record against the outbound attempt for the same lead. The last known good lead bounds the failure window, which is what lets me line the break up against a token expiry, a CRM release, or a config change.

**Why I didn't ask more.** I didn't ask which CRM they use or how the integration is configured in the initial reply because I would first check the customer's account and integration configuration internally. If that information isn't available there, I'd ask only for the missing detail. Asking a customer to repeat information I can retrieve myself adds friction without helping the investigation. I also didn't ask whether a CRM admin changed anything, even though that's my second-likeliest cause: they've already told me nothing changed on their side, and leading with a question that implies otherwise puts them on the defensive before I have evidence. The delivery log will tell me, and if it points at a CRM-side validation error I can raise it with the error message in hand.

**Most likely causes, in the order I'd check them.**

1. **CRM credentials expired or revoked.** Inbound ingestion appears healthy based on the leads being present in Further, so I would check the outbound connection first — an expired OAuth token, a rotated password, or a deactivated integration user. It fits the symptom: everything works until a token quietly ages out, so the break is sudden with no deploy behind it. First check is the HTTP status on the outbound attempts for the leads they send me, looking for 401 or 403.

2. **The CRM is rejecting the payload.** A newly required field, a tightened picklist, or a duplicate rule can start bouncing records without anyone touching the integration config. First check is the CRM's response body on a failed attempt, compared against the payload for the last lead that succeeded.

3. **The handoff step is failing without surfacing it.** If Zapier or similar sits in the middle, the trigger can keep firing while a later step is off, misconfigured, or swallowing an error. A completed run is not proof the CRM write succeeded. First check is the step-level run history and the downstream response, specifically whether the CRM write returned a record ID rather than just a 200.
