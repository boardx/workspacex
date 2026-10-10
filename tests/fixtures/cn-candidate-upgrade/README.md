# Historical candidate upgrade engine fixture

`cn-tool-install-transaction-74d5a1b1.py` is the exact Git blob from
`d9690463cf8394d69b6093aaa759802e458ffbcc:.harness/scripts/vm/cn-tool-install-transaction.py`.
SHA256: `74d5a1b1e728ed74ed3e9d7c8f2a602dfa7143f3985eab7234f2710cad88fde8`.

The narrow eight-to-nine candidate-tool installer deliberately pins this reviewed
engine. Its tests must use these historical bytes, not whichever version of the
full maintenance-tool installer happens to be at HEAD. This fixture does not
change production pins, install targets, or approval requirements. The test still
uses the real protected-file loader and explicitly rejects altered helper bytes.
