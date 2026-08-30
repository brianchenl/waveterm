# We source this file with -NoExit -File
$env:PATH = {{.WSHBINDIR_PWSH}} + "{{.PATHSEP}}" + $env:PATH

# Source dynamic script from wsh token
$waveterm_swaptoken_output = wsh token $env:WAVETERM_SWAPTOKEN pwsh 2>$null | Out-String
if ($waveterm_swaptoken_output -and $waveterm_swaptoken_output -ne "") {
    Invoke-Expression $waveterm_swaptoken_output
}
Remove-Variable -Name waveterm_swaptoken_output
Remove-Item Env:WAVETERM_SWAPTOKEN

# Load Wave completions
wsh completion powershell | Out-String | Invoke-Expression

function Global:_waveterm_ai {
    param($key, $arg)

    [string]$buffer = $null
    [int]$cursor = 0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buffer, [ref]$cursor)
    if ([string]::IsNullOrWhiteSpace($buffer)) { return }

    $previousOutputEncoding = $OutputEncoding
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    try {
        $replacement = $buffer | wsh ai --stdin --shell pwsh
        $aiExitCode = $LASTEXITCODE
    } finally {
        $OutputEncoding = $previousOutputEncoding
    }
    if ($aiExitCode -ne 0) {
        [Microsoft.PowerShell.PSConsoleReadLine]::Ding()
        [Microsoft.PowerShell.PSConsoleReadLine]::Redisplay()
        return
    }
    $replacement = [string]$replacement
    if ([string]::IsNullOrWhiteSpace($replacement)) { return }

    [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $buffer.Length, $replacement)
    [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($replacement.Length)
}
Set-PSReadLineKeyHandler -Chord Shift+F12 -ScriptBlock $function:_waveterm_ai

$Global:_WAVETERM_ESC = [char]27
$Global:_WAVETERM_BEL = [char]7

if ((Get-Variable -Name PSStyle -Scope Global -ErrorAction SilentlyContinue) -and $PSStyle.FileInfo.Directory -eq "$($Global:_WAVETERM_ESC)[44;1m") {
    $PSStyle.FileInfo.Directory = "$($Global:_WAVETERM_ESC)[34;1m"
}

$Global:_WAVETERM_SI_FIRSTPROMPT = $true

# shell integration
function Global:_waveterm_si_blocked {
    # Check if we're in tmux or screen
    return ($env:TMUX -or $env:STY -or $env:TERM -like "tmux*" -or $env:TERM -like "screen*")
}

function Global:_waveterm_si_osc7 {
    if (_waveterm_si_blocked) { return }
    
    # Percent-encode the raw path as-is (handles UNC, drive letters, etc.)
    $encoded_pwd = [System.Uri]::EscapeDataString($PWD.Path)
    
    # OSC 7 - current directory
    Write-Host -NoNewline "$($Global:_WAVETERM_ESC)]7;file://localhost/$encoded_pwd$($Global:_WAVETERM_BEL)"
}

function Global:_waveterm_si_command_start([string]$buffer) {
    if (_waveterm_si_blocked) { return }

    $commandBytes = [System.Text.Encoding]::UTF8.GetBytes($buffer)
    if ($commandBytes.Length -gt 8192) {
        $buffer = "# command too large ($($commandBytes.Length) bytes)"
        $commandBytes = [System.Text.Encoding]::UTF8.GetBytes($buffer)
    }
    $cmd64 = [Convert]::ToBase64String($commandBytes)
    Write-Host -NoNewline "$($Global:_WAVETERM_ESC)]16162;C;{`"cmd64`":`"$cmd64`"}$($Global:_WAVETERM_BEL)"
}

Set-PSReadLineKeyHandler -Chord Enter -ScriptBlock {
    param($key, $arg)

    [string]$buffer = $null
    [int]$cursor = 0
    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$buffer, [ref]$cursor)
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseInput($buffer, [ref]$tokens, [ref]$parseErrors) > $null
    if ($parseErrors | Where-Object { $_.IncompleteInput }) {
        [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
        return
    }
    _waveterm_si_command_start $buffer
    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
}

function Global:_waveterm_si_prompt([bool]$lastCommandSucceeded) {
    if (_waveterm_si_blocked) { return }
    
    if ($Global:_WAVETERM_SI_FIRSTPROMPT) {
		$shellversion = $PSVersionTable.PSVersion.ToString()
		Write-Host -NoNewline "$($Global:_WAVETERM_ESC)]16162;M;{`"shell`":`"pwsh`",`"shellversion`":`"$shellversion`",`"integration`":true}$($Global:_WAVETERM_BEL)"
        $Global:_WAVETERM_SI_FIRSTPROMPT = $false
    } else {
        $exitcode = if ($lastCommandSucceeded) { 0 } else { 1 }
        Write-Host -NoNewline "$($Global:_WAVETERM_ESC)]16162;D;{`"exitcode`":$exitcode}$($Global:_WAVETERM_BEL)"
    }
    
    _waveterm_si_osc7
    Write-Host -NoNewline "$($Global:_WAVETERM_ESC)]16162;A$($Global:_WAVETERM_BEL)"
}

# Add the OSC 7 call to the prompt function
if (Test-Path Function:\prompt) {
    $global:_waveterm_original_prompt = $function:prompt
    function Global:prompt {
        $lastCommandSucceeded = $?
        _waveterm_si_prompt $lastCommandSucceeded
        & $global:_waveterm_original_prompt
    }
} else {
    function Global:prompt {
        $lastCommandSucceeded = $?
        _waveterm_si_prompt $lastCommandSucceeded
        "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
}
