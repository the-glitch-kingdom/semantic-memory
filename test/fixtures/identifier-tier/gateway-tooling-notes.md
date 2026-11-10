# Gateway tooling notes

- Added probe_gateways.sh to the gateway tooling. It checks that each gateway answers its health route within two seconds.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds a gateway that times out.
