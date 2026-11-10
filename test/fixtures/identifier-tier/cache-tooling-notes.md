# Cache tooling notes

- Added sweep_caches.sh to the cache tooling. It checks that no cache entry outlives its expiry stamp.
- It prints one line per problem and a summary at the end.
- Exits non-zero when it finds a cache entry past its expiry.
