# FCF-R3 Q&A Benchmark Report

Generated: 2026-05-07T14:28:17.565Z
Questions: 46 | Pass: 46 | Fail: 0 | Pass rate: 100.0%

## Summary Metrics

| Metric | Value |
| --- | --- |
| Pass rate | 100.0% (46/46) |
| Avg latency (ms) | 1 |
| P95 latency (ms) | 2 |
| Avg input tokens | 142 |
| Citation rate | 95.7% |
| Injection blocked | 2/2 |
| Est. cost/answer (USD) | $0.000011 |
| Est. total cost (USD) | $0.00049 |

## Results by Category

| Category | Pass | Rate |
| --- | ---: | ---: |
| current-supported | 10/10 | 100% |
| historical-only | 3/3 | 100% |
| conflict-detected | 3/3 | 100% |
| evidence-insufficient | 3/3 | 100% |
| no-evidence | 3/3 | 100% |
| prompt-injection | 2/2 | 100% |
| human-review-required | 2/2 | 100% |
| version-validity | 2/2 | 100% |
| citation | 2/2 | 100% |
| budget | 1/1 | 100% |
| synthesis | 2/2 | 100% |
| authorization | 1/1 | 100% |
| temporal | 2/2 | 100% |
| abstention | 2/2 | 100% |
| policy | 2/2 | 100% |
| multi-source | 1/1 | 100% |
| over-association | 5/5 | 100% |

## Per-Question Results

| ID | Category | Expected | Actual | Status | Pass | Latency |
| --- | --- | --- | --- | --- | --- | --- |
| A01 | current-supported | current-supported | current-supported | ✓ | ✓ | 8ms |
| A02 | current-supported | current-supported | current-supported | ✓ | ✓ | 2ms |
| A03 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A04 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A05 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A06 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A07 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A08 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| A09 | current-supported | current-supported | current-supported | ✓ | ✓ | 2ms |
| A10 | current-supported | current-supported | current-supported | ✓ | ✓ | 1ms |
| B01 | historical-only | historical-only | historical-only | ✓ | ✓ | 1ms |
| B02 | historical-only | current-supported | current-supported | ✓ | ✓ | 0ms |
| B03 | historical-only | historical-only | historical-only | ✓ | ✓ | 0ms |
| C01 | conflict-detected | conflict-detected | conflict-detected | ✓ | ✓ | 0ms |
| C02 | conflict-detected | conflict-detected | conflict-detected | ✓ | ✓ | 1ms |
| C03 | conflict-detected | conflict-detected | conflict-detected | ✓ | ✓ | 0ms |
| D01 | evidence-insufficient | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| D02 | evidence-insufficient | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| D03 | evidence-insufficient | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| E01 | no-evidence | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| E02 | no-evidence | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| E03 | no-evidence | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| F01 | prompt-injection | no-evidence | no-evidence | ✓ | ✓ | 0ms |
| F02 | prompt-injection | no-evidence | no-evidence | ✓ | ✓ | 0ms |
| G01 | human-review-required | human-review-required | human-review-required | ✓ | ✓ | 1ms |
| G02 | human-review-required | human-review-required | human-review-required | ✓ | ✓ | 0ms |
| H01 | version-validity | current-supported | current-supported | ✓ | ✓ | 0ms |
| H02 | version-validity | current-supported | current-supported | ✓ | ✓ | 0ms |
| I01 | citation | current-supported | current-supported | ✓ | ✓ | 0ms |
| I02 | citation | current-supported | current-supported | ✓ | ✓ | 0ms |
| J01 | budget | current-supported | current-supported | ✓ | ✓ | 2ms |
| K01 | synthesis | current-supported | current-supported | ✓ | ✓ | 3ms |
| K02 | synthesis | current-supported | current-supported | ✓ | ✓ | 1ms |
| L01 | authorization | current-supported | current-supported | ✓ | ✓ | 0ms |
| M01 | temporal | current-supported | current-supported | ✓ | ✓ | 0ms |
| M02 | temporal | current-supported | current-supported | ✓ | ✓ | 0ms |
| N01 | abstention | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| N02 | abstention | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| O01 | policy | current-supported | current-supported | ✓ | ✓ | 0ms |
| O02 | policy | current-supported | current-supported | ✓ | ✓ | 0ms |
| P01 | multi-source | conflict-detected | conflict-detected | ✓ | ✓ | 0ms |
| Q01 | over-association | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| Q02 | over-association | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |
| Q03 | over-association | current-supported | current-supported | ✓ | ✓ | 0ms |
| Q04 | over-association | current-supported | current-supported | ✓ | ✓ | 1ms |
| Q05 | over-association | insufficient-evidence | insufficient-evidence | ✓ | ✓ | 0ms |

## Failures

_No failures._