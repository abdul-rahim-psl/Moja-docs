Here's the whole page in short:

**Problem it solves:** enables cross-currency (FX) transfers in Mojaloop by letting DFSPs source competitive exchange rates from a marketplace of FX Providers (FXPs), rather than only supporting same-currency P2P transfers.

**Parties:** Payer DFSP, Payee DFSP, FXP (supplies rate/liquidity), and the Mojaloop switch (orchestrates it all).

**Five-phase flow:**
1. **Discovery** — Payer DFSP finds the Payee DFSP via Oracle, confirms account validity and receivable currencies.
2. **Currency Conversion Agreement** — Payer DFSP gets a locked-in rate and liquidity commitment from an FXP.
3. **Transfer Agreement** — terms are established with the Payee DFSP.
4. **Payer Confirmation** — all terms (amount, rate, fees) are presented to the sender for approval.
5. **Transfer Execution** — the transfer actually executes once agreed.

**Two amount-type modes:** SEND (payer specifies the amount in their own currency — typical remittance) vs RECEIVE (payer specifies the amount the payee should get — typical merchant payment).

**Roadmap items not yet built:** Payee-DFSP-side conversion, reference-currency conversion, bulk liquidity procurement.

This maps directly to your earlier memory note: PPA is built on plain-FSPIOP P2P, while real DRPP production runs this full cross-border ISO 20022 FX flow — this page is the FX layer PPA currently doesn't implement.