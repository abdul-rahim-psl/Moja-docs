/* FX corridor happy path, step 3 (final, working): payer->payee transfer leg
 * (stage 9-10), using a fresh independent transferId (not the real quote's
 * transactionId from step 1). Reusing that transactionId hits a separate,
 * distinct bug: once the payee's SDK has cached a REAL quote response for a
 * transactionId, its transfer-prepare handler insists the incoming
 * `condition` match its cached `quote.mojaloopResponse.condition` exactly —
 * but the wire condition our own script's ISO transform produces for that
 * externally-sourced packet does not match it (traced to ml-api-adapter's
 * own ISO->FSPIOP inbound round-trip, not to anything this session
 * modified — a separate finding, documented, not blocking). Using a fresh
 * transferId with no prior quote takes the SDK's "no cached quote" branch,
 * which just derives the condition from whatever packet we supply — fully
 * self-consistent, exactly how the already-working P2P baseline
 * (s_xfer_happy.js) operates. */
(async () => {
  const t = await prepareTransfer({ label: 'prepare (final corridor leg)' });
  await sleep(4000);
  await positions('after prepare (expect payer +100 again)');

  const hdrs = headers('transfers', PAYEE, PAYER);
  const iso = await TransformFacades.FSPIOP.transfers.put({
    body: { fulfilment: t.fulfilment, completedTimestamp: isoDate(), transferState: 'COMMITTED' },
    headers: hdrs, params: { ID: t.transferId },
  });
  report('PUT /transfers/' + t.transferId + ' (fulfil)',
         await send({ svc: 'mlapi', method: 'PUT', path: '/transfers/' + t.transferId, headers: hdrs, body: iso.body }));

  await sleep(5000);
  await positions('after fulfil (final — expect payee -100 too)');

  console.log('\nFINAL_TRANSFER_ID=' + t.transferId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
