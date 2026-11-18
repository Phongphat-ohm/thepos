param(
    [Parameter(ValueFromRemainingArguments = $true)]
    $Arguments
)

bun scripts/pos-ctl.ts @Arguments
