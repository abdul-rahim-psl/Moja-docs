(async () => {
  for (const p of [PAYER, PAYEE, FXP]) {
    const r = await send({ svc: 'centralledger', method: 'GET',
      path: `/participants/${p}/limits`, headers: { Accept: 'application/json' } });
    console.log(p + ' limits: HTTP ' + r.status + ' ' + r.body);
  }
  const a = await send({ svc: 'centralledger', method: 'GET',
    path: `/participants/${PAYER}/accounts`, headers: { Accept: 'application/json' } });
  console.log('\n' + PAYER + ' accounts: HTTP ' + a.status + ' ' + a.body);
})().catch(e => console.error('FATAL', e.message));
