/* Fund the participants' SETTLEMENT accounts.
 * §9.9's onboarding registered participants + positions + NDC, but never
 * recorded any funds in — so available liquidity stayed 0 and every prepare
 * failed 4001 "Payer FSP insufficient liquidity". */
const FUND = [
  { fsp: PAYER, currency: SRC_CCY, amount: 10000 },
  { fsp: PAYEE, currency: SRC_CCY, amount: 10000 },
  { fsp: FXP,   currency: SRC_CCY, amount: 10000 },
  { fsp: FXP,   currency: TGT_CCY, amount: 10000 },
];

(async () => {
  for (const f of FUND) {
    const acc = await send({ svc: 'centralledger', method: 'GET',
      path: `/participants/${f.fsp}/accounts`, headers: { Accept: 'application/json' } });
    const settlement = JSON.parse(acc.body).find(
      (a) => a.ledgerAccountType === 'SETTLEMENT' && a.currency === f.currency);
    if (!settlement) { console.log(`${f.fsp}/${f.currency}: no SETTLEMENT account`); continue; }

    const transferId = uuid();
    const res = await send({
      svc: 'centralledger', method: 'POST',
      path: `/participants/${f.fsp}/accounts/${settlement.id}`,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'Date': new Date().toUTCString(), 'FSPIOP-Source': 'Hub' },
      body: {
        transferId,
        externalReference: 'fx-edge-case-funding',
        action: 'recordFundsIn',
        reason: 'Funding for §10 edge-case matrix',
        amount: { amount: f.amount, currency: f.currency },
      },
    });
    console.log(`${f.fsp}/${f.currency} recordFundsIn ${f.amount} -> HTTP ${res.status} ${res.body || ''}`);
  }

  await new Promise((r) => setTimeout(r, 3000));
  console.log('\n--- balances after ---');
  for (const p of [PAYER, PAYEE, FXP]) {
    const a = await send({ svc: 'centralledger', method: 'GET',
      path: `/participants/${p}/accounts`, headers: { Accept: 'application/json' } });
    console.log(p + ': ' + a.body);
  }
})().catch((e) => console.error('FATAL', e.message));
