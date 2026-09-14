/* Probe: does e2e-sim2's own SDK+backend auto-respond to a real /quotes
 * request now that the shared backend is fixed? Real payee lookup skipped
 * (already known: MSISDN 9990002001 -> e2e-sim2, §9.9); we only send the
 * quote request for real and see if a PUT /quotes/{ID} callback appears. */
(async () => {
  const quoteId = id(), transactionId = id();
  const hdrs = headers('quotes', PAYER, PAYEE, '1.0');
  const iso = await TransformFacades.FSPIOP.quotes.post({
    body: {
      quoteId, transactionId,
      payer: { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990001001', fspId: PAYER } },
      payee: { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990002001', fspId: PAYEE } },
      amountType: 'SEND',
      amount: { amount: '100', currency: SRC_CCY },
      transactionType: { scenario: 'TRANSFER', initiator: 'PAYER', initiatorType: 'CONSUMER' },
    },
    headers: hdrs,
  });
  console.log('quoteId=' + quoteId + ' transactionId=' + transactionId);
  report('POST /quotes', await send({ svc: 'quoting', method: 'POST', path: '/quotes',
                                      headers: hdrs, body: iso.body }));
  console.log('\nwaiting 15s for a possible automatic PUT /quotes callback from e2e-sim2...');
  await sleep(15000);
  console.log('QUOTE_ID=' + quoteId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
