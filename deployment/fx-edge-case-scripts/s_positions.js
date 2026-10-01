(async () => {
  for (const p of [PAYER, PAYEE, FXP]) {
    const r = await send({ svc: 'centralledger', method: 'GET',
      path: `/participants/${p}/positions`, headers: { Accept: 'application/json' } });
    console.log(p + ' positions: HTTP ' + r.status + ' ' + r.body);
  }
})().catch(e => console.error('FATAL', e.message));
