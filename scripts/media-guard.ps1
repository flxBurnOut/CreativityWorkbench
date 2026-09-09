$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# A separate, short-lived host joins the job BEFORE creating the media process.
# Child processes inherit its hard commit limit; killing this host closes the
# only job handle and terminates the media process too.
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -Path (Join-Path $PSScriptRoot 'media-guard.cs')
    $code = [WorkbenchMediaGuard]::Run([string]$request.binary, [string[]]$request.args, [string]$request.cwd, [UInt64]$request.memoryLimit)
    exit $code
} catch {
    [Console]::Error.WriteLine('WORKBENCH_MEDIA_GUARD_FAILED')
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 125
}
