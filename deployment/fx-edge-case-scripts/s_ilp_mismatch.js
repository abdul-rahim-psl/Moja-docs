/* §10 row 7: ILP condition mismatch on the fulfil leg.
 * Prepare with condition C, then fulfil with a fulfilment that does NOT hash to C. */
(async () => {
  const t = await prepareTransfer({ label: 'prepare (valid condition)' });
  await sleep(4000);
  await positions('after prepare');

  // A structurally valid but WRONG fulfilment: 32 random bytes, base64url.
  const bogus = crypto.randomBytes(32).toString('base64url');
  console.log('\nreal fulfilment  = ' + t.fulfilment);
  console.log('bogus fulfilment = ' + bogus);
  console.log('condition        = ' + t.condition);

  const hdrs = headers('transfers', PAYEE, PAYER);
  const iso = await TransformFacades.FSPIOP.transfers.put({
    body: { fulfilment: bogus, completedTimestamp: isoDate(), transferState: 'COMMITTED' },
    headers: hdrs, params: { ID: t.transferId },
  });
  const res = await send({ svc: 'mlapi', method: 'PUT', path: '/transfers/' + t.transferId,
                           headers: hdrs, body: iso.body });
  report('PUT /transfers/' + t.transferId + ' (WRONG fulfilment)', res);

  await sleep(6000);
  await positions('after bad fulfil (expect reservation released, payer back down by 10)');
  console.log('\nTRANSFER_ID=' + t.transferId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
