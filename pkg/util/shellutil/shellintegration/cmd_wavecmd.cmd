@echo off
set "WAVETERM_CMD_INIT="
set "PATH={{.WSHBINDIR_CMD}};%PATH%"
if defined WAVETERM_SWAPTOKEN set "_WAVETERM_INIT=%TEMP%\waveterm-init-%RANDOM%-%RANDOM%.cmd"
if defined _WAVETERM_INIT call wsh token "%WAVETERM_SWAPTOKEN%" cmd > "%_WAVETERM_INIT%" 2>nul
set "WAVETERM_SWAPTOKEN="
if defined _WAVETERM_INIT call "%_WAVETERM_INIT%"
if defined _WAVETERM_INIT del /q "%_WAVETERM_INIT%" >nul 2>nul
set "_WAVETERM_INIT="
prompt $E]16162;S;cmd$E\$E]16162;P;$P$E\$E]16162;A$E\$P$G
