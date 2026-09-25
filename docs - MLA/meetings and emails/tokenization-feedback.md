A thread of email:
-----------------------------------------------------------

On Fri, 4 Sept 2026 at 13:41, Behjet Ansari <behjet.ansari@paysyslabs.com> wrote:

Mwewa,

Thanks for your response. 

On point 2 (key rotation), we need one clarification before we build it.
MLA only ever writes tokens — it never checks a token against a key. So an out-of-date key doesn't produce a failure in MLA; it just silently produces tokens in the old shape. That means there's no natural event on the MLA side to trigger the "failure route."

Two questions this raises:

1. What should trigger MLA picking up a new key? Our reading is that "failure" here means the secret being unavailable — so MLA's tokenization-failure retry (per your point 1 answer) re-reads the mounted location and picks up a new key if one is there. Is that what you meant? If not, we'd default to a periodic re-check on a timer.

2. Does anything downstream need to compare tokens made under different keys? If yes, that's where the "try existing, then try older" logic belongs — in PPA, not MLA — and we'd need to know how long an old key must stay valid. If no, MLA only ever needs one active key (the newest), and rotation is just a swap.

Question 2 matters more than it looks: it decides whether MLA needs to hold several key versions at once, or only ever one. That's a materially different build, so we'd like to settle it before proceeding.

Best regards,
Behjet Ansari
Paysys Labs

----------------------------------------------------------------------------------------------------

From: Mutale Mwewa <mmwewa@comesach.org>
Sent: Friday, September 4, 2026 2:28 PM
To: Behjet Ansari <behjet.ansari@paysyslabs.com>
Cc: Soban Najam <soban.najam@paysyslabs.com>; george.murage <george.murage@altioratech.co>; Jonathan Pinifolo <jpinifolo@comesach.org>
Subject: Tokenisation Feedback

Dear Behjet, 

Part of the feedback for point 1 and 2 on the tokenisation question. 

On 1 this is agreed : if tokenisation fails we should fail the transaction and retry.

On 2 - we don't want to be holding the system up while it drains, so we should version. But we should also code for success: try the existing key, then have a failure route which looks for and applies new keys. 

So under this only 2 points may need to be closed.  

Kind Regards 

Mwewa 

--------------------------------------------------------------------------
From: George Murage <george.murage@altioratech.co>
Sent: Friday, September 18, 2026 3:25 PM
To: Behjet Ansari <behjet.ansari@paysyslabs.com>
Cc: Mutale Mwewa <mmwewa@comesach.org>; Soban Najam <soban.najam@paysyslabs.com>; Jonathan Pinifolo <jpinifolo@comesach.org>; Abdul Rahim <abdul.rahim@paysyslabs.com>; Muhammad Umair Khan <muhammad.umair@paysyslabs.com>
Subject: Re: Tokenisation Feedback

Hi Behjet and team,

There is something that is not very clear for me.

My understanding so far is that the MLA requires a PII key or secret to generate a keyed-HMAC of the MSISDN (which is the PII data).

 I understand that the same logic could apply to bank account numbers. However, are these values required anywhere else in the Tazama fraud evaluation logic? If yes, then rotating the PII secret would make the PII information (MSISDN / bank account number) appear different from any transaction history because the values would not match previously generated hashes. In essence, key rotation, would break some rules in the fraud engine that rely on matching the source/destination MSISDN/bank account number for a given set of transactions within an interval. If this is the case, the requirement is for a long-lived key that does not get rotated.

Please review and clarify on this aspect so that we are clear on what is really required - key + rotation or long-lived key.

Kind regards
George Murage

My note on this: he is absolutely correct. So we have decided to not rotate the key okay.

--------------------------------------------------------------------------
On Fri, 18 Sept 2026 at 13:38, Behjet Ansari <behjet.ansari@paysyslabs.com> wrote:

    This makes sense, and we agree with the long-lived key approach. It is what we'll require.

    Thanks
--------------------------------------------------------------------------
From: George Murage <george.murage@altioratech.co>
Sent: Tuesday, September 22, 2026 1:02:25 pm
To: Behjet Ansari <behjet.ansari@paysyslabs.com>
Cc: Mutale Mwewa <mmwewa@comesach.org>; Soban Najam <soban.najam@paysyslabs.com>; Jonathan Pinifolo <jpinifolo@comesach.org>; Abdul Rahim <abdul.rahim@paysyslabs.com>; Muhammad Umair Khan <muhammad.umair@paysyslabs.com>; Syeda Ruba Zehra <ruba.zehra@paysyslabs.com>
Subject: Re: Tokenisation Feedback

Hi Behjet,

We are working on this requirement. I think the hashing algo is HMAC-SHA-256 so a 256bit key (32 bytes) encoded in base64 should be sufficient. The key will be created with the name cch-mla-pii-secret

Please confirm this is acceptable so that we can proceed.

Kind regards
George
--------------------------------------------------------------------------
From: Behjet Ansari <behjet.ansari@paysyslabs.com>
Sent: Tuesday, 22 September 2026 13:34:09
To: george.murage <george.murage@altioratech.co>
Cc: Mutale Mwewa <mmwewa@comesach.org>; Soban Najam <soban.najam@paysyslabs.com>; Jonathan Pinifolo <jpinifolo@comesach.org>; Abdul Rahim <abdul.rahim@paysyslabs.com>; Muhammad Umair Khan <muhammad.umair@paysyslabs.com>; Syeda Ruba Zehra <ruba.zehra@paysyslabs.com>
Subject: Re: Tokenisation Feedback
 
Key name looks good, you may proceed with this. 
--------------------------------------------------------------------------

--------------------------------------------------------------------------

--------------------------------------------------------------------------

--------------------------------------------------------------------------

