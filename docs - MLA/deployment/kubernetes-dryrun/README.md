# MLA Kubernetes Dry Run — Manifests

These manifests support a local validation deployment only and are not intended for delivery to CCH.
They were used to verify, on an isolated Kubernetes cluster, that the MLA deployment mechanism — image,
manifests, configuration surface, secrets, and health probes — functions correctly end to end, using a
mock downstream service (`ppa-stub`) in place of the production PPA.

## Apply Order

`ppa-stub` must be applied before `cch-mla`. MLA's readiness does not depend on PPA being reachable, but
applying `ppa-stub` first ensures a working downstream is in place to observe the full delivery path on
first boot.

```bash
kubectl apply -f 00-configmap.yaml
kubectl apply -f 01-ppastub-deployment.yaml
kubectl apply -f 02-mla-deployment.yaml
```

## Secrets

The following secrets are created directly with `kubectl create secret generic`, from locally generated
files, and are intentionally not committed as manifests here to avoid storing key material in the
repository:

- `cch-mla-ppa-mtls`
- `cch-ppastub-server-tls`
- `cch-mla-jws-keys`
- `cch-mla-pii-secret`
