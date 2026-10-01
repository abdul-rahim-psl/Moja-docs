/* §10 row 5: FXP/DFSP NDC breach — set a low net debit cap, then exceed it.
 * Distinct from the accidental zero-liquidity 4001: here the participant IS
 * funded, and it is the cap itself that is breached. */
const setNdc = async (fsp, currency, value) => {
  const r = await send({
    svc: 'centralledger', method: 'PUT', path: `/participants/${fsp}/limits`,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
               'Date': new Date().toUTCString(), 'FSPIOP-Source': 'Hub' },
    body: { currency, limit: { type: 'NET_DEBIT_CAP', value, alarmPercentage: 10 } },
  });
  console.log(`set NDC ${fsp}/${currency} = ${value} -> HTTP ${r.status} ${r.body || ''}`);
};

(async () => {
  await positions('before');
  // cap just above the current position so the next 10 transfer breaches it
  await setNdc(PAYER, SRC_CCY, 35);
  await sleep(2000);

  const t = await prepareTransfer({ amount: '10', label: 'prepare (should breach NDC of 35)' });
  await sleep(6000);
  await positions('after (expect payer position UNCHANGED at 30 — prepare rejected)');
  console.log('\nTRANSFER_ID=' + t.transferId);

  await setNdc(PAYER, SRC_CCY, 1000000); // restore
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
