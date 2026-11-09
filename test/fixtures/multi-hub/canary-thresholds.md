# Canary Promotion Thresholds

The canary compares a new release with the previous one on the same zone and stops promotion if any threshold is crossed. This guide lists the thresholds and why they were chosen.

## Error rate

The canary fails when the share of server errors exceeds the previous release's share by more than 0.4 percentage points over the hold period. The number is a compromise between noise on a two percent slice and the cost of a bad release.

## Latency

The canary fails when the ninety-fifth percentile latency is more than fifteen percent above the previous release, measured over a rolling ten minutes inside the hold. Median latency is shown but does not decide, because medians hide the tail regressions that customers notice.

## Saturation

The canary fails when CPU or connection pool saturation is higher than the previous release by more than ten points. Saturation is the metric most likely to look fine in a two percent canary and bad at full traffic, so the captain should also read the trend, not just the threshold.

## Overriding

A threshold can be overridden by the captain with a reason in the release thread. Overrides are reviewed on Wednesdays.
