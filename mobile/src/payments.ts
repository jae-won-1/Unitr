// Small pieces every PaymentSheet surface in the app shares.

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { saveCardFromIntent } from '@/lib/save-card';

// A PaymentIntent's client secret is always "{intent_id}_secret_{random}".
// PaymentSheet confirms the intent but hands back no id on success — only an
// { error } — so the id a follow-up route needs (/api/ringer/join, saving the
// card) is read back out of the secret. Stripe documents this shape; it is not
// this app inferring it.
export function paymentIntentIdFrom(clientSecret: string): string {
  return clientSecret.split('_secret_')[0];
}

// "Save this card for future payments" — the mobile half of the web's
// useSaveCardTickbox (components/SaveCardPrompt.tsx), same rules:
//
//   • off by default — it is consent to store a card, so it has to be the
//     payer's own act;
//   • offered only to someone with no card on file yet;
//   • committed after the charge succeeds, by copying the card off the intent
//     that just paid (lib/save-card.ts → saveCardFromIntent), so there is no
//     second authentication;
//   • never throws — the payment is already done, and a failure to save must
//     not look like a failed payment.
//
// Every intent route already creates the payment with a customer and
// setup_future_usage: "off_session", which is what makes the copy possible.
export function useSaveCardChoice(userId: string | undefined) {
  const [hasSavedCard, setHasSavedCard] = useState<boolean | undefined>(undefined);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!userId) {
      setHasSavedCard(undefined);
      return;
    }
    let live = true;
    void supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_payment_method_id')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (live) setHasSavedCard(Boolean(data?.stripe_customer_id && data?.stripe_payment_method_id));
      });
    return () => {
      live = false;
    };
  }, [userId]);

  const commit = useCallback(
    async (paymentIntentId: string): Promise<boolean> => {
      if (!checked || !userId || hasSavedCard === true) return false;
      const ok = await saveCardFromIntent(userId, paymentIntentId);
      if (ok) setHasSavedCard(true);
      return ok;
    },
    [checked, userId, hasSavedCard],
  );

  // Shown while the lookup is in flight too — a first-time payer is the common
  // case, and hiding the option until the answer lands is how it gets missed.
  const offer = !!userId && hasSavedCard !== true;

  return { offer, checked, setChecked, commit };
}
