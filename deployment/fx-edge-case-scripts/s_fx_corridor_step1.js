/* FX corridor happy path, step 1: real POST /fxQuotes (payer->FXP) and real
 * POST /quotes (payer->payee), both auto-answered by the sims' own SDKs now
 * that the shared backend is fixed (§9.19/§9.20). No manual response
 * crafting — this exercises the real automated corridor. Prints the ids
 * needed to fetch and decode the real callbacks afterward. */
(async () => {
  const conversionRequestId = id(), conversionId = id(), determiningTransferId = id();
  const fxExpiration = isoDate(5 * 60 * 1000);
  const fxHdrs = headers('fxQuotes', PAYER, FXP);
  const fxIso = await TransformFacades.FSPIOP.fxQuotes.post({
    body: { conversionRequestId,
      conversionTerms: { conversionId, determiningTransferId, initiatingFsp: PAYER,
        counterPartyFsp: FXP, amountType: 'SEND',
        sourceAmount: { currency: SRC_CCY, amount: '100' },
        targetAmount: { currency: TGT_CCY }, expiration: fxExpiration } },
    headers: fxHdrs,
  });
  report('POST /fxQuotes', await send({ svc: 'quoting', method: 'POST', path: '/fxQuotes',
                                        headers: fxHdrs, body: fxIso.body }));

  const quoteId = id(), transactionId = id();
  const qHdrs = headers('quotes', PAYER, PAYEE, '1.0');
  const qIso = await TransformFacades.FSPIOP.quotes.post({
    body: {
      quoteId, transactionId,
      payer: { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990001001', fspId: PAYER } },
      payee: { partyIdInfo: { partyIdType: 'MSISDN', partyIdentifier: '9990002001', fspId: PAYEE } },
      amountType: 'SEND',
      amount: { amount: '100', currency: SRC_CCY },
      transactionType: { scenario: 'TRANSFER', initiator: 'PAYER', initiatorType: 'CONSUMER' },
    },
    headers: qHdrs,
  });
  report('POST /quotes', await send({ svc: 'quoting', method: 'POST', path: '/quotes',
                                      headers: qHdrs, body: qIso.body }));

  console.log('\nwaiting 15s for both automatic PUT callbacks...');
  await sleep(15000);

  console.log('\nCONVERSION_REQUEST_ID=' + conversionRequestId);
  console.log('CONVERSION_ID=' + conversionId);
  console.log('DETERMINING_TRANSFER_ID=' + determiningTransferId);
  console.log('QUOTE_ID=' + quoteId);
  console.log('TRANSACTION_ID=' + transactionId);
})().catch((e) => { console.error('FATAL', e.message); console.error(e.stack); });
