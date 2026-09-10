/* Baseline happy path: prepare -> fulfil -> COMMITTED.
 * Validates the direct-request toolkit end to end before edge cases build on it. */
(async () => {
  const t = await prepareTransfer({ label: 'prepare' });
  await sleep(4000);
  await positions('after prepare (expect payer position = 10)');

  const hdrs = headers('transfers', PAYEE, PAYER);
  const iso = await TransformFacades.FSPIOP.transfers.put({
    body: { fulfilment: t.fulfilment, completedTimestamp: isoDate(), transferState: 'COMMITTED' },
    headers: hdrs,
    params: { ID: t.transferId },
  });
  console.log('\n--- ISO PUT body ---');
  console.log(JSON.stringify(iso.body, null, 1));

  const res = await send({ svc: 'mlapi', method: 'PUT', path: '/transfers/' + t.transferId,
                           headers: hdrs, body: iso.body });
  report('PUT /transfers/' + t.transferId + ' (correct fulfilment)', res);

  await sleep(5000);
  await positions('after fulfil (expect payer 10 committed, payee -10)');
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
