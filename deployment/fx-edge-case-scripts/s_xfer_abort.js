/* §10 row 3: transfer abort — payee sends PUT /transfers/{ID}/error instead of fulfilling. */
(async () => {
  const t = await prepareTransfer({ label: 'prepare (to be aborted)' });
  await sleep(4000);
  await positions('after prepare');

  const hdrs = headers('transfers', PAYEE, PAYER);
  const iso = await TransformFacades.FSPIOP.transfers.putError({
    body: { errorInformation: { errorCode: '5000', errorDescription: 'Generic payee error - payee rejected the transfer' } },
    headers: hdrs, params: { ID: t.transferId },
  });
  console.log('\n--- ISO PUT /error body ---');
  console.log(JSON.stringify(iso.body, null, 1));

  const res = await send({ svc: 'mlapi', method: 'PUT', path: '/transfers/' + t.transferId + '/error',
                           headers: hdrs, body: iso.body });
  report('PUT /transfers/' + t.transferId + '/error (payee abort)', res);

  await sleep(6000);
  await positions('after abort (expect payer reservation released)');
  console.log('\nTRANSFER_ID=' + t.transferId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
