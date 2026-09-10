/* Baseline: a plain XXX->XXX transfer prepare between payer and payee.
 * Foundation for the abort / timeout / NDC / ILP-mismatch rows of §10 —
 * all of them need a prepare that genuinely reaches RESERVED first. */
(async () => {
  const transferId = id();
  const quoteId = id();
  const expiration = isoDate(10 * 60 * 1000); // +10 min
  const amount = '10';

  const { fulfilment, condition, ilpPacket } = ilpFor({
    transferId, quoteId, amount, currency: SRC_CCY, expiration,
  });
  console.log('transferId=' + transferId);
  console.log('condition=' + condition);
  console.log('fulfilment=' + fulfilment);
  console.log('expiration=' + expiration);

  const fspiopBody = {
    transferId,
    payerFsp: PAYER,
    payeeFsp: PAYEE,
    amount: { currency: SRC_CCY, amount },
    ilpPacket,
    condition,
    expiration,
  };

  const hdrs = headers('transfers', PAYER, PAYEE);
  const iso = await TransformFacades.FSPIOP.transfers.post({ body: fspiopBody, headers: hdrs });
  console.log('\n--- ISO20022 pacs.008 sent ---');
  console.log(JSON.stringify(iso.body, null, 1));

  const res = await send({ svc: 'mlapi', method: 'POST', path: '/transfers', headers: hdrs, body: iso.body });
  report('POST /transfers', res);

  // give the async pipeline a moment, then ask central-ledger what state it reached
  await new Promise((r) => setTimeout(r, 4000));
  const st = await send({
    svc: 'mlapi', method: 'GET', path: '/transfers/' + transferId,
    headers: headers('transfers', PAYER, PAYEE),
  });
  report('GET /transfers/' + transferId, st);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
