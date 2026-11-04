# Explicit streaming usage — #6230

The actual factory with the installed LangChain/OpenAI SDK dispatches `stream=true` without `stream_options.include_usage` before this fix. Custom clients/base URLs disable this SDK default. The [official Qwen streaming contract](https://help.aliyun.com/zh/model-studio/stream) requires requesting streamed usage explicitly. This is distinct from chat admission recovery in merged #6229; release41817480861 of that verified8f continues normally.

## Red and green

The regression runs the actual model factory, installed SDK, AccountingTransport/AsyncAccountingTransport and unbuffered vendor response streams. Its vendor fixture emits the final usage chunk only when requested, as documented. Before correction, stream and astream fail on the missing wire option; invoke and ainvoke pass: **2 failed, 2 passed** (`red.txt`). No real vendor or API credential is used.

The production change is the existing SDK `stream_usage=True` option. It adds the protocol field only to streaming calls. The same four modes then preserve content, one vendor dispatch, admit/terminal phases with the same request ID, and reported total9/prompt6/completion3. Nonstream requests contain no stream_options. Affected model/typed-refusal/accounting suite: **119 passed** (`green.txt`). Existing no-vendor-dispatch refusals and unknown/pending behavior are unchanged. No wallet, owner, epoch, tariff, model selection or permission changes.

## Release boundary

Normal independent exact-SHA review, develop PR checks/queue and deployment remain required. No live DevApp billing completion is claimed here. The deployed greeting must still establish actual vendor-reported totals and corresponding personal wallet settlement; unknown usage remains pending and is never reported as zero.
